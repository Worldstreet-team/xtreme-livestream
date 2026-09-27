"use client";

import { useState, type ReactNode } from "react";
import { Lightning, Plus, Trash, X } from "@/components/icons";
import { SwitchField } from "@/components/ui/selection-controls";
import { Pill } from "@/components/ui/pill";
import { useAuth } from "@/lib/auth-context";
import { PADS } from "@/lib/audio-desk";
import { CARDS, LAYOUTS } from "@/lib/scene";
import {
  MAX_RULES,
  MIN_CHAT_RULE_COOLDOWN,
  RULE_TEMPLATES,
  RULE_TRIGGERS,
  TRIGGER_LABELS,
  describeAction,
  describeWhen,
  dollars,
  toBody,
  useShowRules,
  type RuleAction,
  type RuleWhen,
  type ShowRuleDraft,
  type ShowRuleView,
} from "@/lib/show-rules";
import { cn } from "@/lib/utils";

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";
const INPUT =
  "h-10 w-full min-w-0 rounded-full bg-tint/[0.06] px-4 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-tint/[0.09]";

const GIFT_AMOUNTS = [100, 500, 2000, 5000, 10_000];
const COOLDOWNS: { sec: 0 | 10 | 30 | 60 | 300; label: string }[] = [
  { sec: 0, label: "None" },
  { sec: 10, label: "10 s" },
  { sec: 30, label: "30 s" },
  { sec: 60, label: "1 min" },
  { sec: 300, label: "5 min" },
];
type ActionKind = RuleAction["do"];
const ADD_ACTIONS: { do: ActionKind; label: string }[] = [
  { do: "lower_third", label: "Lower third" },
  { do: "banner", label: "Banner" },
  { do: "sound", label: "Sound" },
  { do: "card", label: "Card" },
  { do: "layout", label: "Layout" },
  { do: "countdown", label: "Countdown" },
  { do: "hide", label: "Take down" },
];

/** What a new action starts as — words that fit what sets the rule off. */
function newAction(kind: ActionKind, when: RuleWhen): RuleAction {
  const who = TRIGGER_LABELS[when.kind].words.includes("user");
  switch (kind) {
    case "lower_third":
      return { do: "lower_third", title: who ? "Thank you, {user}!" : when.kind === "goal_reached" ? "Goal reached!" : "What a moment", subtitle: "", seconds: 8 };
    case "banner":
      return { do: "banner", text: who ? "Welcome, {user}!" : "Thank you all!", seconds: 15 };
    case "sound":
      return { do: "sound", pad: when.kind === "battle_lost" ? "sadtrombone" : "airhorn" };
    case "card":
      return { do: "card", card: "brb", seconds: null };
    case "layout":
      return { do: "layout", layout: "solo" };
    case "countdown":
      return { do: "countdown", minutes: 5, label: "" };
    case "hide":
      return { do: "hide", graphic: "lower-third" };
  }
}

function whenFor(kind: RuleWhen["kind"], current: RuleWhen): RuleWhen {
  if (kind === current.kind) return current;
  if (kind === "gift") return { kind, minMinor: 2000 };
  if (kind === "chat_word") return { kind, word: "!socials" };
  return { kind };
}

/** "4 min ago", "yesterday". */
function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return s < 172_800 ? "yesterday" : `${Math.floor(s / 86_400)} days ago`;
}

/** A row of choices, one of them on. */
function Choices<T extends string | number | null>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled || o.disabled}
            onClick={() => !on && onChange(o.value)}
            className={cn(
              "press h-8 rounded-full px-3 text-[12px] font-semibold transition-colors disabled:opacity-40",
              on ? "bg-inverse text-on-inverse" : "bg-tint/[0.06] text-foreground/85 enabled:hover:bg-tint/[0.1]"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const STAYS_SHORT = [5, 8, 15, 30].map((s) => ({ value: s as number | null, label: `${s} s` }));
const STAYS_LONG = [10, 15, 30, 60].map((s) => ({ value: s as number | null, label: s < 60 ? `${s} s` : "1 min" }));
const UNTIL = { value: null, label: "Until taken down" };

/** One action's fields. */
function ActionEditor({ action, onChange }: { action: RuleAction; onChange: (a: RuleAction) => void }) {
  switch (action.do) {
    case "lower_third":
      return (
        <div className="flex flex-col gap-2">
          <input value={action.title} maxLength={48} onChange={(e) => onChange({ ...action, title: e.target.value })} placeholder="Title" aria-label="Lower third title" className={INPUT} />
          <input value={action.subtitle} maxLength={72} onChange={(e) => onChange({ ...action, subtitle: e.target.value })} placeholder="A line under it (optional)" aria-label="Lower third line" className={INPUT} />
          <Choices label="Stays up" value={action.seconds} options={[...STAYS_SHORT, UNTIL]} onChange={(seconds) => onChange({ ...action, seconds })} />
        </div>
      );
    case "banner":
      return (
        <div className="flex flex-col gap-2">
          <input value={action.text} maxLength={100} onChange={(e) => onChange({ ...action, text: e.target.value })} placeholder="What the banner says" aria-label="Banner text" className={INPUT} />
          <Choices label="Stays up" value={action.seconds} options={[...STAYS_LONG, UNTIL]} onChange={(seconds) => onChange({ ...action, seconds })} />
        </div>
      );
    case "card":
      return (
        <div className="flex flex-col gap-2">
          <Choices
            label="Card"
            value={action.card}
            options={[...CARDS.map((c) => ({ value: c.id as typeof action.card, label: c.title })), { value: null, label: "Take it down" }]}
            onChange={(card) => onChange({ ...action, card, seconds: card ? action.seconds : null })}
          />
          {action.card && <Choices label="Stays up" value={action.seconds} options={[UNTIL, ...STAYS_LONG]} onChange={(seconds) => onChange({ ...action, seconds })} />}
        </div>
      );
    case "layout":
      return <Choices label="Layout" value={action.layout} options={LAYOUTS.map((l) => ({ value: l.id, label: l.label }))} onChange={(layout) => onChange({ ...action, layout })} />;
    case "countdown":
      return (
        <div className="flex flex-col gap-2">
          <Choices label="Minutes" value={action.minutes} options={[1, 3, 5, 10, 15].map((m) => ({ value: m, label: `${m} min` }))} onChange={(minutes) => onChange({ ...action, minutes })} />
          <input value={action.label} maxLength={40} onChange={(e) => onChange({ ...action, label: e.target.value })} placeholder="Label (optional)" aria-label="Countdown label" className={INPUT} />
        </div>
      );
    case "sound":
      return (
        <Choices
          label="Sound"
          value={action.pad}
          options={PADS.map((p) => ({ value: p.id, label: `${p.emoji} ${p.label}` }))}
          onChange={(pad) => onChange({ ...action, pad })}
        />
      );
    case "hide":
      return (
        <Choices
          label="Take down"
          value={action.graphic}
          options={[
            { value: "lower-third" as const, label: "Lower third" },
            { value: "banner" as const, label: "Banner" },
            { value: "countdown" as const, label: "Countdown" },
          ]}
          onChange={(graphic) => onChange({ ...action, graphic })}
        />
      );
  }
}

/** A rule being written: what sets it off, what it does, how long it rests. */
export function RuleEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: ShowRuleDraft;
  onSave: (body: ShowRuleDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState<ShowRuleDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = body.when;
  const then = body.then;
  const cooldown = body.cooldownSec;
  const chat = when.kind === "chat_word";
  const words = TRIGGER_LABELS[when.kind].words;

  const setWhen = (next: RuleWhen) =>
    setBody((b) => ({
      ...b,
      when: next,
      // A chat word rests at least 30 s — anyone can type it.
      cooldownSec: next.kind === "chat_word" && b.cooldownSec < MIN_CHAT_RULE_COOLDOWN ? 30 : b.cooldownSec,
    }));
  const setAction = (i: number, a: RuleAction) => setBody((b) => ({ ...b, then: b.then.map((x, j) => (j === i ? a : x)) }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that rule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[16px] bg-tint/[0.04] p-4 shadow-[inset_0_0_0_1px_var(--hairline-color)]">
      <input
        value={body.name}
        maxLength={40}
        onChange={(e) => setBody((b) => ({ ...b, name: e.target.value }))}
        placeholder="Name it (optional)"
        aria-label="Rule name"
        className={cn(INPUT, "font-semibold")}
      />

      <p className={cn(EYEBROW, "mt-4 mb-2")}>When</p>
      <Choices
        label="When"
        value={when.kind}
        options={RULE_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABELS[t].label }))}
        onChange={(kind) => setWhen(whenFor(kind, when))}
      />
      {when.kind === "gift" && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted-foreground">Worth at least</span>
          <Choices
            label="Worth at least"
            value={when.minMinor}
            options={GIFT_AMOUNTS.map((m) => ({ value: m, label: dollars(m) }))}
            onChange={(minMinor) => setWhen({ kind: "gift", minMinor })}
          />
        </div>
      )}
      {chat && (
        <input
          value={when.word}
          maxLength={24}
          onChange={(e) => setWhen({ kind: "chat_word", word: e.target.value.replace(/\s+/g, "") })}
          placeholder="!discord"
          aria-label="The chat word"
          className={cn(INPUT, "mt-2.5 font-mono")}
        />
      )}

      <p className={cn(EYEBROW, "mt-5 mb-2")}>Then</p>
      <ol className="flex flex-col gap-2">
        {then.map((a, i) => (
          <li key={i} className="rounded-[12px] bg-background/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold">{ADD_ACTIONS.find((x) => x.do === a.do)?.label}</span>
              {then.length > 1 && (
                <button
                  type="button"
                  onClick={() => setBody((b) => ({ ...b, then: b.then.filter((_, j) => j !== i) }))}
                  aria-label="Remove this step"
                  className="press flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-tint/[0.08] hover:text-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <ActionEditor action={a} onChange={(next) => setAction(i, next)} />
          </li>
        ))}
      </ol>
      {then.length < 4 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted-foreground">Add</span>
          {ADD_ACTIONS.map((x) => (
            <button
              key={x.do}
              type="button"
              onClick={() => setBody((b) => ({ ...b, then: [...b.then, newAction(x.do, b.when)] }))}
              className="press flex h-8 items-center gap-1 rounded-full bg-tint/[0.06] px-3 text-[12px] font-semibold text-foreground/85 hover:bg-tint/[0.1]"
            >
              <Plus size={12} />
              {x.label}
            </button>
          ))}
        </div>
      )}
      <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
        Words it can fill in: {words.map((w) => `{${w}}`).join(", ")}.
      </p>

      <p className={cn(EYEBROW, "mt-5 mb-2")}>Rest between</p>
      <Choices
        label="Rest between"
        value={cooldown}
        options={COOLDOWNS.map((c) => ({ value: c.sec, label: c.label, disabled: chat && c.sec < MIN_CHAT_RULE_COOLDOWN }))}
        onChange={(cooldownSec) => setBody((b) => ({ ...b, cooldownSec }))}
      />
      {chat && <p className="mt-2 text-[12px] leading-snug text-muted-foreground">Anyone can type a chat word, so it rests at least 30 s.</p>}

      {error && <p className="mt-3 rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Pill variant="primary" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save rule"}
        </Pill>
        <Pill variant="glass" onClick={onCancel} disabled={busy}>
          Cancel
        </Pill>
      </div>
    </div>
  );
}

/** A saved rule: on or off, what it does, how it's been doing — and a way to try it. */
function RuleCard({
  rule,
  onToggle,
  onEdit,
  onRemove,
  onTry,
}: {
  rule: ShowRuleView;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
  onTry: () => Promise<void>;
}) {
  const [trying, setTrying] = useState<"idle" | "busy" | "done" | string>("idle");
  const tryIt = async () => {
    setTrying("busy");
    try {
      await onTry();
      setTrying("done");
      setTimeout(() => setTrying("idle"), 2000);
    } catch (err) {
      setTrying(err instanceof Error ? err.message : "Couldn't try it");
    }
  };
  return (
    <li className={cn("rounded-[16px] p-4 transition-colors", rule.on ? "bg-tint/[0.045]" : "bg-tint/[0.02]")}>
      <SwitchField label={rule.name || describeWhen(rule.when)} checked={rule.on} onCheckedChange={onToggle} />
      <p className={cn("text-[13px] leading-snug", rule.on ? "text-foreground/85" : "text-muted-foreground")}>{describeWhen(rule.when)}:</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rule.then.map((a, i) => (
          <li key={i} className="max-w-full truncate rounded-[8px] bg-tint/[0.07] px-2 py-1 text-[12px] font-medium text-foreground/85">
            {describeAction(a)}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
          {rule.cooldownSec ? `Rests ${rule.cooldownSec < 60 ? `${rule.cooldownSec} s` : `${rule.cooldownSec / 60} min`}` : "No rest"}
          {" · "}
          {rule.fires ? `fired ${rule.fires} ${rule.fires === 1 ? "time" : "times"}${rule.firedAt ? `, last ${ago(rule.firedAt)}` : ""}` : "hasn't fired yet"}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void tryIt()}
            disabled={trying === "busy"}
            title="Do it now on your live stream"
            className="press flex h-8 items-center gap-1 rounded-full bg-tint/[0.07] px-3 text-[12px] font-semibold text-foreground hover:bg-tint/[0.11] disabled:opacity-50"
          >
            <Lightning size={12} weight="fill" className="text-ember-hi" />
            {trying === "done" ? "Done" : "Try"}
          </button>
          <button type="button" onClick={onEdit} className="press h-8 rounded-full bg-tint/[0.07] px-3 text-[12px] font-semibold text-foreground hover:bg-tint/[0.11]">
            Edit
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${rule.name || "this rule"}`}
            className="press flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-chili/15 hover:text-chili-hi"
          >
            <Trash size={14} />
          </button>
        </div>
      </div>
      {trying !== "idle" && trying !== "busy" && trying !== "done" && <p className="mt-2 text-[12px] text-chili-hi">{trying}</p>}
    </li>
  );
}

/**
 * Show rules (Phase 3): "when X happens, do Y" — a thank-you on screen for
 * a big gift, a welcome for new allies, a sound for a battle won. They run
 * by themselves while you're live, whoever's at the controls.
 */
export function ShowRules() {
  const { user } = useAuth();
  const { rules, error, create, update, remove, tryRule } = useShowRules(Boolean(user));
  /** What's being written: a new rule (id null) or a saved one. */
  const [editing, setEditing] = useState<{ id: string | null; body: ShowRuleDraft } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const full = (rules?.length ?? 0) >= MAX_RULES;

  const save = async (body: ShowRuleDraft) => {
    if (editing?.id) await update(editing.id, body);
    else await create(body);
    setEditing(null);
  };
  const toggle = async (rule: ShowRuleView, on: boolean) => {
    setProblem(null);
    try {
      await update(rule.id, { ...toBody(rule), on });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't change that rule");
    }
  };
  const drop = async (rule: ShowRuleView) => {
    setProblem(null);
    try {
      await remove(rule.id);
    } catch {
      setProblem("Couldn't remove that rule — try again.");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <div className={cn(TILE, "p-5 md:p-6 lg:col-span-8")}>
        <div className="flex items-center justify-between gap-3">
          <p className={EYEBROW}>Your rules{rules ? ` · ${rules.filter((r) => r.on).length} on` : ""}</p>
          {!editing && !full && rules && (
            <Pill size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({ id: null, body: RULE_TEMPLATES[0]!.body })}>
              Add a rule
            </Pill>
          )}
        </div>
        {(error || problem) && <p className="mt-3 rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">{error ?? problem}</p>}
        {editing && editing.id === null && (
          <div className="mt-3">
            <RuleEditor key="new" initial={editing.body} onSave={save} onCancel={() => setEditing(null)} />
          </div>
        )}
        {rules === null ? (
          !error && <div className="mt-3 h-28 animate-pulse rounded-[16px] bg-tint/[0.04]" />
        ) : rules.length === 0 && !editing ? (
          <p className="mt-3 rounded-[16px] bg-tint/[0.03] px-4 py-6 text-center text-[13px] leading-relaxed text-muted-foreground">
            No rules yet. Start from one on the right, or add your own — they run by themselves while you&apos;re live.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {rules.map((rule) =>
              editing?.id === rule.id ? (
                <li key={rule.id}>
                  <RuleEditor initial={editing.body} onSave={save} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={(on) => void toggle(rule, on)}
                  onEdit={() => setEditing({ id: rule.id, body: toBody(rule) })}
                  onRemove={() => void drop(rule)}
                  onTry={() => tryRule(rule.id)}
                />
              )
            )}
          </ul>
        )}
        {full && <p className="mt-3 text-[12px] text-muted-foreground">That&apos;s {MAX_RULES} rules — the most a channel can have.</p>}
      </div>

      <aside className={cn(TILE, "p-5 md:p-6 lg:col-span-4")}>
        <p className={EYEBROW}>Start from one</p>
        <ul className="mt-3 flex flex-col gap-2">
          {RULE_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={Boolean(editing) || full || !rules}
                onClick={() => setEditing({ id: null, body: t.body })}
                className="press w-full rounded-[14px] bg-tint/[0.045] px-3.5 py-3 text-left transition-colors enabled:hover:bg-tint/[0.07] disabled:opacity-50"
              >
                <span className="block text-[13.5px] font-semibold">{t.title}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                  {describeWhen(t.body.when)}: {t.body.then.map(describeAction).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
          Rules change the picture the way a tap in the studio would, for everyone watching. Sounds play through your studio&apos;s audio desk —
          turn it on under Sound. <span className="text-foreground/80">Try</span> runs a rule on your live stream now, with sample words.
        </p>
      </aside>
    </div>
  );
}
