"use client";

import { useCallback, useState, type CSSProperties } from "react";
import type { SheetStop } from "@/components/app/drag-sheet";

/** The room's sheet height, on the studio's root: the lane rides above it. */
export const ROOM_SHEET_VAR = "--room-sheet-h";

/** Phones: the lane sits this far above the sheet (px). */
const LANE_GAP = 10;

const KEY = { phone: "xtream:studio:chat-on-screen:phone", desk: "xtream:studio:chat-on-screen:desk" } as const;

function readPref(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

/**
 * The chat on screen, for the studio (Greg's practice run, 2026-09-28).
 *
 * On by default on phones, off at a desk; each remembered per device. On a
 * phone it also reshapes the room's sheet: while the chat is on screen the
 * sheet hugs its stats, tools and composer ("fit"); tapping Chat opens the
 * full chat, tapping it again (or pulling the sheet back down) returns to
 * compact, and a tool opens at the usual height over the lane.
 *
 * Everything the studio needs comes back from here, so studio.tsx only wires
 * it: the lane's target and state for LiveChat, the tabs' value and handler,
 * and the sheet's props.
 */
export function useChatOnScreen<P extends string>({
  phone,
  live,
  source,
  panel,
  setPanel,
}: {
  phone: boolean;
  live: boolean;
  source: "camera" | "screen" | "obs";
  /** The room's open panel; "chat" is the chat (compact on a phone while the lane shows). */
  panel: P;
  setPanel: (p: P) => void;
}) {
  const [prefs, setPrefs] = useState(() => ({ phone: readPref(KEY.phone), desk: readPref(KEY.desk) }));
  const on = phone ? (prefs.phone ?? true) : (prefs.desk ?? false);
  const setOn = useCallback(
    (next: boolean) => {
      const key = phone ? KEY.phone : KEY.desk;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Storage off: it holds for this visit.
      }
      setPrefs((p) => (phone ? { ...p, phone: next } : { ...p, desk: next }));
    },
    [phone],
  );

  /** Where LiveChat draws the lane (a callback ref on the stage). */
  const [target, setTarget] = useState<HTMLElement | null>(null);
  /** Phones: the full chat is open in the sheet (otherwise "chat" is compact). */
  const [fullChat, setFullChat] = useState(false);
  const [snap, setSnap] = useState<{ to: SheetStop; key: number } | null>(null);
  /** Where the sheet is resting, or headed when it was sent somewhere (so a tap mid-spring reads the target). */
  const [stop, setStop] = useState<SheetStop>("fit");

  // The lane is for pictures the studio draws itself: a camera or a shared screen.
  const shows = live && on && source !== "obs";
  const phoneLane = shows && phone;
  const compact = phoneLane && panel === ("chat" as P) && !fullChat;

  const go = useCallback((to: SheetStop) => {
    setStop(to);
    setSnap((s) => ({ to, key: (s?.key ?? 0) + 1 }));
  }, []);

  // Reshape the sheet when what it holds changes — from a tab, a stat chip,
  // the coach or Vivid alike. (State adjusted during render, not in an effect.)
  const [seen, setSeen] = useState({ panel, phoneLane });
  if (seen.panel !== panel || seen.phoneLane !== phoneLane) {
    setSeen({ panel, phoneLane });
    if (phoneLane) {
      if (panel !== ("chat" as P)) {
        if (fullChat) setFullChat(false);
        // A tool needs room: out of compact (or folded), up to the usual height.
        if (stop === "fit" || stop === "collapsed") go(0);
      } else if (!fullChat && seen.panel !== panel) {
        go("fit");
      } else if (seen.phoneLane !== phoneLane && !fullChat) {
        go("fit");
      }
    } else if (seen.phoneLane && phone && stop === "fit") {
      // The lane went off: the fit stop goes with it.
      go(0);
    }
  }

  /** The tabs: Chat opens and closes the full chat; tapping the open tool goes back to compact. */
  const onTab = (id: P) => {
    if (!phoneLane) {
      setPanel(id);
      return;
    }
    if (id === ("chat" as P)) {
      if (panel === id && fullChat) {
        setFullChat(false);
        go("fit");
      } else {
        // The full chat gets the tall sheet: at the usual height the tips and composer left it no room.
        setFullChat(true);
        setPanel(id);
        if (stop !== 1) go(1);
      }
      return;
    }
    setPanel(id === panel ? ("chat" as P) : id);
  };

  /** Pulled up from compact is the full chat; pulled down to fit is compact again. */
  const onSettle = (s: SheetStop) => {
    setStop(s);
    if (!phoneLane) return;
    if (s === "fit") {
      if (fullChat) setFullChat(false);
      if (panel !== ("chat" as P)) setPanel("chat" as P);
    } else if (typeof s === "number" && compact) {
      setFullChat(true);
    }
  };

  // Phones: hidden while the full chat is open or a tool has the tall sheet.
  const hidden = phoneLane && !compact && ((panel === ("chat" as P) && fullChat) || stop === 1);

  /** The lane's box on the stage: lower left, clear of the camera column (phone) or the dock (desk). */
  const laneStyle: CSSProperties | undefined = phone
    ? { transform: `translate3d(0, calc(-1 * var(${ROOM_SHEET_VAR}, 0px) - ${LANE_GAP}px), 0)` }
    : undefined;

  return {
    on,
    setOn,
    /** Draw the lane now (live, a camera or screen, switched on). */
    shows,
    targetRef: setTarget,
    /** For LiveChat's `lane` prop. */
    lane: shows ? { target, hidden } : null,
    compact,
    laneStyle,
    tabValue: compact ? null : panel,
    onTab,
    /** For the phone room's DragSheet. */
    sheet: phoneLane
      ? { fit: compact ? ("measure" as const) : ("keep" as const), defaultDetent: "fit" as const, snap, onSettle, heightVar: ROOM_SHEET_VAR }
      : { snap, onSettle, heightVar: ROOM_SHEET_VAR },
  };
}
