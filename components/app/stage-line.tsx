"use client";

import {
  STAGE_ACCOUNT_DAYS,
  STAGE_FAN_LEVEL,
  STAGE_REQUEST_RULES,
  type StageAccountDays,
  type StageRequestRule,
  type StageStanding,
} from "@xtreme/contracts";
import { cn } from "@/lib/utils";

/**
 * The request line (producer mode): who can raise a hand to join the stage
 * and how old their account must be — the host's call, shown to their
 * producers as it stands — and, beside each name that asks, where that
 * person stands with the channel.
 */

export type { StageAccountDays, StageRequestRule, StageStanding };

export interface StageLineRule {
  who: StageRequestRule;
  accountDays: StageAccountDays;
}

export const DEFAULT_STAGE_LINE: StageLineRule = { who: "everyone", accountDays: 0 };

const WHO: Record<StageRequestRule, { label: string; hint: string }> = {
  everyone: { label: "Everyone", hint: "Anyone signed in can ask to join." },
  allies: { label: "Allies", hint: "Only people who ally with the channel can ask." },
  fans: { label: `Fans ${STAGE_FAN_LEVEL}+`, hint: `Only fans at level ${STAGE_FAN_LEVEL} or more — people who keep watching and chatting.` },
  off: { label: "Nobody", hint: "The line is closed. Moderators and producers can still ask." },
};
const AGE: Record<StageAccountDays, string> = { 0: "Any age", 1: "1 day+", 7: "1 week+" };

/** The line off the wire (settings, an event), as far as it makes sense. */
export function readStageLine(raw: unknown): StageLineRule {
  if (!raw || typeof raw !== "object") return DEFAULT_STAGE_LINE;
  const r = raw as Record<string, unknown>;
  return {
    who: STAGE_REQUEST_RULES.includes(r.who as StageRequestRule) ? (r.who as StageRequestRule) : "everyone",
    accountDays: STAGE_ACCOUNT_DAYS.includes(r.accountDays as StageAccountDays) ? (r.accountDays as StageAccountDays) : 0,
  };
}

/** A requester's standing off the wire, or null when it wasn't taken (an older request). */
export function readStanding(raw: unknown): StageStanding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
  return { ally: r.ally === true, level: num(r.level), hours: num(r.hours) };
}

/** Where someone asking stands, under their name: an ally or not, their fan level, the hours they've watched. */
export function StandingLine({ standing }: { standing: StageStanding | null | undefined }) {
  if (!standing) return null;
  const hours = Math.round(standing.hours);
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11.5px] leading-none whitespace-nowrap text-muted-foreground">
      {standing.ally ? <span className="font-semibold text-ember-hi">Ally</span> : <span>Not an ally</span>}
      {standing.level > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="font-semibold text-foreground/80">Fan {standing.level}</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span className="truncate">{hours >= 1 ? `${hours} h watched` : "new here"}</span>
    </span>
  );
}

/**
 * Keep a guest on screen in a corner whatever the layout — a sign-language
 * interpreter (accessibility). One at a time; the auto-director and the
 * layouts leave them out.
 */
export function InterpreterToggle({ on, onToggle }: { on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      aria-pressed={on}
      title="Keep them on screen in a corner, whatever the layout — for a sign-language interpreter"
      className={cn(
        "press h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium transition-colors",
        on ? "bg-white text-[#0b0708]" : "bg-white/[0.07] text-foreground/85 hover:bg-white/[0.12]"
      )}
    >
      Interpreter
    </button>
  );
}

/**
 * Who can ask, and how old their account must be. The host changes it;
 * a producer's console shows it as it stands (no `onChange`).
 */
export function StageLineControl({ line, onChange }: { line: StageLineRule; onChange?: (next: StageLineRule) => void }) {
  const choice = (on: boolean, label: string, pick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={on}
      disabled={!onChange}
      onClick={() => !on && pick()}
      className={cn(
        "press h-8 rounded-full px-3 text-[12px] font-semibold transition-colors disabled:cursor-default",
        on ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 enabled:hover:bg-white/[0.1] disabled:opacity-60"
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="rounded-[12px] bg-white/[0.04] p-3">
      <p className="text-[12.5px] font-semibold">Who can ask to join</p>
      <div role="radiogroup" aria-label="Who can ask to join" className="mt-2 flex flex-wrap gap-1.5">
        {STAGE_REQUEST_RULES.map((w) => choice(line.who === w, WHO[w].label, () => onChange?.({ ...line, who: w }), w))}
      </div>
      {line.who !== "off" && (
        <div role="radiogroup" aria-label="How old their account must be" className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted-foreground">Accounts</span>
          {STAGE_ACCOUNT_DAYS.map((d) => choice(line.accountDays === d, AGE[d], () => onChange?.({ ...line, accountDays: d }), String(d)))}
        </div>
      )}
      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
        {WHO[line.who].hint}
        {!onChange && " The host sets this in their studio."}
      </p>
    </div>
  );
}
