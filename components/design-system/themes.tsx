"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Heart } from "@/components/icons";
import { GIFT_CATALOG } from "@/lib/gifts";
import { cn } from "@/lib/utils";
import { CapsuleTabs } from "@/components/ui/capsule-tabs";
import { ThemeSwitch } from "@/components/app/theme-switch";
import { Badge, ChatBubble, Chip, GiftToken, Input, LiveBadge, Money, Pill, PillTabs, SwitchField, UserAvatar } from "@/components/xtream";
import { Code, Section } from "./doc-parts";

const rose = GIFT_CATALOG[0]!;

/** Token groups, each swatch named by the Tailwind class you'd write. */
const SURFACES = [
  { cls: "bg-ground", label: "ground" },
  { cls: "bg-surface", label: "surface" },
  { cls: "bg-surface-raised", label: "surface-raised" },
  { cls: "bg-control", label: "control" },
  { cls: "bg-control-hover", label: "control-hover" },
  { cls: "bg-muted", label: "muted" },
];
const TINTS = ["bg-tint/[0.04]", "bg-tint/[0.06]", "bg-tint/[0.08]", "bg-tint/[0.12]"];
const INKS = [
  { cls: "text-foreground", label: "foreground" },
  { cls: "text-subtle", label: "subtle" },
  { cls: "text-muted-foreground", label: "muted-foreground" },
  { cls: "text-faint", label: "faint" },
];
const ROLES = [
  { cls: "text-chili-hi", label: "chili-hi" },
  { cls: "text-ember-hi", label: "ember-hi" },
  { cls: "text-value", label: "value" },
  { cls: "text-success", label: "success" },
  { cls: "text-warning", label: "warning" },
  { cls: "text-info", label: "info" },
  { cls: "text-destructive", label: "destructive" },
];
const TONES = [
  { cls: "bg-tone-red text-chili-hi", label: "tone-red" },
  { cls: "bg-tone-ember text-ember-hi", label: "tone-ember" },
  { cls: "bg-tone-amber text-value", label: "tone-amber" },
  { cls: "bg-tone-green text-tone-green-ink", label: "tone-green" },
  { cls: "bg-tone-sky text-tone-sky-ink", label: "tone-sky" },
];

/** The resolved value of a swatch in its own theme, read off the page. */
function useResolved(prop: "backgroundColor" | "color") {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A pinned column never flips, so one read is enough.
    setValue(toHex(getComputedStyle(el)[prop]));
  }, [prop]);
  return { ref, value };
}

function toHex(rgb: string) {
  const m = rgb.match(/[\d.]+/g);
  if (!m || m.length < 3) return rgb;
  const [r, g, b, a] = m.map(Number);
  const hex = "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
  return a !== undefined && a < 1 ? `${hex} · ${Math.round(a * 100)}%` : hex;
}

function Swatch({ cls, label }: { cls: string; label: string }) {
  const { ref, value } = useResolved("backgroundColor");
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span ref={ref} className={cn("size-9 shrink-0 rounded-[10px] shadow-[inset_0_0_0_1px_var(--hairline-color)]", cls)} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-mono text-[11px] text-foreground">{label}</span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{value || " "}</span>
      </span>
    </div>
  );
}

function Ink({ cls, label }: { cls: string; label: string }) {
  const { ref, value } = useResolved("color");
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span ref={ref} className={cn("truncate text-[14px] font-semibold", cls)}>
        {label}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{value}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <p className="caps font-mono text-[9.5px] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

/** One theme, pinned: everything inside resolves that theme's tokens. */
function Column({ theme }: { theme: "dark" | "light" }) {
  const [tab, setTab] = useState<"chat" | "gifts" | "fans">("chat");
  const [seg, setSeg] = useState<"all" | "live">("all");
  const [on, setOn] = useState(true);
  return (
    <div data-theme={theme} className="grid min-w-0 content-start gap-7 rounded-panel bg-background p-5 shadow-[inset_0_0_0_1px_var(--hairline-color)] md:p-6">
      <div className="flex items-center justify-between">
        <p className="font-wide text-[20px] font-bold tracking-[-0.025em]">{theme === "dark" ? "Dark" : "Light"}</p>
        <code className="rounded-full bg-tint/[0.06] px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">data-theme=&quot;{theme}&quot;</code>
      </div>

      <Group title="Surfaces">
        <div className="grid grid-cols-2 gap-3">
          {SURFACES.map((s) => (
            <Swatch key={s.label} {...s} />
          ))}
        </div>
      </Group>

      <Group title="Tint — overlays on any surface">
        <div className="grid grid-cols-4 gap-2 rounded-[12px] bg-surface p-2">
          {TINTS.map((t) => (
            <span key={t} className={cn("flex h-12 items-end rounded-[8px] p-1.5 font-mono text-[9.5px] text-muted-foreground", t)}>
              {t.match(/0\.\d+/)?.[0]}
            </span>
          ))}
        </div>
      </Group>

      <Group title="Ink">
        <div className="grid gap-1.5 rounded-[12px] bg-surface p-3.5">
          {INKS.map((i) => (
            <Ink key={i.label} {...i} />
          ))}
        </div>
      </Group>

      <Group title="Roles — words">
        <div className="grid gap-1.5 rounded-[12px] bg-surface p-3.5">
          {ROLES.map((i) => (
            <Ink key={i.label} {...i} />
          ))}
        </div>
      </Group>

      <Group title="Fills">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-inverse px-3 py-1.5 text-[12.5px] font-semibold text-on-inverse">inverse</span>
          <span className="rounded-full bg-chili px-3 py-1.5 text-[12.5px] font-semibold text-white">chili</span>
          <span className="rounded-full bg-ember px-3 py-1.5 text-[12.5px] font-semibold text-on-ember">ember</span>
          <span className="rounded-full bg-heat px-3 py-1.5 text-[12.5px] font-semibold text-white">heat</span>
          {TONES.map((t) => (
            <span key={t.label} className={cn("rounded-full px-3 py-1.5 text-[12.5px] font-semibold", t.cls)}>
              {t.label}
            </span>
          ))}
        </div>
      </Group>

      <Group title="Actions">
        <div className="flex flex-wrap items-center gap-2">
          <Pill variant="primary" icon={<Heart size={16} weight="fill" />}>Ally</Pill>
          <Pill variant="glass">Share</Pill>
          <Pill variant="live">Go live</Pill>
          <Pill variant="ember">Claim</Pill>
          <Pill variant="ghost">Later</Pill>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill variant="soft" tone="red" size="sm">Report</Pill>
          <Pill variant="soft" tone="ember" size="sm">Streak</Pill>
          <Pill variant="soft" tone="amber" size="sm">$25</Pill>
          <Pill variant="soft" tone="green" size="sm">Paid</Pill>
          <Pill variant="soft" tone="sky" size="sm">Info</Pill>
        </div>
      </Group>

      <Group title="Status and discovery">
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge />
          <Badge variant="muted">Replay</Badge>
          <Badge variant="outline">Booked</Badge>
          <Money cents={250000} size="sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip active>For you</Chip>
          <Chip live>Music</Chip>
          <Chip>Markets</Chip>
        </div>
        <PillTabs
          label={`Tabs, ${theme}`}
          value={tab}
          onChange={setTab}
          items={[
            { id: "chat", label: "Chat", count: 12 },
            { id: "gifts", label: "Gifts" },
            { id: "fans", label: "Fans" },
          ]}
        />
        <CapsuleTabs
          label={`Segments, ${theme}`}
          value={seg}
          onChange={setSeg}
          items={[
            { id: "all", label: "All" },
            { id: "live", label: "Live now" },
          ]}
          className="w-fit"
        />
      </Group>

      <Group title="Forms">
        <Input placeholder="Search streams" aria-label={`Search, ${theme}`} className="h-11 px-4" />
        <SwitchField label="Tell my followers" description="The moment you go live." checked={on} onCheckedChange={setOn} />
      </Group>

      <Group title="People, gifts, chat">
        <div className="flex flex-wrap items-center gap-4">
          <UserAvatar name="Ada Okafor" size={44} ring="live" />
          <UserAvatar name="Tolu B" size={44} ring="seen" />
          <GiftToken gift={rose} size="sm" />
          <GiftToken gift={rose} size="sm" state="picked" />
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <ChatBubble name="nneka">this is the one 🔥</ChatBubble>
          <ChatBubble kind="host" name="Ada">welcome in</ChatBubble>
        </div>
      </Group>
    </div>
  );
}

/** Light and dark, side by side: every token, and the parts that wear them. */
export function Themes() {
  return (
    <Section
      id="themes"
      act="Foundations · light and dark"
      title="Same roles, two grounds."
      intro={
        <>
          Dark is the room; light is the landing&apos;s paper. The roles don&apos;t move: Chili is live, Ember is choice,
          gold is money, and the neutral primary is whichever ink stands out — white at night, near-black on paper. Words
          in a role get a deeper <b className="text-chili-hi">-hi</b> on paper so they hold AA. Video never changes:
          players, the stage and anything over a picture stay dark in both.
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-surface p-4 shadow-[inset_0_0_0_1px_var(--hairline-color)]">
        <p className="text-[14px] text-subtle">The whole page follows your choice; the two columns below are pinned.</p>
        <ThemeSwitch size="sm" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Column theme="dark" />
        <Column theme="light" />
      </div>
      <Code>{`// Theme-safe classes (app/globals.css)
bg-tint/[0.06]            // was bg-white/[0.06] — overlays, hovers, wells
border-tint/[0.06]        // hairlines; or shadow-[inset_0_0_0_1px_var(--hairline-color)]
bg-inverse text-on-inverse  // was bg-white text-[#0b0708] — the neutral primary
text-foreground · text-subtle · text-muted-foreground · text-faint
bg-tone-red · bg-tone-green text-tone-green-ink   // soft states
shadow-popover            // menus and popovers
<div data-theme="dark">   // a picture, a player, a sheet over video — stays dark`}</Code>
    </Section>
  );
}
