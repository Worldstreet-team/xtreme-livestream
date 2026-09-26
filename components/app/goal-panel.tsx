"use client";

import { useState } from "react";
import { Check, Plus, X } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  GOAL_KIND_LABELS,
  GOAL_KINDS,
  GOAL_TARGET_LIMITS,
  goalAmount,
  goalShowing,
  goalUnit,
  MAX_GOAL_MILESTONES,
  readGoal,
  type GoalKind,
  type StreamGoal,
} from "@/lib/goals";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
const FIELD =
  "h-10 w-full rounded-full bg-white/[0.06] px-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:bg-white/[0.09]";

/** A few targets to start from, per kind — gifts in dollars. */
const SUGGESTED: Record<GoalKind, number[]> = {
  gifts: [50, 100, 250, 500],
  likes: [500, 1_000, 5_000],
  allies: [25, 50, 100],
};

interface Draft {
  kind: GoalKind;
  title: string;
  /** As typed: dollars for gifts, a count otherwise. */
  target: string;
  milestones: { at: string; label: string }[];
}

/** What the host typed, in the API's units (gifts in cents). */
function toUnits(kind: GoalKind, typed: string) {
  const n = Number(typed.replace(/[,$\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return kind === "gifts" ? Math.round(n * 100) : Math.round(n);
}

/** The first thing wrong with the draft, in words — or null when it's good to go. */
function problem(draft: Draft) {
  if (!draft.title.trim()) return "Say what it's for";
  const target = toUnits(draft.kind, draft.target);
  const { min, max } = GOAL_TARGET_LIMITS[draft.kind];
  if (!Number.isFinite(target)) return "Set a target";
  if (target < min || target > max) {
    return `Pick a target from ${goalAmount(draft.kind, min)} to ${goalAmount(draft.kind, max)}`;
  }
  let last = 0;
  for (const m of draft.milestones) {
    const at = toUnits(draft.kind, m.at);
    if (!Number.isFinite(at) || !m.label.trim()) return "Give each milestone an amount and a line";
    if (at >= target) return "Milestones come before the goal";
    if (at <= last) return "Milestones go up in order";
    last = at;
  }
  return null;
}

/**
 * The goal bar, from the studio (Phase 2, goals and status): one goal at a
 * time — gifts in dollars, likes, or new allies — with up to three stops on
 * the way. Up, it counts itself: gifts, likes and follows move it on the
 * server, and this card follows along.
 */
export function GoalPanel({
  streamId,
  goal,
  onGoal,
}: {
  /** The live stream, or null before going live. */
  streamId: string | null;
  goal: StreamGoal | null;
  onGoal: (goal: StreamGoal) => void;
}) {
  const [draft, setDraft] = useState<Draft>({ kind: "gifts", title: "", target: "100", milestones: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const up = goalShowing(goal) ? goal : null;
  const issue = problem(draft);

  const patch = (next: Partial<Draft>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...next }));
  };

  const start = async () => {
    if (!streamId || issue) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { goal: unknown } }>(`/api/streams/${streamId}/goal`, {
        method: "PUT",
        body: JSON.stringify({
          kind: draft.kind,
          title: draft.title.trim(),
          target: toUnits(draft.kind, draft.target),
          milestones: draft.milestones.map((m) => ({ at: toUnits(draft.kind, m.at), label: m.label.trim() })),
        }),
      });
      const next = readGoal(r.data.goal);
      if (next) onGoal(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't put the goal up");
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!streamId) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ success: boolean; data: { goal: unknown } }>(`/api/streams/${streamId}/goal`, { method: "DELETE" });
      const next = readGoal(r.data.goal);
      if (next) onGoal(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't take the goal down");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="scenes-goal">
      <p id="scenes-goal" className={LABEL}>Goal</p>
      <div className={cn("mt-2.5 rounded-[12px] p-3 transition-colors", up ? "bg-white/[0.07]" : "bg-white/[0.04]")}>
        {up ? (
          <GoalLive goal={up} busy={busy} onEnd={() => void end()} />
        ) : (
          <div className="flex flex-col gap-2.5">
            <div role="radiogroup" aria-label="What the goal counts" className="flex flex-wrap gap-1.5">
              {GOAL_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={draft.kind === kind}
                  onClick={() => patch({ kind, target: String(SUGGESTED[kind][1]), milestones: [] })}
                  className={cn(
                    "press h-8 rounded-full px-3 text-[12px] font-semibold transition-colors",
                    draft.kind === kind ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
                  )}
                >
                  {GOAL_KIND_LABELS[kind].label}
                </button>
              ))}
            </div>
            <p className="-mt-1 px-1 text-[11.5px] text-muted-foreground">{GOAL_KIND_LABELS[draft.kind].hint}.</p>

            <input
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              maxLength={40}
              placeholder="What it's for — “New mic”, “1K club”"
              aria-label="What the goal is for"
              className={FIELD}
            />

            <div className="flex items-center gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Target</span>
                {draft.kind === "gifts" && (
                  <span aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[13px] text-muted-foreground">
                    $
                  </span>
                )}
                <input
                  value={draft.target}
                  onChange={(e) => patch({ target: e.target.value })}
                  inputMode="numeric"
                  aria-label="Target"
                  className={cn(FIELD, "font-mono tabular-nums", draft.kind === "gifts" && "pl-7")}
                />
              </label>
              <div className="flex shrink-0 gap-1">
                {SUGGESTED[draft.kind].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => patch({ target: String(n) })}
                    className="press h-8 rounded-full bg-white/[0.06] px-2.5 font-mono text-[11.5px] font-semibold text-foreground/85 tabular-nums hover:bg-white/[0.1]"
                  >
                    {draft.kind === "gifts" ? `$${n}` : n >= 1000 ? `${n / 1000}K` : n}
                  </button>
                ))}
              </div>
            </div>

            {draft.milestones.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <label className="relative w-24 shrink-0">
                  <span className="sr-only">Milestone {i + 1} amount</span>
                  {draft.kind === "gifts" && (
                    <span aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[13px] text-muted-foreground">
                      $
                    </span>
                  )}
                  <input
                    value={m.at}
                    onChange={(e) => patch({ milestones: draft.milestones.map((x, j) => (j === i ? { ...x, at: e.target.value } : x)) })}
                    inputMode="numeric"
                    aria-label={`Milestone ${i + 1} amount`}
                    className={cn(FIELD, "px-3.5 font-mono tabular-nums", draft.kind === "gifts" && "pl-6")}
                  />
                </label>
                <input
                  value={m.label}
                  onChange={(e) => patch({ milestones: draft.milestones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                  maxLength={40}
                  placeholder="What happens there"
                  aria-label={`Milestone ${i + 1} line`}
                  className={cn(FIELD, "min-w-0 flex-1")}
                />
                <button
                  type="button"
                  onClick={() => patch({ milestones: draft.milestones.filter((_, j) => j !== i) })}
                  aria-label={`Remove milestone ${i + 1}`}
                  className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>
            ))}

            <div className="flex items-center justify-between gap-2 pt-0.5">
              {draft.milestones.length < MAX_GOAL_MILESTONES ? (
                <button
                  type="button"
                  onClick={() => patch({ milestones: [...draft.milestones, { at: "", label: "" }] })}
                  className="press flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold text-foreground/80 hover:bg-white/[0.06] hover:text-foreground"
                >
                  <Plus size={13} weight="bold" />
                  Add a milestone
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void start()}
                disabled={!streamId || Boolean(issue) || busy}
                title={!streamId ? "Go live first" : (issue ?? undefined)}
                className="press h-8 shrink-0 rounded-full bg-white px-3.5 text-[12px] font-bold text-[#0b0708] transition-opacity disabled:pointer-events-none disabled:opacity-40"
              >
                Start goal
              </button>
            </div>
            {(error || (issue && draft.title.trim())) && (
              <p role={error ? "alert" : undefined} className={cn("px-1 text-[12px]", error ? "text-chili-hi" : "text-muted-foreground")}>
                {error ?? issue}
              </p>
            )}
            {!streamId && <p className="px-1 text-[12px] text-muted-foreground">Goals go up once you&apos;re live.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

/** The goal that's up: how far it's got, its stops, and the way to take it down. */
function GoalLive({ goal, busy, onEnd }: { goal: StreamGoal; busy: boolean; onEnd: () => void }) {
  const reached = Boolean(goal.reachedAt);
  const share = Math.min(1, goal.progress / goal.target);
  const unit = goalUnit(goal.kind, goal.target);
  return (
    <div>
      <div className="flex min-h-8 items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">{goal.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-medium text-ember-hi">
            <span aria-hidden className="size-1.5 rounded-full bg-ember" />
            {reached ? "Reached — still counting" : "On screen"}
          </span>
        </span>
        <button
          type="button"
          onClick={onEnd}
          disabled={busy}
          className="press h-8 shrink-0 rounded-full bg-white/[0.08] px-3.5 text-[12px] font-bold text-foreground transition-colors hover:bg-white/[0.12] disabled:opacity-40"
        >
          End goal
        </button>
      </div>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="font-money text-[26px] leading-none tabular-nums">{goalAmount(goal.kind, goal.progress)}</span>
        <span className="text-[13px] text-muted-foreground">
          of {goalAmount(goal.kind, goal.target)}
          {unit && ` ${unit}`} · {Math.floor(share * 100)}%
        </span>
      </p>
      <div className="relative mt-2.5 h-2 rounded-full bg-white/[0.08]">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out", reached ? "bg-heat" : "bg-ember")}
          style={{ width: `${Math.max(share * 100, 2)}%` }}
        />
        {goal.milestones.map((m) => (
          <span
            key={m.at}
            aria-hidden
            className={cn("absolute top-1/2 h-3.5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full", m.at <= goal.progress ? "bg-white" : "bg-white/35")}
            style={{ left: `${(m.at / goal.target) * 100}%` }}
          />
        ))}
      </div>
      {goal.milestones.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {goal.milestones.map((m) => {
            const passed = m.at <= goal.progress;
            return (
              <li key={m.at} className="flex items-center gap-2 text-[12.5px]">
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full",
                    passed ? "bg-ember text-on-ember" : "bg-white/[0.08]"
                  )}
                >
                  {passed && <Check size={10} weight="bold" />}
                </span>
                <span className="font-mono font-semibold tabular-nums">{goalAmount(goal.kind, m.at)}</span>
                <span className={cn("min-w-0 truncate", passed ? "text-foreground" : "text-muted-foreground")}>{m.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
