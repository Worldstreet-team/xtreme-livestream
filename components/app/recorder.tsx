"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RoomEvent, type RemoteTrack } from "livekit-client";
import { SceneRenderer, type SceneCell } from "@/components/app/scene-renderer";
import { AwayTile, StageTile } from "@/components/app/stage-tile";
import { LivePreview, PreviewVideo, hostTrackOf, useRoomPreview } from "@/components/app/live-preview";
import { GiftEffects, type GiftEffectsHandle } from "@/components/app/gift-effects";
import { SetStinger } from "@/components/app/set-stinger";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api-client";
import { isBattleActive, sideOf, type BattleView } from "@/lib/battles";
import { newerGoal, newerHeat, readGoal, readHeat, type StreamGoal, type StreamHeat } from "@/lib/goals";
import { placePhone, tilesBeside } from "@/lib/angles";
import { anchorsListener, useAnchorFeed } from "@/lib/face-anchors";
import { brandWithSet, setById } from "@/lib/sets";
import { useConsoleRoom } from "@/lib/producer";
import { DEFAULT_SCENE, gainFor, newerScene, readBrand, readScene, sceneFromMetadata, type Brand, type Scene } from "@/lib/scene";
import { cn } from "@/lib/utils";

/**
 * The recording page (app/record/[id]): what LiveKit's room-composite egress
 * opens in its headless browser and records — the program exactly as
 * viewers see it, drawn by the same SceneRenderer, with the room's sound at
 * the host's audio-desk levels. No chrome, no controls: every pixel and
 * every sound here ends up in the replay.
 *
 * Egress appends `url` and `token` (a hidden, subscribe-only recorder) to
 * the address, and waits for this page to log START_RECORDING; it logs
 * END_RECORDING when the room closes under it. See services/api recording.ts.
 */

/** How long to wait for the host's picture before recording whatever's up. */
const START_WAIT_MS = 8_000;

const startRecording = (() => {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    console.log("START_RECORDING");
  };
})();
const endRecording = () => console.log("END_RECORDING");

interface RecordHost {
  _id: string;
  username: string;
  displayName: string;
  avatar: string;
  brand?: unknown;
}

interface RecordStream {
  _id: string;
  scene?: unknown;
  goal?: unknown;
  heat?: unknown;
  streamerId: RecordHost;
}

export function Recorder({ streamId }: { streamId: string }) {
  const [params] = useState(() => {
    if (typeof window === "undefined") return { url: null, token: null };
    const q = new URLSearchParams(window.location.search);
    return { url: q.get("url"), token: q.get("token") };
  });
  const [stream, setStream] = useState<RecordStream | null>(null);
  // A room that dropped (not closed) is joined again: the remount reconnects.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      apiFetch<{ success: boolean; data: { stream: RecordStream } }>(`/api/streams/${streamId}`)
        .then((r) => alive && setStream(r.data.stream))
        // The recording must not die on a blip: try again until it loads.
        .catch(() => alive && setTimeout(load, 2_000));
    void load();
    return () => {
      alive = false;
    };
  }, [streamId]);

  // Nothing to draw without the room: record the black frame rather than hang the egress.
  useEffect(() => {
    if (!params.url || !params.token) startRecording();
  }, [params.url, params.token]);

  if (!stream || !params.url || !params.token) return <Frame />;
  return (
    <Program
      key={attempt}
      stream={stream}
      url={params.url}
      token={params.token}
      onDropped={() => setTimeout(() => setAttempt((n) => n + 1), 2_000)}
    />
  );
}

function Frame({ children }: { children?: ReactNode }) {
  return <main className="fixed inset-0 overflow-hidden bg-black text-white">{children}</main>;
}

function Program({ stream, url, token, onDropped }: { stream: RecordStream; url: string; token: string; onDropped: () => void }) {
  const host = stream.streamerId;
  const hostName = host.displayName || host.username;
  const [scene, setScene] = useState<Scene>(() => readScene(stream.scene) ?? DEFAULT_SCENE);
  const [brand, setBrand] = useState<Brand>(() => readBrand(host.brand, host._id));
  const [goal, setGoal] = useState<StreamGoal | null>(() => readGoal(stream.goal));
  const [heat, setHeat] = useState<StreamHeat | null>(() => readHeat(stream.heat));
  const [battle, setBattle] = useState<BattleView | null>(null);
  const [feedAway, setFeedAway] = useState(false);
  /** Guests the host has put on: backstage ones are in the room but not in the picture. */
  const [backstage, setBackstage] = useState<Set<string>>(new Set());

  const onData = (evt: Record<string, unknown>) => {
    switch (evt.__evt) {
      case "scene": {
        const next = readScene(evt.scene);
        setScene((cur) => newerScene(cur, next) ?? cur);
        return;
      }
      case "brand":
        if (evt.brand) setBrand(readBrand(evt.brand, host._id));
        return;
      case "feed":
        setFeedAway(evt.state === "reconnecting");
        return;
      case "battle":
        if (evt.battle && typeof evt.battle === "object") setBattle(evt.battle as BattleView);
        return;
      case "goal": {
        const next = readGoal(evt.goal);
        if (next) setGoal((g) => newerGoal(g, next));
        return;
      }
      case "heat": {
        const next = readHeat(evt.heat);
        if (next) setHeat((h) => newerHeat(h, next));
        return;
      }
      case "guest_update": {
        if (typeof evt.userId !== "string") return;
        const uid = evt.userId;
        setBackstage((cur) => {
          const next = new Set(cur);
          if (evt.action === "backstage") next.add(uid);
          else next.delete(uid);
          return next;
        });
        return;
      }
    }
  };

  const onClosed = useCallback(
    (why: "ended" | "dropped" | "elsewhere") => {
      if (why === "dropped") onDropped();
      // The room closed: the stream is over, and so is the recording.
      else endRecording();
    },
    [onDropped]
  );

  const live = useConsoleRoom({
    url,
    token,
    hostId: host._id,
    // The sound is mixed below, at the host's levels.
    listen: false,
    onMetadata: (metadata) => {
      const next = sceneFromMetadata(metadata);
      if (next) setScene((cur) => newerScene(cur, next) ?? cur);
    },
    onData,
    onClosed,
  });

  // Who's backstage as the stream stands, and whether a battle's on.
  useEffect(() => {
    let alive = true;
    apiFetch<{ success: boolean; data: { battle: BattleView | null } }>(`/api/streams/${stream._id}/battle`)
      .then((r) => alive && setBattle(r.data.battle))
      .catch(() => {});
    apiFetch<{ success: boolean; data: { stream: { guests?: Array<{ userId: string; status: string }> } } }>(`/api/streams/${stream._id}`)
      .then((r) => alive && setBackstage(new Set((r.data.stream.guests ?? []).filter((g) => g.status === "backstage").map((g) => g.userId))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stream._id]);

  // The Set's gift effects, as viewers see them: the host's face positions and the gifts.
  const anchorFeed = useAnchorFeed();
  const effectsRef = useRef<GiftEffectsHandle | null>(null);
  useEffect(() => {
    const room = live.room;
    if (!room) return;
    const takeAnchors = anchorsListener(anchorFeed, () => host._id);
    const onRoomData = (payload: Uint8Array, from?: { identity: string }, kind?: unknown, topic?: string) => {
      if (takeAnchors(payload, from, kind, topic)) return;
      if (from) return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as { __evt?: string; type?: string; emoji?: string; id?: string };
        if (!data.__evt && data.type === "tip") effectsRef.current?.gift({ emoji: data.emoji }, { id: String(data.id ?? "") });
      } catch {
        // Not a line.
      }
    };
    room.on(RoomEvent.DataReceived, onRoomData);
    return () => {
      room.off(RoomEvent.DataReceived, onRoomData);
    };
  }, [live.room, anchorFeed, host._id]);

  // The room's sound, every voice at the level the host's audio desk set it.
  const gainsRef = useRef(scene.gains);
  useEffect(() => {
    gainsRef.current = scene.gains;
    for (const el of document.querySelectorAll<HTMLAudioElement>("audio[data-identity]")) {
      el.volume = gainFor(scene.gains, el.dataset.identity);
    }
  }, [scene.gains]);
  useEffect(() => {
    const room = live.room;
    if (!room) return;
    const els = new Map<RemoteTrack, HTMLMediaElement>();
    const attach = () => {
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.audioTrackPublications.values()) {
          const track = pub.track;
          if (!track || els.has(track)) continue;
          const el = track.attach();
          el.dataset.identity = p.identity;
          el.volume = gainFor(gainsRef.current, p.identity);
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
    void room.startAudio().catch(() => {});
    attach();
    room.on(RoomEvent.TrackSubscribed, attach).on(RoomEvent.TrackUnsubscribed, detach);
    return () => {
      room.off(RoomEvent.TrackSubscribed, attach).off(RoomEvent.TrackUnsubscribed, detach);
      for (const track of [...els.keys()]) detach(track);
    };
  }, [live.room]);

  // Rolling once there's something worth recording: the host's picture, a
  // card or a chart up — or, after a wait, whatever's there.
  const mainTrack = live.hostScreen ?? live.hostCamera;
  const somethingUp = Boolean(mainTrack || scene.card || scene.layout === "chart-face");
  useEffect(() => {
    if (live.connected && somethingUp) startRecording();
  }, [live.connected, somethingUp]);
  useEffect(() => {
    const t = setTimeout(startRecording, START_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  const battleOn = isBattleActive(battle) ? battle : null;
  const side = battleOn ? sideOf(battleOn, stream._id) : null;
  const opponent = battleOn && side ? (side === "host" ? battleOn.challenger : battleOn.host) : null;
  const pairOpponent = battleOn?.mode === "2v2" ? opponent : null;
  const pairTracks = useRoomPreview(pairOpponent?.streamId ?? null);
  const stageGuests = live.guests.filter((g) => !backstage.has(g.identity));
  const guestCell = (g: (typeof live.guests)[number]): SceneCell => ({
    key: g.identity,
    identity: g.identity,
    node: <StageTile fill track={g.track} label={g.name} />,
  });
  const opponentCell = (key: string, name: string, picture: ReactNode): SceneCell => ({
    key,
    node: (
      <div className="relative size-full bg-black">
        {picture}
        <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold">
          {name} · opponent
        </span>
      </div>
    ),
  });
  const others: SceneCell[] = (() => {
    if (!opponent || !battleOn || !side) return stageGuests.map(guestCell);
    if (pairOpponent) {
      const mate = (side === "host" ? battleOn.host : battleOn.challenger).partner ?? null;
      const mateGuest = mate ? stageGuests.find((g) => g.identity === mate.userId) : undefined;
      const theirMate = pairOpponent.partner ?? null;
      return [
        opponentCell("opponent", pairOpponent.displayName, <PreviewVideo track={hostTrackOf(pairTracks, pairOpponent, theirMate?.userId)} />),
        mateGuest ? guestCell(mateGuest) : { key: "mate", node: <AwayTile name={mate?.displayName ?? "Their partner"} /> },
        theirMate
          ? opponentCell("opponent-mate", theirMate.displayName, <PreviewVideo track={pairTracks.get(theirMate.userId)} />)
          : { key: "opponent-mate", node: <AwayTile name="Their partner" /> },
      ];
    }
    return [
      opponentCell(
        "opponent",
        opponent.displayName,
        <LivePreview streamId={opponent.streamId} className="absolute inset-0" poster={<div className="absolute inset-0 bg-black" />} fallbackSrc={null} />
      ),
      ...stageGuests.map(guestCell),
    ];
  })();
  const phoneSlot = live.phoneCamera ? (scene.phoneSlot ?? "off") : "off";
  const phoneHasCell = placePhone(phoneSlot, scene.layout).cell;
  const sharing = tilesBeside(scene.layout, others.length, phoneSlot, Boolean(battleOn)) > 0;

  return (
    <Frame>
      <SceneRenderer
        scene={scene}
        portrait={false}
        forceAuto={Boolean(battleOn)}
        host={{ name: hostName, avatar: host.avatar }}
        mainLabel={hostName}
        main={
          <div className="relative size-full">
            <TrackVideo track={mainTrack} fit={sharing ? "cover" : "contain"} />
          </div>
        }
        over={
          <GiftEffects
            set={setById(brand.set ?? null)}
            anchors={phoneHasCell || live.hostScreen ? null : anchorFeed}
            fit={sharing ? "cover" : "contain"}
            onReady={(handle) => {
              effectsRef.current = handle;
            }}
          />
        }
        pip={live.hostScreen && live.hostCamera ? <StageTile fill track={live.hostCamera} label={hostName} /> : undefined}
        face={!live.hostScreen && live.hostCamera ? <StageTile fill track={live.hostCamera} label={hostName} /> : undefined}
        phone={live.phoneCamera ? <StageTile fill track={live.phoneCamera} label="Phone cam" /> : undefined}
        phoneSlot={phoneSlot}
        pipClassName="top-3 right-3"
        guests={others}
        brand={brandWithSet(brand)}
        goal={goal}
        heat={heat}
      />
      <SetStinger set={setById(brand.set ?? null)} trigger={scene.layout} />
      {/* The feed dropped and the stream is holding for it: what viewers are told, not a frozen frame. */}
      {feedAway && !scene.card && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/85">
          <UserAvatar src={host.avatar} name={hostName} size={72} />
          <p className="font-wide text-[22px] font-bold tracking-[-0.02em]">{hostName} will be right back</p>
        </div>
      )}
    </Frame>
  );
}

/** A remote camera or screen, filling its cell. */
function TrackVideo({ track, fit }: { track: RemoteTrack | undefined; fit: "cover" | "contain" }) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [el, track]);
  return <video ref={setEl} autoPlay playsInline muted className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")} />;
}
