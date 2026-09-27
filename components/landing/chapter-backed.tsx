import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Sword } from "@/components/icons";
import { PillLink } from "@/components/ui/pill";
import { GiftArt } from "@/components/app/gift-art";
import { GIFT_CATALOG } from "@/lib/gifts";
import { formatUsd } from "@/components/xtream/money";
import { cn } from "@/lib/utils";
import { AppScreen, PhoneScreen } from "./app-screen";
import { BoxPattern } from "./box-pattern";
import { LiveFeed } from "./live-feed";
import { ChapterTitle, Eyebrow, GUTTER, INK_MUTED, delay } from "./story-ui";

/**
 * Chapter 02: a battle, told the way 03 and 04 tell theirs. The words sit
 * on the left and higher; a big screen of the stream page in battle mode
 * runs off the right edge and out through the section's foot. On a phone,
 * one centred device. The section is white and so is the screen, in the
 * app's light skin (owner, 2026-09-26); the only dark thing in it is the
 * picture of the battle itself.
 *
 * The two halves of the split are real footage of two people talking to
 * camera (Pexels, free licence: videos 8048443 and 8360267), cut to ten
 * seconds, 540×960, in public/promo/battle-*.mp4.
 *
 * The screen is BattleBar's grammar: two solid sides (Chili for the host,
 * Ember for the challenger) meeting at a white seam, the clock as a white
 * chip with the "+15s" a late gift buys, the totals in thin money numerals,
 * the lead called out, each side's top three backers, and the forfeit. The
 * live chat sits on the side the crop is allowed to take. Beside it, one
 * call: start a battle from the Studio, or watch one on Explore.
 */
const LOWEST = formatUsd(GIFT_CATALOG[0].usdMinor);
const HIGHEST = formatUsd(GIFT_CATALOG[GIFT_CATALOG.length - 1].usdMinor, true);
const crown = GIFT_CATALOG.find((g) => g.id === "crown")!;

const BACKERS = {
  host: [
    ["@whale.eth", "$620", "/images/stage/group.webp"],
    ["@lagos_ape", "$310", "/images/stage/film.webp"],
    ["@0xmoon", "$144", "/images/stage/dj.webp"],
  ],
  challenger: [
    ["@degen_ada", "$480", "/images/stage/deck.webp"],
    ["@amap_queen", "$260", "/images/stage/cover.webp"],
    ["@kofi.sol", "$95", "/images/stage/streamer.webp"],
  ],
} as const;

const CHAT = [
  ["lagos_ape", "Zara don't let it go 😤"],
  ["kofi.sol", "last 10s is where it gets decided"],
  ["amap_queen", "Kojo we're right here 🔥"],
  ["whale.eth", "watch this"],
];

/** The scoreboard over the split picture. `compact` is the phone's. */
function Scoreboard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("absolute inset-x-0 top-0 flex flex-col items-center", compact ? "gap-2 p-3" : "gap-2.5 p-5")}>
      <div className="flex w-full items-end justify-between">
        <span>
          <span className={cn("block font-bold", compact ? "text-[12px]" : "text-[14px]")}>Zara</span>
          <span data-count="200" className={cn("block font-money leading-none", compact ? "text-[28px]" : "text-[clamp(2rem,3vw,2.75rem)]")}>$1,284</span>
        </span>
        <span className="text-right">
          <span className={cn("block font-bold", compact ? "text-[12px]" : "text-[14px]")}>Kojo Beats</span>
          <span data-count="200" className={cn("block font-money leading-none", compact ? "text-[28px]" : "text-[clamp(2rem,3vw,2.75rem)]")}>$942</span>
        </span>
      </div>
      <div className={cn("flex w-full overflow-hidden rounded-full bg-ember", compact ? "h-2.5" : "h-3.5")}>
        <div className="h-full w-[57.7%] bg-chili" />
        <div className="h-full w-[3px] bg-white" />
      </div>
      <span className="flex items-center gap-1.5">
        <span className={cn("rounded-full bg-white font-mono font-bold text-[#0b0708] tabular-nums", compact ? "px-2.5 py-1 text-[13px]" : "px-3.5 py-1.5 text-[16px]")}>0:09</span>
        <span className={cn("rounded-full bg-ember font-mono font-bold text-on-ember", compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-[13px]")}>+15s</span>
      </span>
      {!compact && <span data-count="500" className="rounded-full bg-black/55 px-3 py-1 text-[12px] font-semibold">Zara leads by $342</span>}
    </div>
  );
}

function Stage({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("relative overflow-hidden text-white", compact ? "h-[21rem]" : "h-[27rem] rounded-panel")}>
      <div className="absolute inset-0 grid grid-cols-2 gap-[2px] bg-white">
        <div className="relative bg-surface">
          <LiveFeed name="battle-host" className="object-[center_35%]" />
        </div>
        <div className="relative bg-surface">
          <LiveFeed name="battle-challenger" className="object-[center_30%]" />
        </div>
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-ground/75 via-transparent via-40% to-ground/85" />
      <Scoreboard compact={compact} />
      <div className={cn("absolute inset-x-0 bottom-0 flex items-end justify-between gap-3", compact ? "p-3" : "p-5")}>
        <span className="flex items-center gap-2.5 rounded-full bg-black/55 py-2 pr-4 pl-2">
          <span className="rounded-full bg-heat p-[2px]">
            <Image src="/images/stage/deck.webp" alt="" width={34} height={34} className="size-[34px] rounded-full object-cover ring-2 ring-ground" />
          </span>
          <span>
            <span className="flex items-center gap-1 text-[12px] font-bold whitespace-nowrap">
              @degen_ada sent a {crown.name} <GiftArt art={crown.art} emoji={crown.emoji} size={14} />
            </span>
            <span className="block text-[11px] font-medium text-value">{formatUsd(crown.usdMinor)} · at 0:04</span>
          </span>
        </span>
        {!compact && (
          <span className="flex items-center gap-2 rounded-full bg-ember/15 px-3 py-1.5 ring-1 ring-ember/40">
            <span className="caps font-mono text-[10px] text-ember-hi">Loser</span>
            <span className="text-[12px] font-semibold whitespace-nowrap">sings a song live</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Backers({ side, compact = false }: { side: keyof typeof BACKERS; compact?: boolean }) {
  return (
    <div data-stage className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="caps px-1 font-mono text-[10px] text-[#8a807b]">Top backers · {side === "host" ? "Zara" : "Kojo Beats"}</span>
      {BACKERS[side].map(([name, amount, avatar], i) => (
        <div key={name} className={cn("flex items-center gap-2.5 rounded-full bg-[#f6f3f0] py-1.5 pr-3.5 pl-1.5", compact && "py-1")}>
          <span className={cn("w-4 text-center font-money text-[15px]", i === 0 ? "text-[#a16207]" : "text-[#8a807b]")}>{i + 1}</span>
          <span className={cn("rounded-full p-[2px]", i === 0 ? "bg-heat" : "bg-black/10")}>
            <Image src={avatar} alt="" width={26} height={26} className="size-[26px] rounded-full object-cover" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
          <span data-count={300 + i * 120} className="font-money text-[14px] text-[#a16207]">{amount}</span>
        </div>
      ))}
    </div>
  );
}

const SCREEN_LABEL =
  "A battle on Xtream: two creators split side by side under a scoreboard with each side's total, a clock at 0:09 with fifteen seconds added by a late gift, each side's top three backers, and the live chat.";

export function ChapterBacked() {
  return (
    <section
      id="backed"
      aria-labelledby="backed-title"
      className="relative isolate scroll-mt-16 overflow-hidden bg-white pt-28 text-[#0b0708] sm:pt-36 lg:pt-44"
    >
      <BoxPattern theme="battle" corner="tl" />
      <div className={cn("mx-auto grid max-w-[90rem] gap-14 lg:grid-cols-2 lg:gap-16", GUTTER)}>
        <div className="flex min-w-0 flex-col items-center gap-8 text-center lg:items-start lg:pr-8 lg:pb-24 lg:text-left">
          <Eyebrow onPaper>02 / Get backed</Eyebrow>
          <ChapterTitle id="backed-title" lines={["Two rooms.", "One clock."]} className="text-[clamp(2.5rem,4.6vw,4rem)] leading-[0.94]" />
          <p data-reveal="up" style={delay(200)} className={cn("max-w-[29rem] text-[17px] leading-[1.55]", INK_MUTED)}>
            Gifts burst on the picture, combos stack, and a battle turns a quiet night into a scoreboard. Every gift from {LOWEST} to{" "}
            {HIGHEST} counts for your side. The room isn&apos;t watching you. It&apos;s backing you.
          </p>
          <div data-reveal="up" style={delay(320)} className="flex flex-wrap items-center justify-center gap-3 pt-2 lg:justify-start">
            <PillLink href="/studio" variant="ember" size="xl" icon={<Sword size={18} weight="bold" />}>
              Start a battle
            </PillLink>
            <Link
              href="/explore#battles"
              className="press flex h-[52px] items-center gap-2 rounded-full px-6 text-[15.5px] font-semibold ring-1 ring-black/15 transition-colors hover:bg-black/[0.04]"
            >
              Watch one live
              <ArrowUpRight size={17} weight="bold" />
            </Link>
          </div>
        </div>

        {/* Lower than the words, and out through the section's foot. */}
        <div className="-mb-32 min-w-0 lg:-mb-24 lg:pt-28">
          <div className="hidden lg:block">
            <AppScreen bleed="right" tone="light" url="xtream.worldstreetgold.com/stream/battle" active="Home" label={SCREEN_LABEL}>
              <div className="flex gap-5 p-5 pb-10">
                {/* The side that stays in view: the battle and its backers. */}
                <div className="flex min-w-0 flex-1 flex-col gap-4 lg:max-w-[38rem]">
                  <Stage />
                  <div className="flex gap-3">
                    <Backers side="host" />
                    <Backers side="challenger" />
                  </div>
                </div>
                {/* The cropped side: the room talking. */}
                <div data-stage className="flex w-60 shrink-0 flex-col gap-3 rounded-panel bg-[#f6f3f0] p-4">
                  <span className="caps font-mono text-[10px] text-[#8a807b]">Live chat</span>
                  {CHAT.map(([who, text]) => (
                    <p key={who} className="text-[13px] leading-[1.45]">
                      <span className="font-semibold text-[#c2410c]">{who}</span> <span className="text-[#0b0708]/80">{text}</span>
                    </p>
                  ))}
                  <p className="rounded-sm bg-[#EAB308]/[0.12] px-2.5 py-2 text-[12px] text-[#a16207]">@degen_ada sent a {crown.name} for Kojo Beats</p>
                </div>
              </div>
            </AppScreen>
          </div>
          <div className="lg:hidden">
            <PhoneScreen tone="light" label={SCREEN_LABEL}>
              <div className="flex flex-col gap-3">
                <Stage compact />
                <div className="flex flex-col gap-3 px-3">
                  <Backers side="host" compact />
                </div>
              </div>
            </PhoneScreen>
          </div>
        </div>
      </div>
    </section>
  );
}
