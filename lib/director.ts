"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent, type Participant, type Room } from "livekit-client";

/**
 * The auto-director (Phase 3): the layout follows whoever's talking, the
 * way a vision mixer would cut a panel show, with the timings meeting-room
 * cameras use so it never flickers:
 *
 * - someone has to talk for a moment (1.8 s) before the picture cuts to them;
 * - a shot holds at least 2 s, and the everyone-shot 5 s;
 * - two people talking at once is everyone;
 * - ten seconds of quiet goes back to everyone.
 *
 * The host talking is the host alone; a guest talking is the host with that
 * guest beside them (the scene's spotlight). A big gift cuts to the host
 * for their reaction. Any framing the host does by hand — a layout, a card,
 * a spotlight — pauses it for a minute: the host always wins.
 *
 * The decisions are a pure function over "who's talking now" (LiveKit's
 * active speakers, already smoothed over ~500 ms), so they can be tested
 * without a room; the hook only feeds it and writes its cuts.
 */

export const CUT_AFTER = 1_800;
/** A pause shorter than this is still the same run of speech. */
export const SPEECH_GAP = 900;
export const HOLD_SHOT = 2_000;
export const HOLD_EVERYONE = 5_000;
export const QUIET_TO_EVERYONE = 10_000;
export const REACTION_MS = 6_000;
export const PAUSE_MS = 60_000;

export type DirectorLayout = "auto" | "solo" | "split";
export interface Shot {
  layout: DirectorLayout;
  /** The guest beside the host in a split. */
  spotlight: string | null;
}

export interface DirectorState {
  shot: Shot;
  /** When the current shot began. */
  since: number;
  /** Each speaker's current run of speech. */
  runs: Record<string, { from: number; last: number }>;
  lastSpeech: number;
  /** A shot held regardless, for a while (the host's reaction to a gift). */
  forced: { shot: Shot; until: number } | null;
}

export interface DirectorInput {
  now: number;
  /** Room identities talking right now. */
  speaking: string[];
  /** The host's identities (their browser, or their encoder's). */
  host: string[];
  /** Guests on stage, in stage order. */
  guests: string[];
}

const EVERYONE: Shot = { layout: "auto", spotlight: null };
const SOLO: Shot = { layout: "solo", spotlight: null };

export const sameShot = (a: Shot, b: Shot) => a.layout === b.layout && (a.layout !== "split" || a.spotlight === b.spotlight);

/** The shot a scene shows, as far as the director is concerned. */
export function shotOf(scene: { layout: string; spotlight?: string | null }): Shot {
  if (scene.layout === "solo") return SOLO;
  if (scene.layout === "split") return { layout: "split", spotlight: scene.spotlight ?? null };
  return EVERYONE;
}

/** A director taking over from the shot on screen, free to cut straight away. */
export function startDirector(now: number, current: Shot): DirectorState {
  return { shot: current, since: now - HOLD_EVERYONE, runs: {}, lastSpeech: now, forced: null };
}

/** A big gift: the host alone for their reaction, whatever else is going on. */
export function reactDirector(state: DirectorState, now: number): DirectorState {
  return { ...state, forced: { shot: SOLO, until: now + REACTION_MS } };
}

/** One look at the room: what's on now, and the cut to make if there is one. */
export function stepDirector(state: DirectorState, input: DirectorInput): { state: DirectorState; cut: Shot | null } {
  const { now } = input;
  const runs: DirectorState["runs"] = {};
  for (const [id, run] of Object.entries(state.runs)) if (now - run.last <= SPEECH_GAP) runs[id] = run;
  for (const id of input.speaking) {
    const run = runs[id];
    runs[id] = run ? { from: run.from, last: now } : { from: now, last: now };
  }
  const lastSpeech = input.speaking.length > 0 ? now : state.lastSpeech;
  const forced = state.forced && now < state.forced.until ? state.forced : null;

  let desired: Shot;
  if (forced) {
    desired = forced.shot;
  } else {
    const talking = Object.entries(runs)
      .filter(([, r]) => now - r.from >= CUT_AFTER)
      .map(([id]) => id);
    const host = talking.some((id) => input.host.includes(id));
    const guests = input.guests.filter((g) => talking.includes(g));
    if ((host ? 1 : 0) + guests.length >= 2) desired = EVERYONE;
    else if (host) desired = SOLO;
    else if (guests.length === 1) desired = { layout: "split", spotlight: guests[0]! };
    else if (now - lastSpeech >= QUIET_TO_EVERYONE) desired = EVERYONE;
    else desired = state.shot;
  }
  // With one guest, "the host and that guest" is everyone — no cut needed.
  // A guest who has left the stage can't stay in the spotlight.
  if (desired.layout === "split" && (input.guests.length <= 1 || !desired.spotlight || !input.guests.includes(desired.spotlight))) {
    desired = EVERYONE;
  }

  const next: DirectorState = { ...state, runs, lastSpeech, forced };
  if (sameShot(desired, state.shot)) return { state: next, cut: null };
  const hold = state.shot.layout === "auto" ? HOLD_EVERYONE : HOLD_SHOT;
  if (!forced && now - state.since < hold) return { state: next, cut: null };
  return { state: { ...next, shot: desired, since: now }, cut: desired };
}

/** Why the director can't act right now, if it can't. */
export type DirectorBlock = "alone" | "card" | "battle" | "content" | null;

/**
 * The director on a live room: it listens to who's talking, looks four
 * times a second, and hands each cut to `onCut` (the studio writes it
 * through the scene route, marked as the director's so it doesn't pause
 * itself). Blocked or paused, it stands back and starts fresh after.
 */
export function useAutoDirector({
  on,
  room,
  host,
  guests,
  current,
  blocked,
  onCut,
}: {
  on: boolean;
  room: Room | null;
  host: string[];
  guests: string[];
  current: Shot;
  blocked: DirectorBlock;
  onCut: (shot: Shot) => void;
}) {
  const [pausedUntil, setPausedUntil] = useState(0);
  const state = useRef<DirectorState | null>(null);
  const speaking = useRef<string[]>([]);
  const latest = useRef({ host, guests, current, blocked, pausedUntil, onCut });
  useEffect(() => {
    latest.current = { host, guests, current, blocked, pausedUntil, onCut };
  });

  const active = on && Boolean(room);
  useEffect(() => {
    if (!active || !room) return;
    const heard = (speakers: Participant[]) => {
      speaking.current = speakers.map((p) => p.identity);
    };
    speaking.current = room.activeSpeakers.map((p) => p.identity);
    room.on(RoomEvent.ActiveSpeakersChanged, heard);
    const look = () => {
      const l = latest.current;
      const now = Date.now();
      if (l.blocked || now < l.pausedUntil) {
        state.current = null;
        return;
      }
      state.current ??= startDirector(now, l.current);
      const { state: next, cut } = stepDirector(state.current, { now, speaking: speaking.current, host: l.host, guests: l.guests });
      state.current = next;
      if (cut) l.onCut(cut);
    };
    const t = setInterval(look, 250);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, heard);
      clearInterval(t);
      state.current = null;
    };
  }, [active, room]);

  const pause = useCallback(() => setPausedUntil(Date.now() + PAUSE_MS), []);
  const resume = useCallback(() => setPausedUntil(0), []);
  const react = useCallback(() => {
    if (state.current) state.current = reactDirector(state.current, Date.now());
  }, []);

  return { pausedUntil, pause, resume, react };
}
