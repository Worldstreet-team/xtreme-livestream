"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Fire, Gift, Sword, Timer, UserPlus } from "@/components/icons";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { AppScreen, PhoneScreen } from "./app-screen";
import { BoxPattern } from "./box-pattern";
import { ChapterTitle, Eyebrow, GUTTER, delay } from "./story-ui";

/** Where the race itself is run and voted on (lib/ecosystem.ts). */
const WOLF_RACE_URL = "https://social.worldstreetgold.com/votes";
/** Flat black, a step below the page ground, so the white screen reads at
 *  its hardest here (owner, 2026-09-26: "the 04 background could be black"). */
const GROUND = "#000000";

interface APITopStreamer {
  rank: number;
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  followers: number;
  isLive: boolean;
  category: string | null;
}

/**
 * The board: the platform's most-followed creators, ranked by allies, the
 * leader in a spotlight card. Drawn once for the desktop screen and once,
 * tighter, for the phone; both read the same rows. It wears the app's
 * light skin (owner, 2026-09-26: "a white theme" inside the device).
 */
function Board({ rows, compact }: { rows: APITopStreamer[] | null; compact?: boolean }) {
  const leader = rows?.[0];
  const rest = rows?.slice(1) ?? [];
  const status = (s: APITopStreamer) => (s.isLive ? "Live now" : s.category ?? "Creator");

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", compact ? "gap-2" : "gap-3")}>
      <p className="flex justify-between px-1">
        <span className="caps font-mono text-[11px] text-[#8a807b]">Most allies on Xtream</span>
        <span className="caps font-mono text-[11px] text-[#8a807b]">Allies</span>
      </p>

      {rows === null && (
        <div className="flex flex-col gap-2">
          <div className="h-24 animate-pulse rounded-panel bg-black/[0.05]" />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-panel bg-black/[0.04]" />
          ))}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-panel bg-[#f6f3f0] px-5 pt-6 pb-7">
          <p className="font-wide text-[20px] font-bold tracking-[-0.03em]">The board is wide open.</p>
          <p className="max-w-[34ch] text-[14px] text-[#6b605c]">
            It fills as creators go live and the room follows them. The first name on it could be yours.
          </p>
          <Link href="/studio" className="press mt-2 flex h-11 items-center rounded-full bg-[#0b0708] px-5 text-[14px] font-semibold text-white">
            Go live first
          </Link>
        </div>
      )}

      {leader && (
        <Link
          href={`/c/${leader.username}`}
          className={cn(
            "flex items-center rounded-panel bg-[#EAB308]/[0.12] ring-1 ring-[#EAB308]/50 transition-colors hover:bg-[#EAB308]/[0.18]",
            compact ? "gap-3 p-3.5" : "gap-5 p-5",
          )}
        >
          <span className={cn("font-money leading-none text-[#a16207]", compact ? "text-[34px]" : "text-[48px]")}>1</span>
          <UserAvatar
            src={leader.avatar}
            name={leader.displayName || leader.username}
            size={compact ? 44 : 56}
            ring={leader.isLive ? "live" : "none"}
            ringGapClassName="bg-white"
          />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate font-wide font-bold tracking-[-0.03em]", compact ? "text-[16px]" : "text-[22px]")}>
              {leader.displayName || leader.username}
            </span>
            <span className="mt-1 flex items-baseline gap-2 text-[12px] whitespace-nowrap text-[#6b605c]">
              <span data-count="250" className={cn("font-money text-[#0b0708] tabular-nums", compact ? "text-[17px]" : "text-[22px]")}>
                {formatNumber(leader.followers)}
              </span>
              allies{!compact && leader.isLive ? " · Live now" : ""}
            </span>
          </span>
        </Link>
      )}

      {rest.length > 0 && (
        <ol data-stage className="flex flex-col">
          {rest.map((s, i) => {
            const name = s.displayName || s.username;
            return (
              <li key={s.id}>
                <Link
                  href={`/c/${s.username}`}
                  className={cn(
                    "flex items-center rounded-panel transition-colors hover:bg-black/[0.04]",
                    compact ? "gap-3 px-2 py-2" : "gap-4 px-4 py-3",
                  )}
                >
                  <span className={cn("font-money leading-none text-[#8a807b]", compact ? "w-6 text-[20px]" : "w-8 text-[26px]")}>
                    {s.rank ?? i + 2}
                  </span>
                  <UserAvatar src={s.avatar} name={name} size={compact ? 34 : 40} ring={s.isLive ? "live" : "none"} ringGapClassName="bg-white" />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-semibold", compact ? "text-[13px]" : "text-[15px]")}>{name}</span>
                    <span className={cn("block truncate text-[#6b605c]", compact ? "text-[11px]" : "text-[13px]")}>{status(s)}</span>
                  </span>
                  <span data-count={300 + i * 90} className={cn("font-money tabular-nums", compact ? "text-[15px]" : "text-[19px]")}>{formatNumber(s.followers)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const BOARD_LABEL = "The board of the most-followed creators on Xtream, with the leader in a spotlight card and the next five ranked below.";

/**
 * Chapter 04: the Wolf of WorldStreet. The mirror of the wallet chapter:
 * the words on the left and set higher, a big screen of the board in a
 * light app screen running off the right edge and out through the section's
 * foot, on flat black (owner, 2026-09-26: no gradient, then black). On a phone,
 * one centred device.
 *
 * The board is real: /api/users/top, ranked by allies. It is deliberately
 * not dressed as the race. The pelt belongs to whoever leads the vote on
 * WorldSpace, and this board doesn't know who that is, so no foil and no
 * crown here. Loading is a skeleton; nobody yet, or the API down, is said
 * in words.
 */
export function ChapterPelt() {
  const [rows, setRows] = useState<APITopStreamer[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ success: boolean; data: { streamers: APITopStreamer[] } }>("/api/users/top?limit=6")
      .then((res) => !cancelled && setRows(res.data?.streamers ?? []))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="wolf" aria-labelledby="wolf-title" className="relative isolate scroll-mt-16 overflow-hidden border-b border-hairline bg-black pt-28 sm:pt-36 lg:pt-44">
      <BoxPattern theme="steps" corner="tl" />
      <div className={cn("mx-auto grid max-w-[90rem] gap-14 lg:grid-cols-2 lg:gap-16", GUTTER)}>
        <div className="flex min-w-0 flex-col items-center gap-8 text-center lg:items-start lg:pr-8 lg:pb-24 lg:text-left">
          <Eyebrow accent="gold">04 / Wear the pelt</Eyebrow>
          <ChapterTitle
            id="wolf-title"
            lines={["The most-backed", "creator wears", "the pelt."]}
            className="text-[clamp(2.5rem,4vw,3.5rem)] leading-[0.94]"
          />
          <p data-reveal="up" style={delay(200)} className="max-w-[29rem] text-[17px] leading-[1.55] text-muted-foreground">
            The Wolf of WorldStreet is a race that never sleeps. Gifts, follows and battle wins all count, and every week the board
            resets and the pelt is up for grabs again.
          </p>
          <div data-reveal="up" style={delay(320)} className="flex flex-wrap items-center justify-center gap-5 pt-2 lg:justify-start">
            <a
              href={WOLF_RACE_URL}
              className="press flex h-[52px] items-center gap-2 rounded-full bg-[#EAB308] px-6 text-[15.5px] font-bold text-[#0b0906] transition-colors hover:bg-[#F5CE4E]"
            >
              Enter the pack
              <ArrowUpRight size={17} weight="bold" />
            </a>
            <span className="flex items-center gap-2 font-mono text-[13px] text-muted-foreground">
              <Timer size={16} /> Resets every week
            </span>
          </div>
        </div>

        {/* Lower than the words, and out through the section's foot. */}
        <div className="-mb-32 min-w-0 lg:-mb-24 lg:pt-28">
          <div className="hidden lg:block">
            <AppScreen bleed="right" interactive tone="light" url="xtream.worldstreetgold.com" active="Home" ground={GROUND} label={BOARD_LABEL}>
              <div className="flex gap-5 p-6 pb-10">
                <div className="flex min-w-0 flex-1 lg:max-w-[34rem]">
                  <Board rows={rows} />
                </div>
                {/* The cropped side: how the race counts. */}
                <div aria-hidden className="flex w-64 shrink-0 flex-col gap-3">
                  <span className="caps px-1 font-mono text-[11px] text-[#8a807b]">What counts</span>
                  {[
                    [Gift, "Gifts", "Every gift you receive"],
                    [UserPlus, "Follows", "Every new ally"],
                    [Sword, "Battle wins", "Every battle you take"],
                    [Fire, "Weekly", "The board resets each week"],
                  ].map(([Icon, name, sub]) => {
                    const Glyph = Icon as typeof Gift;
                    return (
                      <div key={name as string} className="flex items-center gap-3 rounded-panel bg-[#f6f3f0] p-4">
                        <span className="flex size-9 items-center justify-center rounded-full bg-white ring-1 ring-black/[0.06]">
                          <Glyph size={16} />
                        </span>
                        <span>
                          <span className="block text-[14px] font-semibold">{name as string}</span>
                          <span className="block text-[12px] text-[#6b605c]">{sub as string}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </AppScreen>
          </div>
          <div className="lg:hidden">
            <PhoneScreen interactive tone="light" ground={GROUND} label={BOARD_LABEL}>
              <div className="flex flex-col gap-2 px-4 pt-2">
                <p className="px-1 pb-1 font-wide text-[22px] font-bold tracking-[-0.03em]">Top allies</p>
                <Board rows={rows} compact />
              </div>
            </PhoneScreen>
          </div>
        </div>
      </div>
    </section>
  );
}
