"use client";

import { useState, type ReactNode } from "react";
import { Broadcast, Microphone, VideoCamera, CameraRotate, HouseLine, Compass, Pulse, HeartStraight } from "@/components/icons";
import { GIFT_CATALOG } from "@/lib/gifts";
import { cn } from "@/lib/utils";
import { Chip, GiftReceipt, GiftToken, LiveBadge, Money, Pill, UserAvatar } from "@/components/xtream";
import { Section, Spec, StageNote } from "./doc-parts";
import { STAGE } from "./sample-data";

const bank = GIFT_CATALOG.find((g) => g.id === "bank")!;
const tsion = GIFT_CATALOG.find((g) => g.id === "tsion-car")!;

function Hex({ children }: { children: string }) {
  return <code className="font-mono text-[11px] opacity-80">{children}</code>;
}

/* ------------------------------------------------------------------ */

export function Colour() {
  return (
    <Section
      id="colour"
      act="Foundations · colour"
      title="Two colours and a ring."
      intro={
        <>
          The chili gives us everything. Its body is <b className="text-chili-hi">Chili</b>, for live and action; its
          highlight is <b className="text-ember-hi">Ember</b>, for energy and choice. Their gradient — <b className="text-heat">heat</b>{" "}
          — is a special effect with exactly three homes. White is the neutral primary; gold is money and nothing else.
        </>
      }
    >
      <Spec
        name="Chili and Ember"
        summary="The two brand colours, used everywhere. Chili fills carry white text; Ember fills carry dark ink, never white. Each has a lighter -hi for text and icons on the warm black, and a -lo for pressed."
        rules={[
          <>Chili: LIVE, Go live once you’re on air, recording, counts that need you now.</>,
          <>Ember: the focus ring, anything selected or switched on, progress, links, streaks, the ×2 window.</>,
          <>Never both on one control. Two reds side by side read as an error.</>,
        ]}
        wire={`// Tailwind roles (app/design-system.css)
bg-chili text-white      text-chili-hi      hover:bg-chili-lo
bg-ember text-on-ember   text-ember-hi      ring-ember
shadow-glow-chili        shadow-glow-ember`}
      >
        <div className="grid h-full gap-3 sm:grid-cols-2">
          <div className="flex min-h-[210px] flex-col justify-between rounded-panel bg-chili p-5 text-white shadow-glow-chili">
            <div>
              <p className="font-wide text-[28px] leading-none font-bold tracking-[-0.03em]">Chili</p>
              <p className="mt-1 text-[13px] text-white/85">Live and action</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LiveBadge size="md" />
              <span className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-[#0b0708]">On air 12:41</span>
              <span className="flex size-6 items-center justify-center rounded-full bg-white text-[11px] font-bold text-chili">3</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/90">
              <span>fill <Hex>#E3122A</Hex></span>
              <span>-hi <Hex>#FF5A66</Hex></span>
              <span>-lo <Hex>#B30E1F</Hex></span>
            </div>
          </div>
          <div className="flex min-h-[210px] flex-col justify-between rounded-panel bg-ember p-5 text-on-ember">
            <div>
              <p className="font-wide text-[28px] leading-none font-bold tracking-[-0.03em]">Ember</p>
              <p className="mt-1 text-[13px] text-on-ember/80">Energy and choice</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-6 w-11 items-center rounded-full bg-on-ember p-0.5"><span className="ml-5 size-5 rounded-full bg-ember" /></span>
              <span className="rounded-full bg-on-ember px-2.5 py-1 text-[12px] font-bold text-ember-hi">7-day streak</span>
              <span className="rounded-full px-2.5 py-1 text-[12px] font-bold shadow-[inset_0_0_0_2px_var(--on-ember)]">Focus</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-on-ember/90">
              <span>fill <Hex>#F85810</Hex></span>
              <span>-hi <Hex>#FF8A4C</Hex></span>
              <span>ink <Hex>#1C0A03</Hex></span>
            </div>
          </div>
        </div>
      </Spec>

      <Spec
        name="Heat — the ring"
        summary="Chili into Ember into gold. It's a special effect, so it only has two homes. Anywhere else it turns into decoration, and the moments stop reading as moments."
        rules={[
          <>Rings: live and story avatars, the burst when you ally someone.</>,
          <>Not Go live: that button is solid Chili (owner, 2026-09-24).</>,
          <>Gift moments: the burst on the picture, a picked or sent gift, the combo count.</>,
          <>Never on backgrounds, cards, headings, dividers or ordinary buttons.</>,
        ]}
        stage={{ picture: STAGE.group, scrim: "heavy" }}
        wire={`import { UserAvatar, Pill, GiftToken } from "@/components/xtream";

<UserAvatar src={a} name={n} ring="live" />      // rings
<Pill variant="live" icon={<Broadcast />}>Go live</Pill>  // solid Chili, not heat
<GiftToken gift={g} state="landed" combo={3} />  // gift moments
// raw: bg-heat · text-heat · shadow-glow-heat`}
      >
        <div className="flex h-full flex-col justify-between gap-6">
          <div className="h-3 w-full rounded-full bg-heat shadow-glow-heat" />
          <div className="grid grid-cols-3 items-end gap-3 text-center">
            <div className="flex flex-col items-center gap-3">
              <UserAvatar name="Ada Okafor" size={56} ring="live" ringGapClassName="bg-black" />
              <StageNote>Rings</StageNote>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Pill variant="live" size="lg" icon={<Broadcast size={18} weight="fill" />}>
                Go live
              </Pill>
              <StageNote>Go live — solid Chili</StageNote>
            </div>
            <div className="flex flex-col items-center gap-3">
              <GiftToken gift={tsion} state="landed" combo={3} size="sm" />
              <StageNote>Gift moments</StageNote>
            </div>
          </div>
        </div>
      </Spec>

      <Spec
        name="White, gold and foil"
        summary="White is the neutral primary: the one action on a surface, and whatever is switched on in a row of chips or tabs. Gold is money: amounts, the wallet, prices. Foil, gold's shine, belongs to the Wolf's pelt and the very top of a board."
        rules={[<>If it isn’t a currency amount, it isn’t gold.</>, <>Foil appears once per screen, at most.</>]}
        wire={`<Pill variant="primary">Watch</Pill>     // white
<Chip active>For you</Chip>               // white = on
<Money cents={250000} />                  // gold, thin & wide
text-value · bg-foil · text-foil`}
      >
        <div className="flex h-full flex-col justify-center gap-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill variant="primary">Watch</Pill>
            <Chip active>For you</Chip>
            <Chip>Music</Chip>
          </div>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <Money cents={250000} size="lg" />
            <Money cents={1000000} size="md" />
            <span className="rounded-full bg-foil px-2.5 py-1 text-[9px] font-bold tracking-[0.2em] text-[#1a1206] uppercase">Wears the pelt</span>
          </div>
        </div>
      </Spec>

      <Spec
        name="Warm neutrals"
        summary="A black with a hint of red, never a flat grey. Each step up is one surface: the page, a card, something raised, a control. Hairlines are the palest warm white."
        wire={`bg-ground  bg-surface (bg-card)  bg-surface-raised (bg-popover)
bg-control  hover:bg-control-hover  border-hairline
text-foreground  text-muted-foreground`}
      >
        <div className="grid h-full grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            ["Ground", "#0B0708", "bg-ground"],
            ["Surface", "#141011", "bg-surface"],
            ["Raised", "#1C1617", "bg-surface-raised"],
            ["Control", "#261E1F", "bg-control"],
            ["Control hover", "#30272A", "bg-control-hover"],
            ["Hairline", "rgb 255 236 230 / .1", "border-hairline"],
          ].map(([name, hex, cls]) => (
            <div key={name} className={cn("flex min-h-[88px] flex-col justify-end rounded-[16px] p-3 shadow-[inset_0_0_0_1px_var(--hairline-color)]", cls !== "border-hairline" && cls)}>
              <p className="text-[13px] font-semibold">{name}</p>
              <p className="font-mono text-[10.5px] text-muted-foreground">{hex}</p>
            </div>
          ))}
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

export function Type() {
  const rows: [string, string, ReactNode][] = [
    ["Display · ds-display", "Archivo 118% · 700", <span key="d" className="ds-display text-[clamp(2.4rem,6vw,4rem)] leading-[0.95]">They&apos;re waiting.</span>],
    ["Title · text-title", "Archivo 118% · 700", <span key="t" className="ds-display text-title">Golden hour on the roof</span>],
    ["Heading · text-heading", "DM Sans 600", <span key="h" className="text-heading font-semibold">Top allies this stream</span>],
    ["Body · text-body", "DM Sans 400", <span key="b" className="text-body text-foreground/85">Every stream posts to the feed, so the conversation keeps going.</span>],
    ["Label · text-label", "DM Sans 500", <span key="l" className="text-label font-medium">Category</span>],
    ["Caption · text-caption", "DM Sans · muted", <span key="c" className="text-caption text-muted-foreground">Ada Okafor · IRL · 8.4K watching</span>],
    ["Money · font-money", "Archivo 125% · 300", <Money key="m" cents={250000} size="lg" />],
    ["Time · font-mono", "Geist Mono", <span key="n" className="font-mono text-[18px] tabular-nums">01:42 · 12:41:08</span>],
    ["Caps · caps", "tracked +0.16em", <span key="k" className="caps text-[11px] font-bold text-muted-foreground">Wolf of WorldStreet · this week</span>],
  ];
  return (
    <Section
      id="type"
      act="Foundations · type"
      title="Wide for the voice, thin for the money."
      intro="Archivo's width axis carries the brand. Headlines run wide at 118%. Money runs widest and thin at 125%, borrowed from Gold Floor so an amount looks like it costs something. DM Sans does the interface, and Geist Mono keeps time."
    >
      <Spec
        name="The scale"
        wide
        summary="Sizes are tokens, so a heading is `text-title`, not a pixel value. Display and title are fluid. Everything else stays fixed, so an interface doesn't shift under your finger."
        wire={`<h1 className="ds-display text-display">…</h1>
<h2 className="ds-display text-title">…</h2>
<p className="text-body">…</p>
<span className="font-wide">…</span>   // Archivo at 118%
<Money cents={c} />                     // or className="font-money"`}
      >
        <div className="grid">
          {rows.map(([role, face, sample]) => (
            <div key={role} className="grid gap-2 border-t border-hairline py-4 first:border-t-0 first:pt-0 md:grid-cols-[13rem_minmax(0,1fr)] md:items-baseline md:gap-6">
              <div>
                <p className="font-mono text-[11px] text-foreground/80">{role}</p>
                <p className="font-mono text-[10.5px] text-muted-foreground">{face}</p>
              </div>
              <div className="min-w-0">{sample}</div>
            </div>
          ))}
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

export function Shape() {
  const shapes: [string, string, string][] = [
    ["Field", "14px · rounded-control", "rounded-control"],
    ["Card, thumbnail", "16px · rounded-sm", "rounded-sm"],
    ["Panel", "20px · rounded-panel", "rounded-panel"],
    ["Media hero", "24px · rounded-2xl", "rounded-2xl"],
    ["Sheet, dialog", "28px · rounded-overlay", "rounded-overlay"],
    ["Button, chip, badge", "pill · rounded-full", "rounded-full"],
  ];
  return (
    <Section
      id="shape"
      act="Foundations · shape"
      title="Soft everywhere, never sharp."
      intro="B is rounder than the old 10px system. Buttons, chips and badges are pills, and avatars are orbs. Corners grow with the surface: a field is 14px and a sheet is 28px. Nothing has a square corner."
    >
      <Spec
        name="Radii"
        wide
        summary="The base radius drives every rounded-* utility, so rounded-sm is 16px across the app's cards and thumbnails. Panels, sheets and fields have their own named tokens."
        wire={`rounded-control   // 14 — inputs, selects
rounded-sm        // 16 — cards, thumbnails (the app's card radius)
rounded-panel     // 20 — panels, spec cards
rounded-overlay   // 28 — sheets, dialogs
rounded-full      // pills and avatars`}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shapes.map(([name, note, cls]) => (
            <div key={name} className={cn("flex h-28 flex-col justify-end bg-surface-raised p-3.5 shadow-[inset_0_0_0_1px_var(--hairline-color)]", cls, cls === "rounded-full" && "items-center text-center")}>
              <p className="text-[13px] font-semibold">{name}</p>
              <p className="font-mono text-[10.5px] text-muted-foreground">{note}</p>
            </div>
          ))}
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

export function Light() {
  const [on, setOn] = useState<"mic" | "cam" | "flip">("cam");
  return (
    <Section
      id="light"
      act="Foundations · light"
      title="Objects on the picture, glass only for getting around."
      intro="Anything on video is painted black at 55%, with a hairline edge and a lit top. It's never blurred, so it reads on any frame. The one control that's on turns white. Glow is the only other light, and glass is reserved for navigation."
    >
      <Spec
        name="The object language"
        summary="Three finishes, each with a job. obj is for anything you touch on a picture. obj-on is the one that's switched on. Glows light the colour a thing already is: chili, ember, white or heat."
        rules={[<>No blur, except the navigation bar and the sticky header.</>, <>One lit (white) control per group.</>]}
        stage={{ picture: STAGE.performer, scrim: "light" }}
        wire={`<button className="obj press size-11 rounded-full">…</button>
<button className="obj-on press size-11 rounded-full">…</button>
shadow-glow-chili · shadow-glow-ember · shadow-glow-white · shadow-glow-heat
<nav className="tabbar-glass">…</nav>   // navigation only`}
      >
        <div className="flex h-full min-h-[300px] flex-col justify-between gap-6">
          <div className="flex items-center gap-2.5">
            {(
              [
                ["mic", Microphone, "Microphone"],
                ["cam", VideoCamera, "Camera"],
                ["flip", CameraRotate, "Flip camera"],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                aria-label={label}
                aria-pressed={on === key}
                onClick={() => setOn(key)}
                className={cn("press flex size-11 items-center justify-center rounded-full", on === key ? "obj-on" : "obj text-white")}
              >
                <Icon size={20} weight={on === key ? "fill" : "regular"} />
              </button>
            ))}
            <span className="obj ml-auto rounded-full px-3 py-1.5 text-[12px] font-semibold text-white">
              <span className="mr-1.5 inline-block size-1.5 rounded-full bg-chili align-middle" />
              LIVE <span className="font-mono">12:41</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="size-10 rounded-full bg-chili shadow-glow-chili" title="glow-chili" />
            <span className="size-10 rounded-full bg-ember shadow-glow-ember" title="glow-ember" />
            <span className="size-10 rounded-full bg-white shadow-glow-white" title="glow-white" />
            <span className="size-10 rounded-full bg-heat shadow-glow-heat" title="glow-heat" />
            <StageNote className="ml-1">Glows: chili · ember · white · heat</StageNote>
          </div>
          <nav aria-label="Example navigation" className="tabbar-glass -mx-5 -mb-5 grid grid-cols-4 md:-mx-7 md:-mb-7">
            {(
              [
                ["Home", HouseLine, true],
                ["Browse", Compass, false],
                ["Live feed", Pulse, false],
                ["Following", HeartStraight, false],
              ] as const
            ).map(([label, Icon, active]) => (
              <span key={label} className={cn("flex h-[58px] flex-col items-center justify-center gap-1 text-[10.5px] font-semibold", active ? "text-foreground" : "text-muted-foreground")}>
                <Icon size={21} weight={active ? "fill" : "regular"} />
                {label}
              </span>
            ))}
          </nav>
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

/** A tile that plays one motion. The demo inside is a picture of a control
 *  (inert), so the only button is Replay — no buttons inside buttons. */
function MotionTile({ label, onReplay, children }: { label: string; onReplay: () => void; children: ReactNode }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-between gap-4 rounded-[18px] bg-surface-raised p-4 shadow-[inset_0_0_0_1px_var(--hairline-color)]">
      <div inert className="flex flex-1 items-center justify-center">
        {children}
      </div>
      <div className="flex w-full items-center justify-between gap-2">
        <span className="caps font-mono text-[9.5px] text-muted-foreground">{label}</span>
        <button type="button" onClick={onReplay} className="press rounded-full bg-control px-2.5 py-1 text-[11.5px] font-semibold text-foreground hover:bg-control-hover">
          Replay
        </button>
      </div>
    </div>
  );
}

export function Motion() {
  const [n, setN] = useState({ spring: 0, burst: 0, sheen: 0, wipe: 0 });
  const replay = (k: keyof typeof n) => setN((s) => ({ ...s, [k]: s[k] + 1 }));
  return (
    <Section
      id="motion"
      act="Foundations · motion"
      title="Springs for people, sheens for money, wipes for broadcast."
      intro="Every movement means something happened. Social things spring and overshoot. Value moves with a slow sheen, because money shouldn't bounce. Broadcast graphics wipe in the way On Air does. With reduced motion on, everything lands instantly."
    >
      <Spec
        name="Four motions"
        wide
        summary="Replay any of them. The keyframes live in app/design-system.css (xt-spring-in, xt-ring-burst, xt-sheen, xt-wipe), with --ease-spring and --ease-out as the curves. Components use them by name; nothing hand-rolls its own."
        wire={`transition-timing-function: var(--ease-spring)   // cubic-bezier(.34,1.56,.64,1)
animate-[xt-spring-in_.42s_var(--ease-spring)_both]
animate-[xt-ring-burst_.7s_var(--ease-out)_both]
animate-[xt-sheen_1.5s_var(--ease-out)_both]
motion-safe:…  /  motion-reduce:…`}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MotionTile label="Spring · social" onReplay={() => replay("spring")}>
            <span key={n.spring} className="motion-safe:animate-[xt-spring-in_.52s_var(--ease-spring)_both]">
              <Chip active>For you</Chip>
            </span>
          </MotionTile>
          <MotionTile label="Burst · a moment" onReplay={() => replay("burst")}>
            <span className="relative inline-flex">
              <span key={n.burst} aria-hidden className="absolute -inset-1.5 rounded-full bg-heat p-[2px] [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)] motion-safe:animate-[xt-ring-burst_.8s_var(--ease-out)_both]" />
              <Pill variant="glass" size="md">Following</Pill>
            </span>
          </MotionTile>
          <MotionTile label="Sheen · value" onReplay={() => replay("sheen")}>
            <GiftReceipt key={n.sheen} giftName={bank.name} art={bank.art} emoji={bank.emoji} cents={bank.usdMinor} from="Amara" to="Ada" at="17:42:08" className="max-w-full" />
          </MotionTile>
          <MotionTile label="Wipe · broadcast" onReplay={() => replay("wipe")}>
            <span key={n.wipe} className="flex items-center overflow-hidden rounded-full bg-black/70 text-[12px] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] motion-safe:animate-[xt-wipe_.45s_cubic-bezier(.7,0,.2,1)_both]">
              <span className="bg-chili px-2.5 py-1.5">GIFT</span>
              <span className="px-2.5">Amara sent the Tsion Car</span>
            </span>
          </MotionTile>
        </div>
      </Spec>
    </Section>
  );
}
