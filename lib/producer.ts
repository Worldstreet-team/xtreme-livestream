"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DisconnectReason, Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import type { CampaignView, ChannelRole, RundownSegment, SponsorView } from "@xtreme/contracts";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { PinnedMessage } from "@/components/app/live-chat";

/**
 * Producer mode (Phase 3) on the client: a channel's console — the host on
 * a second device, or a producer they've named — from
 * GET /users/:username/console, and the room it watches.
 *
 * The console joins the stream's room hidden (prod-<id>): it sees and hears
 * what the room does and never publishes, so viewers never see it and it
 * never counts as one. Everything it changes goes through the same routes
 * the studio uses, which let producers in.
 */

export interface ConsoleHost {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  /** As a populated stream host carries it: the logo by version, never its bytes. */
  brand: { accent: string; lowerThird: string; font: string; logoVersion: number };
  /** How long the host has lines stay up, so a producer's go up the same. */
  featureSeconds: number;
  featureGiftsFromMinor: number;
}

export interface ConsoleStream {
  id: string;
  title: string;
  category: string;
  source: string;
  startedAt: string | null;
  scene: unknown;
  guests: { userId: string; username: string; avatar: string; status: string }[];
  goal: unknown;
  heat: unknown;
  pinned: PinnedMessage | null;
}

export interface ConsoleData {
  role: ChannelRole;
  host: ConsoleHost;
  sponsors: { own: SponsorView[]; campaigns: CampaignView[] };
  /** The host's run of show — readable off air, to prepare from. */
  segments: RundownSegment[];
  /** Null while the channel is off air. */
  stream: ConsoleStream | null;
  token: string | null;
  url: string | null;
}

export type ConsoleState =
  | { status: "loading" }
  | { status: "ready"; data: ConsoleData }
  | { status: "denied"; message: string }
  | { status: "missing" }
  | { status: "error"; message: string };

/** Off air, the console looks again this often, so it lights up when the host goes live. */
const OFF_AIR_POLL_MS = 10_000;

export function useConsole(username: string) {
  const [state, setState] = useState<{ username: string; value: ConsoleState } | null>(null);
  const [nonce, setNonce] = useState(0);
  /** Look again now: the room closed, or the show changed under us. */
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const r = await apiFetch<{ success: boolean; data: ConsoleData }>(`/api/users/${encodeURIComponent(username)}/console`);
        if (!alive) return;
        setState({ username, value: { status: "ready", data: r.data } });
        if (!r.data.stream) timer = setTimeout(load, OFF_AIR_POLL_MS);
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 403) {
          setState({ username, value: { status: "denied", message: err.message } });
        } else if (err instanceof ApiError && err.status === 404) {
          setState({ username, value: { status: "missing" } });
        } else {
          // A blip keeps what we had; with nothing yet, say so — and keep trying either way.
          setState((cur) =>
            cur?.username === username && cur.value.status === "ready"
              ? cur
              : { username, value: { status: "error", message: "Couldn't reach the channel — trying again." } }
          );
          timer = setTimeout(load, OFF_AIR_POLL_MS);
        }
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [username, nonce]);

  const value: ConsoleState = state?.username === username ? state.value : { status: "loading" };
  return { state: value, reload };
}

/** Someone on the stage besides the host, as the console shows them. */
export interface ConsoleGuest {
  identity: string;
  name: string;
  track: RemoteTrack | undefined;
}

export interface ConsoleRoom {
  room: Room | null;
  connected: boolean;
  hostCamera: RemoteTrack | undefined;
  hostScreen: RemoteTrack | undefined;
  guests: ConsoleGuest[];
}

const EMPTY: Omit<ConsoleRoom, "room" | "connected"> = { hostCamera: undefined, hostScreen: undefined, guests: [] };

/**
 * The console's view of the room: the host's camera and screen, the guests'
 * cameras, their sound when the producer listens, and the room's news —
 * metadata (the scene) and data events — handed on as they arrive.
 */
export function useConsoleRoom({
  url,
  token,
  hostId,
  listen,
  onMetadata,
  onData,
  onClosed,
}: {
  url: string | null;
  token: string | null;
  hostId: string;
  /** Play the room out loud — off by default, so a producer beside the host never feeds back. */
  listen: boolean;
  onMetadata: (metadata: string | undefined) => void;
  onData: (data: Record<string, unknown>) => void;
  /** The room closed (the stream ended) or let us go: look again. */
  onClosed: (ended: boolean) => void;
}): ConsoleRoom {
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [seen, setSeen] = useState(EMPTY);
  // The handlers change every render; the room is joined once per token.
  const handlers = useRef({ onMetadata, onData, onClosed });
  useEffect(() => {
    handlers.current = { onMetadata, onData, onClosed };
  });

  useEffect(() => {
    if (!url || !token) return;
    let alive = true;
    const r = new Room({ adaptiveStream: true, dynacast: true });
    const crew = (identity: string) => identity.startsWith("mon-") || identity.startsWith("prod-");
    const sync = () => {
      if (!alive) return;
      let hostCamera: RemoteTrack | undefined;
      let hostScreen: RemoteTrack | undefined;
      const guests: ConsoleGuest[] = [];
      for (const p of r.remoteParticipants.values()) {
        if (crew(p.identity)) continue;
        const videos = [...p.videoTrackPublications.values()].filter((pub) => pub.track && !pub.isMuted);
        if (p.identity === hostId || p.identity === `obs-${hostId}`) {
          const screen = videos.find((pub) => pub.source === Track.Source.ScreenShare);
          const camera = videos.find((pub) => pub.source !== Track.Source.ScreenShare);
          // The browser studio's camera wins over the encoder's feed only if the encoder has none.
          if (camera?.track && (!hostCamera || p.identity === `obs-${hostId}`)) hostCamera = camera.track;
          if (screen?.track) hostScreen = screen.track;
        } else {
          const camera = videos.find((pub) => pub.source === Track.Source.Camera) ?? videos[0];
          guests.push({ identity: p.identity, name: p.name || p.identity, track: camera?.track });
        }
      }
      setSeen({ hostCamera, hostScreen, guests });
    };

    r.on(RoomEvent.TrackSubscribed, sync)
      .on(RoomEvent.TrackUnsubscribed, sync)
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.RoomMetadataChanged, (metadata: string) => handlers.current.onMetadata(metadata))
      .on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const data = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
          if (data && typeof data === "object" && typeof data.__evt === "string") handlers.current.onData(data);
        } catch {
          // Not an event.
        }
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (!alive) return;
        setConnected(false);
        setSeen(EMPTY);
        if (reason === DisconnectReason.CLIENT_INITIATED) return;
        handlers.current.onClosed(reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED);
      });

    void r
      .connect(url, token)
      .then(() => {
        if (!alive) return;
        setRoom(r);
        setConnected(true);
        handlers.current.onMetadata(r.metadata);
        sync();
      })
      .catch(() => {
        if (alive) handlers.current.onClosed(false);
      });

    return () => {
      alive = false;
      setRoom(null);
      setConnected(false);
      setSeen(EMPTY);
      void r.disconnect().catch(() => {});
    };
  }, [url, token, hostId]);

  // The room's sound: every voice and a shared screen's audio, only while listening.
  useEffect(() => {
    if (!room || !listen) return;
    const els = new Map<RemoteTrack, HTMLMediaElement>();
    const attach = () => {
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.audioTrackPublications.values()) {
          const track = pub.track;
          if (!track || els.has(track)) continue;
          const el = track.attach();
          el.setAttribute("aria-hidden", "true");
          document.body.appendChild(el);
          els.set(track, el);
        }
      }
    };
    const detach = (track: RemoteTrack) => {
      const el = els.get(track);
      if (!el) return;
      track.detach(el);
      el.remove();
      els.delete(track);
    };
    const onSub = () => attach();
    const onUnsub = (track: RemoteTrack) => detach(track);
    void room.startAudio().catch(() => {});
    attach();
    room.on(RoomEvent.TrackSubscribed, onSub).on(RoomEvent.TrackUnsubscribed, onUnsub);
    return () => {
      room.off(RoomEvent.TrackSubscribed, onSub).off(RoomEvent.TrackUnsubscribed, onUnsub);
      for (const track of [...els.keys()]) detach(track);
    };
  }, [room, listen]);

  return { room, connected, ...seen };
}
