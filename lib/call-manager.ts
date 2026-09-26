import type { CallIncoming, CallSignal, CallTokenResult } from "@worldstreet/messaging-sdk";
import { viaPlatform } from "./messaging-copy";
import type { LocalVideoTrack, RemoteTrack, Room } from "livekit-client";

/**
 * Voice and video calls, the WorldSpace way — ported from the WorldSpace
 * client's call-manager so a call placed here rings there and back.
 *
 *  - **Signalling** rides the messaging gateway: `calls.ring` makes the other
 *    phone ring (it publishes `call:incoming` on their private calls channel),
 *    `calls.signal` carries accept / decline / busy / cancel / end.
 *  - **Media** rides LiveKit, one room per conversation, so "who calls whom"
 *    never has to be answered in SDP terms.
 *
 * Framework-free on purpose: the gateway calls and the incoming-ring
 * subscription are injected by CallProvider, and the UI subscribes to state.
 * LiveKit itself loads on the first call, never on page load — the provider
 * is mounted on every page, and the SDK is ~500KB.
 */

type LiveKit = typeof import("livekit-client");
let lk: LiveKit | null = null;
async function loadLiveKit(): Promise<LiveKit> {
  lk ??= await import("livekit-client");
  return lk;
}
/** The loaded module, for paths that only run once a room exists. */
function LK(): LiveKit {
  if (!lk) throw new Error("LiveKit was used before a call started");
  return lk;
}

export type CallStatus = "idle" | "ringing" | "connecting" | "connected" | "ended";

/** Why a call ended — drives the closing line the surface shows. */
export type CallEndReason = "declined" | "ended" | "cancelled" | "unanswered" | "failed" | "busy" | null;

export interface CallPeer {
  id: string;
  name: string;
  avatar: string;
  username: string;
}

/** A connected call a reload interrupted — offered back as "Rejoin", never auto-joined. */
export interface RejoinableCall {
  conversationId: string;
  isVideo: boolean;
  isGroup?: boolean;
  peer: CallPeer;
  /** The original connect time, so a rejoined call's timer is honest. */
  startedAt: number;
}

export interface CallState {
  status: CallStatus;
  isIncoming: boolean;
  /** DM: the other person. Group: the room's own card. */
  peer: CallPeer | null;
  isGroup: boolean;
  /** Who rang, for the "Ada is calling Night Owls" line of a group call. */
  groupCaller: CallPeer | null;
  /** Remote participants in the room; bumps re-render the grid. */
  participantCount: number;
  conversationId: string | null;
  isVideo: boolean;
  /** Docked to a corner instead of filling the screen. */
  minimized: boolean;
  startedAt: number | null;
  endReason: CallEndReason;
  micOn: boolean;
  camOn: boolean;
  facing: "user" | "environment";
  /** A camera flip in flight, so the control can't double-fire. */
  switchingCam: boolean;
  remoteMuted: boolean;
  remoteVideoOn: boolean;
  poorConnection: boolean;
  error: string | null;
  rejoinable: RejoinableCall | null;
  /** Where a ring came from when it wasn't Xtream: "via WorldSpace". */
  via: string | null;
}

/** What the manager needs from the gateway. CallProvider wires the SDK in. */
export interface CallBackend {
  token(conversationId: string): Promise<CallTokenResult>;
  ring(conversationId: string, video: boolean): Promise<unknown>;
  signal(conversationId: string, type: CallSignal): Promise<unknown>;
  log(input: { conversationId: string; outcome: string; video?: boolean; durationSec?: number }): Promise<unknown>;
}

/** Subscribes a handler to `calls:<me>`; returns the unsubscribe. */
export type CallChannel = (
  handler: (name: "call:incoming" | CallSignal, payload: CallIncoming | Record<string, unknown>) => void,
) => () => void;

type Listener = (state: CallState) => void;

/** Nobody picked up. Matches what phones do rather than ringing forever. */
const RING_TIMEOUT_MS = 45_000;
/** How long the closing line lingers before the surface clears. */
const TEARDOWN_MS = 1_800;
/** Session-scoped: a new tab is a new phone; only this tab's reload is offered the call back. */
const ACTIVE_CALL_KEY = "xtream-active-call";
const REJOIN_WINDOW_MS = 2 * 60_000;
const PERSIST_HEARTBEAT_MS = 15_000;
/** A rejoin rings nobody; if the other side never shows, end quietly. */
const REJOIN_GRACE_MS = 10_000;

interface StoredActiveCall {
  conversationId: string;
  isVideo: boolean;
  isGroup?: boolean;
  peerJson: string;
  startedAt: number;
  at: number;
}

export const IDLE_CALL_STATE: CallState = {
  status: "idle",
  isIncoming: false,
  peer: null,
  isGroup: false,
  groupCaller: null,
  participantCount: 0,
  conversationId: null,
  isVideo: false,
  minimized: false,
  startedAt: null,
  endReason: null,
  micOn: true,
  camOn: false,
  facing: "user",
  switchingCam: false,
  remoteMuted: false,
  remoteVideoOn: false,
  poorConnection: false,
  error: null,
  rejoinable: null,
  via: null,
};

/** The sentence the gateway refused with, when it gave one. */
function reasonOf(err: unknown): string | null {
  const status = (err as { status?: number })?.status;
  const message = (err as Error)?.message;
  // Status 0 is "never answered": that one's about the network, not a rule.
  return status && status !== 0 && message ? message : null;
}

export interface RemoteParticipantInfo {
  identity: string;
  name: string;
  videoTrack: RemoteTrack | null;
  audioTrack: RemoteTrack | null;
  micMuted: boolean;
  camOn: boolean;
  speaking: boolean;
}

class CallManager {
  private state: CallState = { ...IDLE_CALL_STATE };
  private listeners = new Set<Listener>();

  private backend: CallBackend | null = null;
  private unsubscribeChannel: (() => void) | null = null;
  private myProfileId: string | null = null;

  private room: Room | null = null;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while the page is going away — see the constructor. */
  private unloading = false;
  private rejoinChecked = false;

  /** Track handles the surface attaches to <video>/<audio>. */
  public localVideoTrack: LocalVideoTrack | null = null;
  public remoteTracks = new Map<string, RemoteTrack>();

  constructor() {
    // A reload runs the normal hang-up path, and finish() clears the stored
    // record — exactly the record a reload needs. This listener registers at
    // import, before CallProvider's, so finish() knows to leave it alone.
    if (typeof window !== "undefined") {
      const markUnloading = () => {
        this.unloading = true;
        if (this.state.status === "connected") this.persistActiveCall();
        setTimeout(() => {
          this.unloading = false;
        }, 1_000);
      };
      window.addEventListener("beforeunload", markUnloading);
      window.addEventListener("pagehide", markUnloading);
    }
  }

  /** Everyone else in the room, for the group grid. */
  get remoteParticipantsInfo(): RemoteParticipantInfo[] {
    const room = this.room;
    if (!room || !lk) return [];
    const out: RemoteParticipantInfo[] = [];
    for (const p of room.remoteParticipants.values()) {
      const cam = p.getTrackPublication(LK().Track.Source.Camera);
      const mic = p.getTrackPublication(LK().Track.Source.Microphone);
      out.push({
        identity: p.identity,
        name: p.name || p.identity,
        videoTrack: cam && cam.isSubscribed && !cam.isMuted ? ((cam.track as RemoteTrack) ?? null) : null,
        audioTrack: (mic?.track as RemoteTrack) ?? null,
        micMuted: mic ? mic.isMuted : false,
        camOn: Boolean(cam && !cam.isMuted && cam.isSubscribed),
        speaking: p.isSpeaking,
      });
    }
    return out;
  }

  /** The other side's camera, if they're publishing one. */
  get remoteVideo(): RemoteTrack | null {
    if (!lk) return null;
    for (const t of this.remoteTracks.values()) if (t.kind === LK().Track.Kind.Video) return t;
    return null;
  }

  /** The other side's microphone. LiveKit doesn't play remote audio for you:
   *  this has to be attached to an <audio> element or the call is silent. */
  get remoteAudio(): RemoteTrack | null {
    if (!lk) return null;
    for (const t of this.remoteTracks.values()) if (t.kind === LK().Track.Kind.Audio) return t;
    return null;
  }

  /* ---------------------------------------------------------------- wiring */

  setBackend(backend: CallBackend) {
    this.backend = backend;
  }

  /** Listen on my private calls channel. Idempotent per profile. */
  initialize(myProfileId: string, channel: CallChannel) {
    this.restoreRejoinable();
    if (this.myProfileId === myProfileId && this.unsubscribeChannel) return;
    this.unsubscribeChannel?.();
    this.myProfileId = myProfileId;
    this.unsubscribeChannel = channel(this.onSignal);
  }

  /** Signed out: stop listening, drop any call. */
  shutdown() {
    this.unsubscribeChannel?.();
    this.unsubscribeChannel = null;
    this.myProfileId = null;
    if (this.state.status !== "idle") this.endCall();
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState() {
    return { ...this.state };
  }

  /** For useSyncExternalStore: the same object until something changes. */
  getSnapshot = (): CallState => this.state;
  subscribeStore = (onChange: () => void) => {
    const listener: Listener = () => onChange();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(partial: Partial<CallState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l({ ...this.state }));
  }

  /* --------------------------------------------------------------- actions */

  /** Place a call. The caller joins the room first, then rings. */
  async startCall(opts: { conversationId: string; peer: CallPeer; isVideo: boolean; isGroup?: boolean }) {
    if (this.state.status !== "idle") return;
    const { conversationId, peer, isVideo } = opts;
    this.clearTimers();
    // A new call makes an interrupted one moot: drop the stale offer.
    this.clearStoredCall();
    this.set({
      ...IDLE_CALL_STATE,
      status: "ringing",
      isIncoming: false,
      peer,
      isGroup: Boolean(opts.isGroup),
      conversationId,
      isVideo,
      camOn: isVideo,
    });

    const joined = await this.joinRoom(conversationId, isVideo);
    if (!joined) return;

    try {
      await this.backend?.ring(conversationId, isVideo);
    } catch (err) {
      // A refusal is a rule (not allies, blocked), not a network problem.
      this.fail(reasonOf(err) ?? "Couldn't reach them");
      return;
    }

    this.ringTimer = setTimeout(() => {
      if (this.state.status === "ringing") {
        void this.signal("call:cancel");
        this.finish("unanswered");
      }
    }, RING_TIMEOUT_MS);
  }

  /** Walk into a group call already going: no ring. */
  async joinCall(opts: { conversationId: string; peer: CallPeer; isVideo: boolean }) {
    if (this.state.status !== "idle") return;
    this.clearTimers();
    this.clearStoredCall();
    this.set({
      ...IDLE_CALL_STATE,
      status: "connecting",
      // Not the caller, so nothing is logged twice.
      isIncoming: true,
      peer: opts.peer,
      isGroup: true,
      conversationId: opts.conversationId,
      isVideo: opts.isVideo,
      camOn: opts.isVideo,
    });
    const joined = await this.joinRoom(opts.conversationId, opts.isVideo);
    if (!joined) return;
    this.syncRemote();
    if (this.getState().status === "connecting") {
      this.rejoinTimer = setTimeout(() => {
        if (this.state.status === "connecting") this.finish("ended");
      }, REJOIN_GRACE_MS);
    }
  }

  async acceptCall() {
    const { status, isIncoming, conversationId, isVideo } = this.state;
    if (status !== "ringing" || !isIncoming || !conversationId) return;
    this.clearTimers();
    this.clearStoredCall();
    this.set({ status: "connecting", camOn: isVideo, rejoinable: null });
    // Stop their ringback before the slower media join.
    void this.signal("call:accept");
    const joined = await this.joinRoom(conversationId, isVideo);
    if (!joined) return;
    // The caller is already in the room; the connect event won't fire for them.
    this.syncRemote();
  }

  declineCall() {
    if (this.state.status === "idle") return;
    void this.signal("call:decline");
    this.finish("declined");
  }

  /** Hang up, from either side, at any stage. */
  endCall() {
    if (this.state.status === "idle" || this.state.status === "ended") return;
    const wasRinging = this.state.status === "ringing" && !this.state.isIncoming;
    // A group leg leaving isn't the call ending; its room disconnect says so.
    if (wasRinging) void this.signal("call:cancel");
    else if (!this.state.isGroup) void this.signal("call:end");
    this.finish(wasRinging ? "cancelled" : "ended");
  }

  async toggleMic() {
    const next = !this.state.micOn;
    this.set({ micOn: next });
    try {
      await this.room?.localParticipant.setMicrophoneEnabled(next);
    } catch {
      this.set({ micOn: !next });
    }
  }

  async toggleCam() {
    const next = !this.state.camOn;
    this.set({ camOn: next });
    try {
      await this.room?.localParticipant.setCameraEnabled(next);
      this.localVideoTrack =
        (this.room?.localParticipant.videoTrackPublications.values().next().value?.track as LocalVideoTrack) ?? null;
      this.set({ isVideo: this.state.isVideo || next });
    } catch {
      this.set({ camOn: !next, error: "Camera unavailable" });
    }
  }

  /** Front ↔ back camera: a republish with the other facingMode, guarded so
   *  two taps can't race two publishes and leave the room camera-less. */
  async flipCamera() {
    if (this.state.switchingCam || !this.state.camOn) return;
    const next = this.state.facing === "user" ? "environment" : "user";
    this.set({ switchingCam: true, facing: next });
    try {
      const pub = this.room?.localParticipant.videoTrackPublications.values().next().value;
      const track = pub?.track as (LocalVideoTrack & { restartTrack?: (c: MediaTrackConstraints) => Promise<void> }) | undefined;
      if (track?.restartTrack) await track.restartTrack({ facingMode: next });
      else {
        await this.room?.localParticipant.setCameraEnabled(false);
        await this.room?.localParticipant.setCameraEnabled(true, { facingMode: next });
      }
      this.localVideoTrack =
        (this.room?.localParticipant.videoTrackPublications.values().next().value?.track as LocalVideoTrack) ?? null;
      this.set({});
    } catch {
      this.set({ facing: this.state.facing === "user" ? "environment" : "user" });
    } finally {
      this.set({ switchingCam: false });
    }
  }

  setMinimized(minimized: boolean) {
    this.set({ minimized });
  }

  /** Pick an interrupted call back up: no ring, the timer keeps its start. */
  async rejoin() {
    const record = this.state.rejoinable;
    if (!record || this.state.status !== "idle") return;
    this.clearTimers();
    this.clearStoredCall();
    this.set({
      ...IDLE_CALL_STATE,
      status: "connecting",
      // A rejoined leg must not log the call a second time.
      isIncoming: true,
      peer: record.peer,
      isGroup: Boolean(record.isGroup),
      conversationId: record.conversationId,
      isVideo: record.isVideo,
      camOn: record.isVideo,
      startedAt: record.startedAt,
    });
    const joined = await this.joinRoom(record.conversationId, record.isVideo);
    if (!joined) return;
    this.syncRemote();
    if (this.getState().status === "connecting") {
      this.rejoinTimer = setTimeout(() => {
        if (this.state.status === "connecting") this.finish("ended");
      }, REJOIN_GRACE_MS);
    }
  }

  dismissRejoin() {
    this.clearStoredCall();
    if (this.state.rejoinable) this.set({ rejoinable: null });
  }

  /** The surface clears a failure line once it has been read. */
  clearError() {
    if (this.state.error) this.set({ error: null });
  }

  /* ----------------------------------------------------------------- media */

  private async joinRoom(conversationId: string, isVideo: boolean) {
    try {
      if (!this.backend) throw new Error("Calling isn't ready yet");
      const res = await this.backend.token(conversationId);
      if (!res?.token || !res?.url) {
        this.fail("Calling isn't available right now");
        return false;
      }
      const { Room: LiveKitRoom } = await loadLiveKit();
      const room = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
      this.room = room;
      this.bindRoom(room);
      await room.connect(res.url, res.token);

      // Mic first: a voice call must work even when the camera is refused.
      await room.localParticipant.setMicrophoneEnabled(true);
      if (isVideo) {
        try {
          await room.localParticipant.setCameraEnabled(true);
          this.localVideoTrack =
            (room.localParticipant.videoTrackPublications.values().next().value?.track as LocalVideoTrack) ?? null;
        } catch {
          this.set({ camOn: false, error: "Camera unavailable" });
        }
      }
      this.set({ micOn: true });
      return true;
    } catch (err) {
      const e = err as { name?: string; message?: string };
      const denied = e?.name === "NotAllowedError" || /permission|denied/i.test(e?.message ?? "");
      // The token endpoint refuses with a sentence (503 when LiveKit isn't
      // configured, 403 for a rule) — show it, or the caller blames their wifi.
      this.fail(denied ? "Your microphone is blocked for this site" : (reasonOf(err) ?? "Couldn't connect the call"));
      return false;
    }
  }

  private bindRoom(room: Room) {
    const { RoomEvent, ConnectionQuality } = LK();
    room
      .on(RoomEvent.ParticipantConnected, () => this.syncRemote())
      .on(RoomEvent.ParticipantDisconnected, () => {
        // 1:1 — the other side leaving IS the call ending. A group room
        // outlives any one leg.
        if (!this.state.isGroup && room.remoteParticipants.size === 0) {
          this.finish("ended");
          return;
        }
        this.set({ participantCount: room.remoteParticipants.size });
        this.syncRemote();
      })
      .on(RoomEvent.ActiveSpeakersChanged, () => {
        if (this.state.isGroup) this.set({});
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        this.remoteTracks.set(track.sid ?? track.kind, track);
        this.syncRemote();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        this.remoteTracks.delete(track.sid ?? track.kind);
        this.syncRemote();
      })
      .on(RoomEvent.TrackMuted, () => this.syncRemote())
      .on(RoomEvent.TrackUnmuted, () => this.syncRemote())
      .on(RoomEvent.ConnectionQualityChanged, (quality) => {
        this.set({ poorConnection: quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost });
      })
      .on(RoomEvent.Disconnected, () => {
        if (this.state.status === "connected") this.finish("ended");
      });
  }

  /** Recompute remote-derived state from whatever the room holds now. */
  private syncRemote() {
    const room = this.room;
    if (!room) return;
    if (room.remoteParticipants.size !== this.state.participantCount) {
      this.set({ participantCount: room.remoteParticipants.size });
    }
    const remote = room.remoteParticipants.values().next().value;
    if (!remote) return;

    // First sight of the other side is the moment a call is real.
    if (this.state.status !== "connected") {
      this.clearTimers();
      this.set({ status: "connected", startedAt: this.state.startedAt ?? Date.now() });
      this.persistActiveCall();
      this.persistTimer = setInterval(() => this.persistActiveCall(), PERSIST_HEARTBEAT_MS);
    }

    const { Track } = LK();
    if (this.state.isGroup) {
      let anyVideo = false;
      for (const p of room.remoteParticipants.values()) {
        const cam = p.getTrackPublication(Track.Source.Camera);
        if (cam && !cam.isMuted && cam.isSubscribed) {
          anyVideo = true;
          break;
        }
      }
      this.set({ remoteMuted: false, remoteVideoOn: anyVideo });
      return;
    }
    const mic = remote.getTrackPublication(Track.Source.Microphone);
    const cam = remote.getTrackPublication(Track.Source.Camera);
    this.set({
      remoteMuted: mic ? mic.isMuted : false,
      remoteVideoOn: Boolean(cam && !cam.isMuted && cam.isSubscribed),
    });
  }

  /* ---------------------------------------------------- reload persistence */

  private persistActiveCall() {
    const { conversationId, isVideo, peer, startedAt, status } = this.state;
    if (status !== "connected" || !conversationId || !peer || !startedAt) return;
    try {
      const record: StoredActiveCall = {
        conversationId,
        isVideo,
        isGroup: this.state.isGroup,
        peerJson: JSON.stringify(peer),
        startedAt,
        at: Date.now(),
      };
      sessionStorage.setItem(ACTIVE_CALL_KEY, JSON.stringify(record));
    } catch {
      /* storage unavailable: the call just isn't rejoinable */
    }
  }

  private clearStoredCall() {
    try {
      sessionStorage.removeItem(ACTIVE_CALL_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  /** Once per page load: a call connected under two minutes ago in this tab
   *  becomes `rejoinable`. Never auto-joins — walking back into a room with a
   *  live mic is the person's decision. */
  private restoreRejoinable() {
    if (this.rejoinChecked) return;
    this.rejoinChecked = true;
    try {
      const raw = sessionStorage.getItem(ACTIVE_CALL_KEY);
      if (!raw) return;
      const record = JSON.parse(raw) as Partial<StoredActiveCall>;
      const fresh = typeof record?.at === "number" && Date.now() - record.at < REJOIN_WINDOW_MS;
      const peer = record?.peerJson ? (JSON.parse(record.peerJson) as CallPeer) : null;
      if (!fresh || !peer?.id || !record?.conversationId) {
        this.clearStoredCall();
        return;
      }
      if (this.state.status !== "idle") return;
      this.set({
        rejoinable: {
          conversationId: record.conversationId,
          isVideo: Boolean(record.isVideo),
          isGroup: Boolean(record.isGroup),
          peer,
          startedAt: typeof record.startedAt === "number" ? record.startedAt : Date.now(),
        },
      });
    } catch {
      this.clearStoredCall();
    }
  }

  /* ------------------------------------------------------------- lifecycle */

  private onSignal = (name: string, payload: unknown) => {
    const data = (payload ?? {}) as Partial<CallIncoming> & Record<string, unknown>;
    switch (name) {
      case "call:incoming": {
        // Already on a call: say so instead of silently dropping it.
        if (this.state.status !== "idle" && this.state.status !== "ended") {
          if (data.conversationId) void this.backend?.signal(data.conversationId, "call:busy").catch(() => {});
          return;
        }
        const group = data.kind === "group";
        const caller: CallPeer | null = data.caller
          ? {
              id: String(data.caller.id),
              name: data.caller.name,
              avatar: data.caller.avatar ?? "",
              username: data.caller.username ?? "",
            }
          : null;
        this.clearTimers();
        this.set({
          ...IDLE_CALL_STATE,
          // Kept while it only rings: declining shouldn't lose a dropped call.
          rejoinable: this.state.rejoinable,
          status: "ringing",
          isIncoming: true,
          peer: group
            ? { id: String(data.conversationId ?? ""), name: data.group?.name ?? "Group call", avatar: "", username: "" }
            : caller,
          isGroup: group,
          groupCaller: group ? caller : null,
          conversationId: data.conversationId ?? null,
          isVideo: Boolean(data.isVideo),
          camOn: Boolean(data.isVideo),
          // The gateway stamps the platform the ring came from (the same
          // stamp a message carries as `source`); the contract doesn't
          // declare it yet, so it's read loosely and absent means home.
          via: viaPlatform(typeof data.platform === "string" ? data.platform : null),
        });
        // Phones stop ringing on their own; in a group nobody else will stop ours.
        this.ringTimer = setTimeout(() => {
          if (this.state.status === "ringing" && this.state.isIncoming) this.finish("unanswered");
        }, RING_TIMEOUT_MS);
        break;
      }
      case "call:accept":
        if (this.state.status === "ringing" && !this.state.isIncoming) {
          this.clearTimers();
          this.set({ status: "connecting" });
        }
        break;
      case "call:decline":
        // One member of a group declining is their business, not the call's.
        if (!this.state.isGroup && this.state.status !== "idle") this.finish("declined");
        break;
      case "call:busy":
        if (!this.state.isGroup && this.state.status !== "idle") this.finish("busy");
        break;
      case "call:cancel":
        // Only a phone still ringing is cancelled — never someone already in.
        if (this.state.isIncoming && this.state.status === "ringing") this.finish("cancelled");
        break;
      case "call:end":
        if (!this.state.isGroup && this.state.status !== "idle") this.finish("ended");
        break;
    }
  };

  private async signal(type: CallSignal) {
    const conversationId = this.state.conversationId;
    if (!conversationId) return;
    try {
      await this.backend?.signal(conversationId, type);
    } catch {
      /* the local hang-up still has to happen */
    }
  }

  private fail(message: string) {
    this.set({ error: message });
    this.finish("failed");
  }

  /** The row that belongs in the thread. Only the caller logs, or both
   *  sides would write the same call twice. */
  private logIfCaller(reason: CallEndReason) {
    const { isIncoming, conversationId, isVideo, startedAt } = this.state;
    if (isIncoming || !conversationId) return;
    let outcome: string | null = null;
    if (reason === "ended") outcome = startedAt ? "answered" : "cancelled";
    else if (reason === "declined") outcome = "declined";
    else if (reason === "unanswered" || reason === "busy") outcome = "missed";
    else if (reason === "cancelled") outcome = "cancelled";
    // "failed" is our problem, not a call the other person can see.
    if (!outcome) return;
    const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    void this.backend?.log({ conversationId, outcome, video: isVideo, durationSec }).catch(() => {});
  }

  /** Close the media plane, show the outcome briefly, then go idle. */
  private finish(reason: CallEndReason) {
    if (this.state.status === "idle") return;
    this.clearTimers();
    if (!this.unloading) this.clearStoredCall();
    this.logIfCaller(reason);
    this.disconnectRoom();
    this.set({ status: "ended", endReason: reason, startedAt: null });
    this.teardownTimer = setTimeout(() => this.reset(), TEARDOWN_MS);
  }

  private disconnectRoom() {
    try {
      void this.room?.disconnect();
    } catch {
      /* already gone */
    }
    this.room = null;
    this.localVideoTrack = null;
    this.remoteTracks.clear();
  }

  private clearTimers() {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    if (this.teardownTimer) clearTimeout(this.teardownTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer);
    this.ringTimer = null;
    this.teardownTimer = null;
    this.persistTimer = null;
    this.rejoinTimer = null;
  }

  private reset() {
    this.clearTimers();
    if (!this.unloading) this.clearStoredCall();
    this.disconnectRoom();
    // The error outlives the rest by a beat so it can be read.
    this.state = { ...IDLE_CALL_STATE, error: this.state.error, rejoinable: this.state.rejoinable };
    this.listeners.forEach((l) => l({ ...this.state }));
  }
}

export const callManager = new CallManager();

/** "2:07", "1:02:45": a running call's clock. */
export function formatCallClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** The closing line for an ended call. */
export const CALL_END_COPY: Record<Exclude<CallEndReason, null>, string> = {
  declined: "Call declined",
  ended: "Call ended",
  cancelled: "Call cancelled",
  unanswered: "No answer",
  busy: "They're on another call",
  failed: "Call failed",
};
