"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArtCanvas, Bar, Card, Dot, Enter, Idle, Pulse } from "@/components/app/art";
import { Pill } from "@/components/ui/pill";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";

/**
 * The studio's smart-setup nudge: live from a computer with no second
 * camera, a calm card suggests a phone — the face in the corner while the
 * screen is shared, or another angle. It waits until the host has settled
 * on air, never greets them the moment they go live, and asks once:
 *
 *  - "Use my phone" opens the Second camera panel with a fresh code on it
 *  - "Not now" is this stream only
 *  - "Don't show again" is the account's (`settings.secondCameraTip`), so
 *    it holds on every device and browser
 *
 * A phone that joins during the stream ends it for that stream too. The
 * studio decides when it's eligible at all: live, not a practice run, not
 * an encoder, not on a phone or tablet. The producer's console and a
 * practice preview never mount it.
 */

/** How long a host is on air before the tip appears. */
export const SECOND_CAMERA_TIP_DELAY_MS = 75_000;

/** The stream "Not now" (or the phone, or "Use my phone") settled — kept for a reload in the same tab. */
const DONE_KEY = "xtream:second-camera-tip:done";

function readDone(): string | null {
  try {
    return sessionStorage.getItem(DONE_KEY);
  } catch {
    return null;
  }
}

function writeDone(streamId: string) {
  try {
    sessionStorage.setItem(DONE_KEY, streamId);
  } catch {
    // This page remembers it anyway.
  }
}

export function SecondCameraTip({
  streamId,
  eligible,
  phoneConnected,
  onUse,
  delayMs = SECOND_CAMERA_TIP_DELAY_MS,
}: {
  /** The stream on air; null off air. */
  streamId: string | null;
  /** Live from a computer's browser, not rehearsing: the studio's call. */
  eligible: boolean;
  /** A phone camera is sending in the room right now. */
  phoneConnected: boolean;
  /** Open the Second camera flow (its panel, with a code on it). */
  onUse: () => void;
  delayMs?: number;
}) {
  const { user, refreshUser } = useAuth();
  const off = user?.settings.secondCameraTip === "off";
  /** The stream the tip is finished with. */
  const [doneFor, setDoneFor] = useState<string | null>(readDone);
  /** The stream whose wait is over. */
  const [dueFor, setDueFor] = useState<string | null>(null);
  /** Turned off here, before the account says so. */
  const [offHere, setOffHere] = useState(false);

  const finish = (id: string) => {
    setDoneFor(id);
    writeDone(id);
  };

  // A phone in the room is the tip taken: nothing more to suggest this stream.
  if (phoneConnected && streamId && doneFor !== streamId) finish(streamId);

  const waiting = eligible && !off && !offHere && Boolean(streamId) && doneFor !== streamId && !phoneConnected;
  useEffect(() => {
    if (!waiting || !streamId || dueFor === streamId) return;
    const t = setTimeout(() => setDueFor(streamId), delayMs);
    return () => clearTimeout(t);
  }, [waiting, streamId, dueFor, delayMs]);

  if (!waiting || !streamId || dueFor !== streamId) return null;
  return (
    <TipCard
      key={streamId}
      onUse={() => {
        finish(streamId);
        onUse();
      }}
      onLater={() => finish(streamId)}
      onNever={() => {
        setOffHere(true);
        // Saved with the account. If it doesn't save, it's still gone for this stream.
        finish(streamId);
        void apiFetch("/api/user/me", { method: "PATCH", body: JSON.stringify({ settings: { secondCameraTip: "off" } }) })
          .then(() => refreshUser())
          .catch(() => setOffHere(false));
      }}
    />
  );
}

function TipCard({ onUse, onLater, onNever }: { onUse: () => void; onLater: () => void; onNever: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);

  // In: it opens its own room in the console and rises into it, so the chat
  // below makes way rather than jumps.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = prefersReducedMotion();
    const a = el.animate(
      reduce
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { height: "0px", opacity: 0, transform: "translateY(-8px)" },
            { height: `${el.scrollHeight}px`, opacity: 1, transform: "none" },
          ],
      { duration: reduce ? DURATION.fade : DURATION.unfold, easing: EASE.unfold },
    );
    return () => a.cancel();
  }, []);

  // Out: quicker than in, then whatever the button does.
  const leave = (then: () => void) => {
    const el = ref.current;
    if (!el || leaving.current) return;
    leaving.current = true;
    const reduce = prefersReducedMotion();
    const a = el.animate(
      reduce
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { height: `${el.offsetHeight}px`, opacity: 1 },
            { height: "0px", opacity: 0 },
          ],
      { duration: reduce ? DURATION.fade : DURATION.fold, easing: EASE.fold, fill: "forwards" },
    );
    a.onfinish = then;
  };

  return (
    <div ref={ref} className="shrink-0 overflow-hidden" data-second-camera-tip>
      <section aria-labelledby="second-camera-tip-title" className="mx-4 mb-2 rounded-[12px] bg-tint/[0.05] p-3.5">
        <div className="flex items-start gap-3">
          <PhoneMark />
          <div className="min-w-0 flex-1">
            <h3 id="second-camera-tip-title" className="text-[13.5px] leading-snug font-semibold text-foreground">
              Use your phone as a second camera
            </h3>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">Show your face while you share your screen, or a second angle.</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Pill size="sm" variant="primary" onClick={() => leave(onUse)}>
            Use my phone
          </Pill>
          <Pill size="sm" variant="glass" onClick={() => leave(onLater)}>
            Not now
          </Pill>
          <button
            type="button"
            onClick={() => leave(onNever)}
            className="press ml-auto h-8 rounded-full px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Don&apos;t show again
          </button>
        </div>
      </section>
    </div>
  );
}

/** A screen with a phone standing beside it, its lens lit in ember: the second angle. */
function PhoneMark() {
  return (
    <ArtCanvas viewBox="0 0 76 64" className="w-12 shrink-0">
      <Enter kind="fade">
        <Card x={3} y={10} w={50} h={34} r={6} paint="card2" />
        <Bar x={10} y={18} w={22} />
        <Bar x={10} y={26} w={14} />
        <path d="M22 44v6M16 51h18" fill="none" stroke="var(--art-line)" strokeWidth={2} strokeLinecap="round" />
      </Enter>
      <Enter kind="fromRight" delay={160}>
        <Idle kind="float">
          <Card x={46} y={16} w={25} h={44} r={6} />
          <Bar x={54} y={21} w={9} h={3} />
          <Pulse cx={58.5} cy={39} r={6} paint="emberLine" />
          <Dot cx={58.5} cy={39} r={3.4} paint="ember" />
        </Idle>
      </Enter>
    </ArtCanvas>
  );
}
