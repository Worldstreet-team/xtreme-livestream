"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, Broadcast, CalendarPlus, Copy, DownloadIcon, Fire, ShareNetwork, X } from "@/components/icons";
import { Confetti } from "@/components/app/art";
import { AudienceCurve } from "@/components/app/audience-curve";
import { ThumbnailPicker } from "@/components/app/thumbnail-picker";
import { TourArt, type TourScene } from "@/components/app/tour/tour-art";
import { Money, Pill, Skeleton } from "@/components/xtream";
import { minuteStamp, MOMENT_LABELS } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";
import { recapFileName, renderRecapPng } from "@/lib/stream-report-png";
import {
  durationLabel,
  rateStream,
  reportHeadline,
  reportLine,
  useStreamReport,
  type ReportRequest,
  type StreamReportData,
} from "@/lib/stream-report";
import { cn } from "@/lib/utils";

/**
 * The post-live report (TikTok's "LIVE Centre", our way): the moment End is
 * pressed, a full-screen sheet on phones and a centred panel on a desk
 * says how it went — a headline, the numbers, the best minute, the host's
 * level, streak and next step — and offers the three things worth doing
 * next: pick the thumbnail, share a recap, go again (or book the next one).
 * Everything comes from GET /streams/:id/report; a practice run gets the
 * same sheet without money in it. Your channel opens the same report from
 * any broadcast card.
 *
 * Art: the walkthrough's morphing drawing (TourArt) turns from a phone on
 * air into the podium for a good stream (with the board's confetti), into
 * the streak for a quiet one, into the practice mark for a rehearsal.
 * Flat Afterglow: gold only on money, Ember on progress, Chili on Go live.
 */

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";
const PHONE_QUERY = "(max-width: 767px)";

function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(PHONE_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

const ART_FOR: Record<StreamReportData["tone"], TourScene> = { good: "podium", quiet: "streak", practice: "practice" };

/** A block rising into place after the sheet opens, one after another. */
function rise(shown: boolean, index: number, reduce: boolean): CSSProperties {
  if (reduce) return { opacity: shown ? 1 : 0, transition: `opacity ${DURATION.fade}ms linear` };
  const delay = DURATION.rowLead + index * 60;
  return {
    opacity: shown ? 1 : 0,
    transform: shown ? "none" : "translateY(14px)",
    transition: `opacity ${DURATION.row}ms ${EASE.unfold} ${delay}ms, transform ${DURATION.row}ms ${EASE.unfold} ${delay}ms`,
  };
}

/* ---- the sheet ------------------------------------------------------------ */

export function StreamReportSheet({ request, onClose }: { request: ReportRequest; onClose: () => void }) {
  const phone = usePhone();
  const [shown, setShown] = useState(false);
  const [reduce] = useState(prefersReducedMotion);
  const closing = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);

  // In on the next frame, so the transition has somewhere to start from.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    setTimeout(onClose, reduce ? DURATION.fade : phone ? DURATION.slideOut : DURATION.fold);
  }, [onClose, phone, reduce]);

  // Escape closes; the page under it holds still.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = before;
    };
  }, [close]);

  const enter = shown ? EASE.unfold : EASE.fold;
  const time = reduce ? DURATION.fade : phone ? (shown ? DURATION.slide : DURATION.slideOut) : shown ? DURATION.unfold : DURATION.fold;
  const panelStyle: CSSProperties = reduce
    ? { opacity: shown ? 1 : 0, transition: `opacity ${time}ms linear` }
    : phone
      ? { transform: shown ? "none" : "translateY(100%)", transition: `transform ${time}ms ${enter}` }
      : {
          opacity: shown ? 1 : 0,
          transform: shown ? "none" : "translateY(18px) scale(0.97)",
          transition: `opacity ${time}ms ${enter}, transform ${time}ms ${enter}`,
        };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: "var(--layer-dialog)" }}>
      <div
        aria-hidden
        onClick={close}
        className="absolute inset-0 bg-black/75"
        style={{ opacity: shown ? 1 : 0, transition: `opacity ${time}ms ${enter}` }}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stream-report-title"
        tabIndex={-1}
        style={panelStyle}
        className={cn(
          "relative flex flex-col overflow-hidden bg-surface-raised outline-none",
          phone ? "h-[100dvh] w-full" : "max-h-[min(900px,calc(100dvh-48px))] w-[min(780px,calc(100vw-48px))] rounded-[20px] shadow-overlay",
        )}
      >
        <ReportBody streamId={request.streamId} from={request.from} onClose={close} shown={shown} reduce={reduce} phone={phone} />
      </section>
    </div>,
    document.body,
  );
}

/* ---- what's in it ----------------------------------------------------------- */

function ReportBody({
  streamId,
  from,
  onClose,
  shown,
  reduce,
  phone,
}: {
  streamId: string;
  from: ReportRequest["from"];
  onClose: () => void;
  shown: boolean;
  reduce: boolean;
  phone: boolean;
}) {
  const { report, failed, retry } = useStreamReport(streamId);
  const router = useRouter();
  const pathname = usePathname();
  const practice = report?.stream.practice ?? false;

  const goLive = () => {
    onClose();
    if (pathname !== "/studio") router.push("/studio");
  };

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-1 md:px-6 md:pt-5">
        <p className={EYEBROW}>{practice ? "Practice run" : from === "channel" ? "Broadcast report" : "Stream ended"}</p>
        <Pill variant="glass" size="md" iconOnly icon={<X size={16} weight="bold" />} aria-label="Close the report" onClick={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 md:px-6">
        {report ? (
          <Report report={report} shown={shown} reduce={reduce} phone={phone} />
        ) : failed ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <p className="text-[15px] font-semibold">Couldn&apos;t load the report.</p>
            <p className="max-w-[34ch] text-[13px] text-muted-foreground">Your broadcast is saved — the report is on Your channel under Recent broadcasts too.</p>
            <Pill variant="glass" icon={<ArrowClockwise size={16} />} onClick={retry}>
              Try again
            </Pill>
          </div>
        ) : (
          <ReportSkeleton />
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 bg-surface-raised px-4 pt-3 pb-[max(env(safe-area-inset-bottom),14px)] md:px-6 md:pb-5">
        <Pill variant="live" size="lg" icon={<Broadcast size={18} weight="fill" />} onClick={goLive} className="min-w-0 flex-1">
          {practice ? "Go live" : "Go live again"}
        </Pill>
        {practice ? (
          <Pill variant="glass" size="lg" onClick={onClose} className="min-w-0 flex-1">
            Done
          </Pill>
        ) : (
          <Link
            href="/schedule"
            onClick={onClose}
            className="press flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-control px-5 text-[15px] font-semibold text-foreground/90 hover:bg-control-hover"
          >
            <CalendarPlus size={18} />
            <span className="truncate md:hidden">Schedule next</span>
            <span className="hidden truncate md:inline">Schedule the next one</span>
          </Link>
        )}
      </div>
    </>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy className="flex flex-col items-center pt-6">
      <Skeleton className="size-28 rounded-full" />
      <Skeleton className="mt-6 h-8 w-56 rounded-[8px]" />
      <Skeleton className="mt-3 h-4 w-72 max-w-full rounded-[6px]" />
      <div className="mt-8 grid w-full grid-cols-2 gap-2.5 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px] rounded-[12px]" />
        ))}
      </div>
      <span className="sr-only">Counting it up…</span>
    </div>
  );
}

/** One number and what it is. */
function Tile({ label, children, note, wide = false }: { label: string; children: ReactNode; note?: string; wide?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-[12px] bg-tint/[0.045] p-3.5 md:p-4", wide && "col-span-2")}>
      <p className={EYEBROW}>{label}</p>
      <div className="mt-2 truncate font-money text-[26px] leading-none tabular-nums md:text-[28px]">{children}</div>
      {note && <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <>{value.toLocaleString()}</>;
}

function Report({ report: r, shown, reduce, phone }: { report: StreamReportData; shown: boolean; reduce: boolean; phone: boolean }) {
  const s = r.analytics?.summary;
  const practice = r.tone === "practice";
  // Starts as the phone on air, then becomes what the stream was.
  const [scene, setScene] = useState<TourScene>("phone-live");
  useEffect(() => {
    const t = setTimeout(() => setScene(ART_FOR[r.tone]), reduce ? 0 : 520);
    return () => clearTimeout(t);
  }, [r.tone, reduce]);

  const moments = r.analytics?.moments.filter((m) => m.kind !== "peak") ?? [];
  const best = r.bestMinute;

  return (
    <div className="mx-auto max-w-[680px]">
      {/* The headline. */}
      <header className="relative flex flex-col items-center pt-2 text-center">
        {r.tone === "good" && !reduce && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-2 mx-auto max-w-[420px]">
            <Confetti delay={640} />
          </div>
        )}
        <div className="relative w-[148px] md:w-[168px]" style={rise(shown, 0, reduce)}>
          <TourArt scene={scene} className="w-full" />
        </div>
        <h2 id="stream-report-title" className="mt-3 font-wide text-[28px] leading-[1.05] font-bold tracking-[-0.025em] text-balance md:text-[34px]" style={rise(shown, 1, reduce)}>
          {reportHeadline(r.tone)}
        </h2>
        <p className="mt-2 font-mono text-[13px] text-muted-foreground tabular-nums" style={rise(shown, 1, reduce)}>
          {durationLabel(r.stream.durationSeconds)} on air
          {r.stream.title ? <span className="text-muted-foreground/70"> · {r.stream.title}</span> : null}
        </p>
        <p className="mt-3 max-w-[48ch] text-[14px] leading-relaxed text-foreground/85 text-pretty" style={rise(shown, 2, reduce)}>
          {reportLine(r)}
        </p>
      </header>

      {/* The numbers. */}
      <section aria-label="The numbers" className="mt-6" style={rise(shown, 3, reduce)}>
        {practice ? (
          <div className="grid grid-cols-2 gap-2.5">
            <Tile label="On air">{durationLabel(r.stream.durationSeconds)}</Tile>
            <Tile label="Moments run" note="Cards, guests, goals">
              <Count value={moments.length} />
            </Tile>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Tile label="Peak viewers">
              <Count value={s?.peakViewers ?? 0} />
            </Tile>
            <Tile label="Watched by" note="Different people">
              <Count value={s?.uniqueViewers ?? 0} />
            </Tile>
            <Tile label="New allies">
              <Count value={s?.newAllies ?? 0} />
            </Tile>
            <Tile label="Gifters">
              <Count value={s?.gifters ?? 0} />
            </Tile>
            <Tile label="Earned" note={r.earnings && r.earnings.gifts > 0 ? `${r.earnings.gifts} ${r.earnings.gifts === 1 ? "gift" : "gifts"}, after fees` : "Gifts land here"}>
              <Money cents={r.earnings?.netMinor ?? 0} size="md" className="text-[26px] md:text-[28px]" />
            </Tile>
            <Tile label="Chat messages" note={s && s.chatters > 0 ? `From ${s.chatters} ${s.chatters === 1 ? "person" : "people"}` : undefined}>
              <Count value={s?.chats ?? 0} />
            </Tile>
            {r.pointsEarned > 0 ? (
              <Tile label="Points earned">
                <Count value={r.pointsEarned} />
              </Tile>
            ) : (
              <Tile label="Stayed" note="Average watch">
                {s?.avgWatchMinutes ?? 0} min
              </Tile>
            )}
            <Tile label="Best minute" note={best ? (best.label ?? `${best.viewers} watching${best.chats ? ` · ${best.chats} chats` : ""}`) : "Starts with your next viewer"}>
              {best ? minuteStamp(best.minute) : "—"}
            </Tile>
          </div>
        )}
      </section>

      {/* The curve, when there's one to draw. */}
      {!practice && r.analytics && r.analytics.minutes.some((m) => m.viewers > 0) && (
        <section aria-label="Viewers over the stream" className="mt-3 rounded-[12px] bg-tint/[0.045] p-4" style={rise(shown, 4, reduce)}>
          <p className={cn(EYEBROW, "mb-3")}>Viewers, minute by minute</p>
          <AudienceCurve analytics={r.analytics} height={phone ? 110 : 140} compact={phone} />
        </section>
      )}

      {/* A rehearsal: what was run through. */}
      {practice && (
        <section aria-label="What you ran through" className="mt-3 rounded-[12px] bg-tint/[0.045] p-4" style={rise(shown, 4, reduce)}>
          <p className={EYEBROW}>What you ran through</p>
          {moments.length === 0 ? (
            <p className="mt-2 text-[13px] leading-snug text-muted-foreground">Segments, cards, guests and goals you try in a practice run show up here.</p>
          ) : (
            <ol className="mt-2 flex flex-col gap-1.5">
              {moments.slice(0, 8).map((m, i) => (
                <li key={i} className="flex items-baseline gap-2.5 text-[13px] leading-snug">
                  <span className="w-11 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{minuteStamp(m.minute)}</span>
                  <span className="min-w-0">
                    <span className="text-muted-foreground">{MOMENT_LABELS[m.kind]} · </span>
                    {m.label}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {!practice && <Progress report={r} style={rise(shown, 5, reduce)} />}

      {!practice && (
        <div style={rise(shown, 6, reduce)}>
          <ThumbnailPicker streamId={r.stream.id} note="Frames from this stream, picked for sharpness and light. Tap one to use it." className="mt-3 bg-tint/[0.045]" />
        </div>
      )}

      {!practice && <ShareRecap report={r} style={rise(shown, 7, reduce)} />}

      {!practice && <Rating streamId={r.stream.id} initial={r.rating} style={rise(shown, 8, reduce)} />}
    </div>
  );
}

/* ---- progress: level, streak, the next step ----------------------------- */

function Progress({ report: r, style }: { report: StreamReportData; style: CSSProperties }) {
  const { level, weeksInARow, streamsThisWeek, next } = r.progress;
  const span = Math.max(1, level.next - level.floor);
  const into = Math.min(1, Math.max(0, (level.xp - level.floor) / span));
  const stepShare = next.target ? Math.min(1, (next.progress ?? 0) / next.target) : null;
  return (
    <section aria-label="Your progress" className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2" style={style}>
      <div className="rounded-[12px] bg-tint/[0.045] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className={EYEBROW}>Your level</p>
          <p className="text-[12px] text-muted-foreground tabular-nums">{level.xp.toLocaleString()} pts</p>
        </div>
        <p className="mt-2 font-wide text-[20px] font-bold tracking-[-0.02em]">
          Level {level.level} <span className="text-muted-foreground">· {level.tier}</span>
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-tint/[0.08]" role="progressbar" aria-label={`Level ${level.level + 1}`} aria-valuenow={Math.round(into * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full origin-left rounded-full bg-ember" style={{ transform: `scaleX(${into})` }} />
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {(level.next - level.xp).toLocaleString()} points to level {level.level + 1}
          {level.nextTier ? ` · ${level.nextTier.name} at ${level.nextTier.level}` : ""}
        </p>
      </div>

      <div className="rounded-[12px] bg-tint/[0.045] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className={EYEBROW}>Streak</p>
          <p className="text-[12px] text-muted-foreground tabular-nums">
            {streamsThisWeek} {streamsThisWeek === 1 ? "stream" : "streams"} this week
          </p>
        </div>
        <p className="mt-2 flex items-center gap-1.5 font-wide text-[20px] font-bold tracking-[-0.02em]">
          <Fire size={20} weight="fill" className={weeksInARow > 0 ? "text-ember" : "text-muted-foreground"} />
          {weeksInARow} {weeksInARow === 1 ? "week" : "weeks"} in a row
        </p>
        <p className="mt-2 text-[13px] leading-snug text-foreground/85">
          {next.text}
          {next.points ? <span className="text-muted-foreground"> +{next.points} pts</span> : null}
        </p>
        {stepShare !== null && (
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-tint/[0.08]" role="progressbar" aria-label="This week's quest" aria-valuenow={Math.round(stepShare * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full origin-left rounded-full bg-ember" style={{ transform: `scaleX(${stepShare})` }} />
          </div>
        )}
        {next.href && (
          <Link href={next.href} className="mt-2.5 inline-block text-[13px] font-semibold text-ember-hi hover:underline">
            {next.kind === "claim" ? "Claim it" : next.kind === "book" || next.kind === "streak" ? "Book the next one" : "See your quests"}
          </Link>
        )}
      </div>
    </section>
  );
}

/* ---- share a recap -------------------------------------------------------- */

type Drawn = { status: "drawing" } | { status: "ready"; file: File; url: string } | { status: "failed" };

function canShareFiles() {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof File === "undefined") return false;
  try {
    return navigator.canShare({ files: [new File([""], "recap.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

function ShareRecap({ report, style }: { report: StreamReportData; style: CSSProperties }) {
  const { user } = useAuth();
  const handle = user?.username ? `@${user.username}` : "Xtream";
  const [image, setImage] = useState<Drawn>({ status: "drawing" });
  const [said, setSaid] = useState<string | null>(null);
  const [shareFiles] = useState(canShareFiles);

  // Drawn as soon as the report opens: a share has to start inside the tap, file in hand.
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    renderRecapPng(report, handle)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setImage({ status: "ready", file: new File([blob], recapFileName(report), { type: "image/png" }), url });
      })
      .catch(() => alive && setImage({ status: "failed" }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [report, handle]);

  const link = () => (user?.username ? `${window.location.origin}/c/${user.username}` : window.location.origin);
  const copyLink = async (message = "Link to your channel copied.") => {
    try {
      await navigator.clipboard.writeText(link());
      setSaid(message);
    } catch {
      setSaid("Couldn't copy the link.");
    }
  };
  const save = () => {
    if (image.status !== "ready") return;
    const a = document.createElement("a");
    a.href = image.url;
    a.download = image.file.name;
    a.click();
    setSaid("Saved. The image is in your downloads.");
  };
  // Nothing is awaited before navigator.share: the tap's permission doesn't outlast a wait.
  const share = async () => {
    if (image.status !== "ready") return copyLink("There's no image yet, so the link's copied instead.");
    const data: ShareData = { files: [image.file], title: "My stream on Xtream", text: `Catch my next stream on Xtream ${link()}` };
    if (!navigator.canShare?.(data)) return save();
    try {
      await navigator.share(data);
      setSaid(null);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) save();
    }
  };

  return (
    <section aria-label="Share a recap" className="mt-3 flex items-center gap-4 rounded-[12px] bg-tint/[0.045] p-4" style={style}>
      <div className="relative aspect-[4/5] w-[76px] shrink-0 overflow-hidden rounded-[8px] bg-control">
        {image.status === "ready" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob URL of the drawn card
          <img src={image.url} alt="Your recap card" className="absolute inset-0 size-full object-cover" />
        ) : (
          <span className={cn("absolute inset-0", image.status === "drawing" && "animate-pulse bg-tint/[0.05]")} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold">Share a recap</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground" role="status" aria-live="polite">
          {said ?? (image.status === "failed" ? "Couldn't draw the card — the link still shares." : "A card with your numbers and the curve. No earnings on it.")}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {shareFiles ? (
            <Pill variant="primary" size="sm" icon={<ShareNetwork size={14} weight="fill" />} onClick={() => void share()} disabled={image.status === "drawing"}>
              Share
            </Pill>
          ) : (
            <Pill variant="primary" size="sm" icon={<DownloadIcon size={14} />} onClick={save} disabled={image.status !== "ready"}>
              Save image
            </Pill>
          )}
          <Pill variant="glass" size="sm" icon={<Copy size={14} />} onClick={() => void copyLink()}>
            Copy link
          </Pill>
        </div>
      </div>
    </section>
  );
}

/* ---- one question ----------------------------------------------------------- */

function Rating({ streamId, initial, style }: { streamId: string; initial: number | null; style: CSSProperties }) {
  const [score, setScore] = useState<number | null>(initial);
  const [error, setError] = useState(false);
  const pick = async (n: number) => {
    const before = score;
    setScore(n);
    setError(false);
    try {
      await rateStream(streamId, n);
    } catch {
      setScore(before);
      setError(true);
    }
  };
  return (
    <section aria-labelledby="rate-xtream" className="mt-3 rounded-[12px] bg-tint/[0.045] p-4" style={style}>
      <p id="rate-xtream" className="text-[14px] font-semibold">
        How likely are you to recommend Xtream to a friend?
      </p>
      <div role="radiogroup" aria-labelledby="rate-xtream" className="mt-3 grid grid-cols-11 gap-1">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            onClick={() => void pick(n)}
            className={cn(
              "press flex h-10 items-center justify-center rounded-[8px] font-mono text-[13px] font-semibold tabular-nums transition-colors",
              score === n ? "bg-ember text-on-ember" : "bg-tint/[0.08] text-foreground/85 hover:bg-tint/[0.13]",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>Not likely</span>
        <span>Very likely</span>
      </div>
      <p className="mt-2 min-h-[1.25em] text-[12.5px] text-muted-foreground" role="status" aria-live="polite">
        {error ? "Couldn't save that — tap again." : score !== null ? "Thanks — that helps us make Xtream better." : "Optional, one tap."}
      </p>
    </section>
  );
}
