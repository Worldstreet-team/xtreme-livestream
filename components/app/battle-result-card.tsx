"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { Copy, DownloadIcon, ShareNetwork, Trophy, X } from "@/components/icons";
import { BrandMark } from "@/components/ui/brand-mark";
import { IconButton } from "@/components/ui/icon-button";
import { Pill } from "@/components/ui/pill";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MARK_ON_CARD, PAIR_LEAD, PAIR_OVERLAP, PAIR_PARTNER, backersOf, formatScore, resultOf, type BattleResult } from "@/lib/battle-result";
import { renderBattleResultPng } from "@/lib/battle-result-png";
import { formatPracticeScore, type BattleSide, type BattleView } from "@/lib/battles";
import { cn } from "@/lib/utils";
import { PracticeBadge } from "@/components/app/practice-preview";

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

/** A lone face on the card; a pair's two faces are shares of it (lib/battle-result.ts). */
const FACE = 76;
const LEAD = Math.round(FACE * PAIR_LEAD);
const PARTNER = Math.round(FACE * PAIR_PARTNER);
const OVERLAP = Math.round((PARTNER / 2) * PAIR_OVERLAP);

/**
 * Both scores at one size — the longer one decides — so neither side's
 * number looks bigger than it is, and "$1,234,568" still fits half a phone.
 */
function scoreSize(scores: BattleResult["scores"]) {
  const longest = Math.max(scores.host.length, scores.challenger.length);
  return longest <= 4 ? "text-[30px]" : longest <= 6 ? "text-[26px]" : longest <= 8 ? "text-[21px]" : longest <= 10 ? "text-[17px]" : "text-[15px]";
}

/**
 * A settled battle's result, as a card worth posting: who won (or that
 * nobody did), both sides' faces, names and final scores, the bar they
 * finished on, the victory lap if there's a forfeit, each side's top three
 * backers, the date and the mark. The same design is drawn at 1080×1350 for
 * the image (lib/battle-result-png.ts); this is the page's own copy of it.
 *
 * Host in Chili on the left, challenger in Ember on the right, as on the
 * scoreboard. Gold is only the money; the foil trophy is only the winner's.
 *
 * A practice battle's card says Practice where the mark is, and its scores
 * are practice points in a plain face — never gold, never money.
 */
export function BattleResultCard({ battle, className }: { battle: BattleView; className?: string }) {
  const result = useMemo(() => resultOf(battle), [battle]);
  const sides = [
    { key: "host" as const, side: battle.host, score: result.scores.host, field: "bg-chili/[0.14]", ring: "ring-chili", label: "text-chili-hi", align: "left" as const },
    { key: "challenger" as const, side: battle.challenger, score: result.scores.challenger, field: "bg-ember/[0.14]", ring: "ring-ember", label: "text-ember-hi", align: "right" as const },
  ];
  const backers = sides.map(({ side }) => backersOf(side));
  const share = result.hostShare * 100;
  const practice = Boolean(battle.practice);
  const points = practice ? "font-mono font-bold text-foreground" : "font-money text-value";
  return (
    <article aria-label={`Battle result: ${result.headline}`} className={cn("flex flex-col gap-4 rounded-panel bg-background p-4 sm:p-5", className)}>
      <header className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5">
          {MARK_ON_CARD && <BrandMark size={20} />}
          <span className="text-[15px] font-bold tracking-tight text-foreground">Xtream</span>
          {practice && <PracticeBadge size="xs" />}
        </span>
        <span className="text-right leading-tight">
          <span className={cn(EYEBROW, "block text-[9.5px]")}>{practice ? "Practice battle" : result.pair ? "2v2 battle result" : "Battle result"}</span>
          <span className="block text-[12px] font-medium text-foreground">{result.date}</span>
        </span>
      </header>

      <div className="text-center">
        {/* The line height after the size: cn() drops a leading- that comes before a text- size. */}
        <h3
          className={cn(
            "font-wide font-extrabold tracking-[-0.03em] text-balance text-foreground [overflow-wrap:anywhere]",
            result.headline.length > 22 ? "text-[22px] sm:text-[24px]" : "text-[28px] sm:text-[32px]",
            "leading-[1.04]",
          )}
        >
          {result.headline}
        </h3>
        {result.subline && <p className="mt-1 text-[12.5px] text-muted-foreground">{result.subline}</p>}
      </div>

      <div className="relative grid grid-cols-2 gap-1.5">
        {sides.map(({ key, side, score, field, ring, align }) => (
          <div key={key} className={cn("flex min-w-0 flex-col items-center rounded-[12px] px-3 pt-3.5 pb-3 text-center", field)}>
            <Faces side={side} align={align} ring={ring} won={result.winner === key} />
            <p className="mt-2.5 w-full truncate font-wide text-[15px] leading-tight font-bold tracking-[-0.02em] text-foreground">{side.displayName}</p>
            {/* A pair's partner on a line of their own; both sides keep the line so the scores sit level. */}
            {result.pair && (
              <p className="w-full truncate text-[12.5px] leading-snug font-semibold text-muted-foreground" aria-hidden={!side.partner}>
                {side.partner ? `& ${side.partner.displayName}` : "\u00a0"}
              </p>
            )}
            <p className={cn("mt-1.5 whitespace-nowrap", points, scoreSize(result.scores), "leading-none")}>{score}</p>
          </div>
        ))}
        {/* "VS" where the two fields meet, level with the faces. */}
        <span
          aria-hidden
          className="absolute top-[55px] left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background font-wide text-[10px] font-extrabold text-foreground"
        >
          VS
        </span>
      </div>

      {/* The bar they finished on: each side's share, meeting at a white seam. */}
      <div aria-hidden className="relative h-1.5 rounded-full bg-ember">
        <div className="absolute inset-y-0 left-0 rounded-full bg-chili" style={{ width: `${share}%` }} />
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-[3px] ring-background"
          style={{ left: `clamp(6px, ${share}%, calc(100% - 6px))` }}
        />
      </div>

      {/* The clamp sits inside the padding, or a third line shows through it. */}
      {result.victoryLap && (
        <p className="self-center rounded-[16px] bg-ember px-3.5 py-1.5 text-center font-wide text-[12.5px] leading-snug font-bold text-on-ember">
          <span className="line-clamp-2">{result.victoryLap}</span>
        </p>
      )}

      {backers.some((list) => list.length > 0) && (
        <div className="grid grid-cols-2 gap-x-3">
          {sides.map(({ key, ring, label }, i) => (
            <div key={key} className="min-w-0">
              <p className={cn(EYEBROW, "mb-2 text-[10px]", label)}>Top backers</p>
              {backers[i].length > 0 ? (
                <ol className="flex flex-col gap-1.5">
                  {backers[i].map((b) => (
                    <li key={b.userId} className="flex min-w-0 items-center gap-2">
                      <UserAvatar src={b.avatar} name={b.displayName} size={20} className={cn("size-5 ring-[1.5px]", ring)} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">{b.displayName}</span>
                      <span className={cn("shrink-0 text-[12.5px] leading-none", points)}>{practice ? formatPracticeScore(b.usdMinor, true) : formatScore(b.usdMinor)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[12px] text-muted-foreground">No backers this time</p>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * A side's faces: one in a 1v1; in a 2v2 the streamer on the outside and
 * their partner tucked in lower toward the middle, as the image draws them.
 * The row keeps a lone face's height so the names line up across a pair
 * and a side whose partner had left.
 */
function Faces({ side, align, ring, won }: { side: BattleSide; align: "left" | "right"; ring: string; won: boolean }) {
  const lead = side.partner ? LEAD : FACE;
  return (
    <div className={cn("flex h-[82px] items-end justify-center", align === "right" && "flex-row-reverse")}>
      <span className="relative z-10 flex">
        <UserAvatar src={side.avatar} name={side.displayName} size={lead} className={cn("ring-[3px]", ring)} />
        {won && (
          <span className="absolute top-0 right-0 flex size-[22px] items-center justify-center rounded-full bg-foil text-[#1a1206] ring-2 ring-background">
            <Trophy size={12} weight="fill" role="img" aria-label="Winner" />
          </span>
        )}
      </span>
      {side.partner && (
        <span className="flex" style={align === "left" ? { marginLeft: -OVERLAP } : { marginRight: -OVERLAP }}>
          <UserAvatar src={side.partner.avatar} name={side.partner.displayName} size={PARTNER} className={cn("ring-[3px]", ring)} />
        </span>
      )}
    </div>
  );
}

/* ---- the image, and what can be done with it ------------------------------ */

type ImageState = { status: "drawing" } | { status: "ready"; file: File; url: string } | { status: "failed" };

/** The PNG, drawn as soon as the card opens — a share has to start inside the tap, with the file already in hand. */
function useResultImage(battle: BattleView, result: BattleResult) {
  const [image, setImage] = useState<ImageState>({ status: "drawing" });
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    renderBattleResultPng(battle, result)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImage({ status: "ready", file: new File([blob], result.fileName, { type: "image/png" }), url });
      })
      .catch((error) => {
        console.error("battle result image failed:", error);
        if (!cancelled) setImage({ status: "failed" });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [battle, result]);
  return image;
}

const noSubscription = () => () => {};

/** Phones (and a few desktops) can hand a file to another app; the rest copy the link. */
function canShareFiles() {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof File === "undefined") return false;
  try {
    return navigator.canShare({ files: [new File([""], "result.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

function ResultActions({ battle, result, streamId }: { battle: BattleView; result: BattleResult; streamId: string }) {
  const image = useResultImage(battle, result);
  const shareFiles = useSyncExternalStore(noSubscription, canShareFiles, () => false);
  const [said, setSaid] = useState<string | null>(null);

  const link = () => `${window.location.origin}/stream/${streamId}`;

  const copyLink = async (done: string) => {
    try {
      await navigator.clipboard.writeText(link());
      setSaid(done);
    } catch {
      setSaid(`Couldn't copy the link. It's ${link()}`);
    }
  };

  const save = () => {
    if (image.status !== "ready") return;
    const a = document.createElement("a");
    a.href = image.url;
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSaid("Saved. The image is in your downloads.");
  };

  // Nothing is awaited before navigator.share: the tap's permission to open
  // the share sheet doesn't outlast a wait.
  const share = async () => {
    if (!shareFiles) return copyLink("Link to the stream copied.");
    if (image.status === "failed") return copyLink("There's no image to share, so the link's copied instead.");
    if (image.status !== "ready") return;
    const data: ShareData = { files: [image.file], title: result.headline, text: `${result.shareText} ${link()}` };
    if (!navigator.canShare?.(data)) return copyLink("This phone can't share the image, so the link's copied instead.");
    try {
      await navigator.share(data);
      setSaid("Shared.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setSaid("Not shared.");
      else await copyLink("Sharing didn't open, so the link's copied instead.");
    }
  };

  const drawing = image.status === "drawing";
  const status = said ?? (drawing ? "Drawing the image…" : image.status === "failed" ? "Couldn't draw the image — the link still shares." : null);
  return (
    // Pinned to the foot of the screen while a tall card scrolls under it:
    // Save and Share stay in reach on a short phone.
    <div className="sticky bottom-0 -mx-4 mt-1 bg-surface-raised px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:-mx-5 sm:rounded-b-overlay sm:px-5 sm:pb-4">
      <div className="grid grid-cols-2 gap-2">
        <Pill size="lg" variant="glass" icon={<DownloadIcon size={18} />} onClick={save} disabled={image.status !== "ready"}>
          Save image
        </Pill>
        <Pill
          size="lg"
          variant="primary"
          icon={shareFiles ? <ShareNetwork size={18} weight="fill" /> : <Copy size={18} />}
          onClick={() => void share()}
          disabled={shareFiles && image.status === "drawing"}
        >
          {shareFiles ? "Share" : "Copy link"}
        </Pill>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-[18px] text-center text-[12.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
        {status}
      </p>
    </div>
  );
}

/** In fullscreen only the fullscreened element shows, so the sheet goes inside it. */
function sheetHost(): HTMLElement {
  const full = document.fullscreenElement;
  return full instanceof HTMLElement && !(full instanceof HTMLVideoElement) ? full : document.body;
}

/**
 * The result card in a sheet from the bottom on phones, a dialog on wider
 * screens — the stream page's grammar — with Save image and Share. A
 * practice battle's has neither: it's there to see how a result looks, and
 * nothing about it is real enough to post. Give it
 * the battle as it was when it opened: a live `battle` prop moving on to the
 * next battle shouldn't change the card someone is about to post.
 */
export function BattleResultSheet({ battle, streamId, onClose }: { battle: BattleView; streamId: string; onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const result = useMemo(() => resultOf(battle), [battle]);

  // Focus comes in on open and goes back to where it was on close; Escape
  // shuts it, and Tab stays inside while it's up.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      const panel = panelRef.current;
      if (e.key !== "Tab" || !panel) return;
      const stops = [...panel.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  // A portal still bubbles through the React tree it was opened from — the
  // studio's drawer drags on pointer events, the player takes taps — so
  // nothing done in here goes any further up.
  const keep = (e: SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      className="animate-fade-in pointer-events-auto fixed inset-0 z-[70] flex justify-center overflow-y-auto overscroll-contain bg-black/75 sm:items-start sm:p-6"
      onClick={(e) => {
        e.stopPropagation();
        closeRef.current();
      }}
      onPointerDown={keep}
      onPointerMove={keep}
      onPointerUp={keep}
      onPointerCancel={keep}
      onTouchStart={keep}
      onTouchMove={keep}
      onTouchEnd={keep}
      onMouseDown={keep}
      onMouseUp={keep}
      onDoubleClick={keep}
      onWheel={keep}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        // mt-auto, not items-end: a sheet taller than a short phone then
        // scrolls from its top instead of losing it above the screen.
        className="animate-pop-in mt-auto w-full rounded-t-overlay bg-surface-raised px-4 pt-3 text-foreground shadow-overlay outline-none sm:my-auto sm:max-w-[440px] sm:rounded-overlay sm:px-5 sm:pt-5"
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="font-wide text-[18px] font-bold tracking-[-0.02em]">
            {battle.practice ? "Practice result" : "Share the result"}
          </h2>
          <IconButton icon={X} label="Close" onClick={() => closeRef.current()} className="-mr-2" />
        </div>
        <BattleResultCard battle={battle} />
        {battle.practice ? (
          <div className="sticky bottom-0 -mx-4 mt-1 bg-surface-raised px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:-mx-5 sm:rounded-b-overlay sm:px-5 sm:pb-4">
            <Pill size="lg" variant="primary" className="w-full" onClick={() => closeRef.current()}>
              Done
            </Pill>
            <p className="mt-2 text-center text-[12.5px] leading-snug text-muted-foreground">
              A real battle&apos;s card can be saved and shared. This one was practice, so it stays here.
            </p>
          </div>
        ) : (
          <ResultActions battle={battle} result={result} streamId={streamId} />
        )}
      </div>
    </div>,
    sheetHost(),
  );
}
