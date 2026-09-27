import type { ReactNode } from "react";
import { ChartDonut, ChatCircleDots, Compass, Diamond, HouseLine, PlayCircle, Wallet } from "@/components/icons";
import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";

/** The app's own rail, in its compact form: the icons, in the sidebar's order. */
const RAIL = [
  { label: "Home", Icon: HouseLine },
  { label: "Browse", Icon: Compass },
  { label: "Live feed", Icon: PlayCircle },
  { label: "Messages", Icon: ChatCircleDots },
  { label: "Your channel", Icon: ChartDonut },
  { label: "Wallet", Icon: Wallet },
  { label: "Rewards", Icon: Diamond },
];

/** The screen's own colour, and the chrome around it, per theme. */
const THEME = {
  dark: {
    bezel: "bg-[#1c1617] ring-white/10",
    screen: "bg-[#141011] text-foreground",
    bar: "border-hairline bg-[#1c1617]",
    url: "bg-white/[0.06] text-muted-foreground",
    rail: "border-hairline",
    on: "bg-white text-[#0b0708]",
    off: "text-muted-foreground",
    phone: "bg-[#0b0708] text-foreground",
    island: "bg-black",
  },
  light: {
    bezel: "bg-[#e7e0da] ring-black/10",
    screen: "bg-white text-[#0b0708]",
    bar: "border-black/[0.08] bg-[#f6f3f0]",
    url: "bg-black/[0.05] text-[#6b605c]",
    rail: "border-black/[0.08]",
    on: "bg-[#0b0708] text-white",
    off: "text-[#8a807b]",
    phone: "bg-white text-[#0b0708]",
    island: "bg-[#0b0708]",
  },
} as const;
export type ScreenTone = keyof typeof THEME;

type Common = {
  /** What the picture shows, for assistive tech. */
  label: string;
  /**
   * The page inside is real and can be used (the Wolf board's rows are
   * links): expose it as a labelled region instead of a single picture.
   * The device's bezel and chrome stay decorative either way.
   */
  interactive?: boolean;
  /** The app's own light or dark skin inside the device. */
  tone?: ScreenTone;
  /** The colour of the section behind the device (kept for the bezel's
   *  glass, which is off for now; see glass-lens.tsx). */
  ground?: string;
  children: ReactNode;
};

/**
 * A big screen of the app, cropped by the page: a window with its bar, the
 * compact rail and one page of the product, sized past half the viewport so
 * it runs off the side it `bleed`s toward (and, placed by its chapter, off
 * the bottom of the section too). What matters is laid out on the side that
 * stays in view.
 *
 * The device wears a plain bezel, and the page inside wears the app's dark
 * skin or its light one (`tone`). (A Glass bezel, see glass-lens.tsx,
 * is parked for now: owner, 2026-09-26.) Desktop only; phones get
 * <PhoneScreen>.
 */
export function AppScreen({
  bleed,
  url,
  active,
  label,
  interactive = false,
  tone = "dark",
  children,
}: Common & {
  bleed: "left" | "right";
  url: string;
  /** Which rail item is lit. */
  active?: string;
}) {
  const t = THEME[tone];
  return (
    <div className={cn("flex w-full min-w-0", bleed === "left" && "justify-end")}>
      <div
        role={interactive ? "region" : "img"}
        aria-label={label}
        data-reveal="window"
        data-from={bleed}
        className={cn("relative w-[calc(50vw+8rem)] shrink-0 rounded-[30px] p-3 ring-1", t.bezel)}
      >
        <div className={cn("relative overflow-hidden rounded-[18px]", t.screen)}>
          <div aria-hidden className={cn("flex h-11 items-center gap-4 border-b px-4", t.bar)}>
            <span className="flex gap-1.5">
              <span className="size-3 rounded-full bg-[#ff5f57]" />
              <span className="size-3 rounded-full bg-[#febc2e]" />
              <span className="size-3 rounded-full bg-[#28c840]" />
            </span>
            <span className={cn("mx-auto rounded-full px-4 py-1 font-mono text-[12px]", t.url)}>{url}</span>
            <span className="w-[52px]" />
          </div>
          <div className="flex">
            <div aria-hidden className={cn("flex w-16 shrink-0 flex-col items-center gap-2 border-r py-5", t.rail)}>
              <BrandMark size={20} />
              <span className="h-3" />
              {RAIL.map(({ label: name, Icon }) => (
                <span
                  key={name}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full",
                    name === active ? t.on : t.off,
                  )}
                >
                  <Icon size={19} weight={name === active ? "fill" : "regular"} />
                </span>
              ))}
            </div>
            <div aria-hidden={interactive ? undefined : true} className="min-w-0 flex-1">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The same page on a phone, for small screens: one device, centred, in a
 * dark bezel, with the status bar and the island, running off the bottom
 * of its section. The page inside is the phone layout of the same screen.
 */
export function PhoneScreen({ label, interactive = false, tone = "dark", children }: Common) {
  const t = THEME[tone];
  return (
    <div
      role={interactive ? "region" : "img"}
      aria-label={label}
      data-reveal="window"
      data-from="up"
      className={cn("relative mx-auto w-[20.5rem] max-w-full shrink-0 rounded-[3.25rem] p-[11px] ring-1", t.bezel)}
    >
      <div className={cn("relative h-[40rem] overflow-hidden rounded-[2.6rem]", t.phone)}>
        <div aria-hidden className="relative flex h-12 items-center justify-between px-7 pt-1 text-[13px] font-semibold">
          <span>9:41</span>
          <span className={cn("absolute top-2.5 left-1/2 h-7 w-[6.5rem] -translate-x-1/2 rounded-full", t.island)} />
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-[3px] border border-current opacity-70" />
          </span>
        </div>
        <div aria-hidden={interactive ? undefined : true}>{children}</div>
      </div>
    </div>
  );
}
