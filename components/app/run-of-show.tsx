"use client";

import { useState } from "react";
import { CaretDown, CaretUp, Check, ClapperboardText, Plus, SkipForward, Stop, Trash, X } from "@/components/icons";
import { serverOffset } from "@/lib/server-clock";
import { useNow } from "@/lib/use-now";
import { CARDS, LAYOUTS } from "@/lib/scene";
import {
  cueLabel,
  formatClock,
  formatLength,
  MAX_RUNDOWN_SCRIPT,
  MAX_SEGMENT_CUES,
  MAX_SEGMENT_SCRIPT,
  MAX_SEGMENTS,
  newSegmentId,
  scriptLength,
  TEMPLATES,
  totalSeconds,
  type CueSponsor,
  type RundownCue,
  type RundownPosition,
  type RundownSegment,
  type SaveStatus,
} from "@/lib/rundown";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
const FIELD =
  "w-full min-w-0 rounded-[10px] bg-white/[0.06] px-3 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:bg-white/[0.09] focus:shadow-[inset_0_0_0_1.5px_var(--ember)]";

/** Seconds left in a segment (negative once it's over), on the server's clock. */
function useSegmentClock(position: RundownPosition | null, segment: RundownSegment | null) {
  const now = useNow(Boolean(position?.startedAt)) + serverOffset();
  if (!position?.startedAt || !segment) return null;
  const elapsed = (now - Date.parse(position.startedAt)) / 1000;
  const show = position.showStartedAt ? (now - Date.parse(position.showStartedAt)) / 1000 : elapsed;
  return { elapsed, left: segment.seconds - elapsed, show };
}

/**
 * The run of show (Phase 3): the rundown, and — on air — the show running
 * through it. Starting a segment puts its cues on screen through the same
 * scene route as a hand-made change, and starts its clock on the server so
 * a reload or another device keeps the time.
 *
 * Before a show it's the editor; during one it's the running order, with
 * Edit a tap away (changes save as you type either way).
 */
export function RunOfShow({
  segments,
  status,
  onChange,
  live,
  position,
  onGo,
  sponsors,
  prompterOn = false,
  onPrompter,
  onFocus,
  editable = true,
}: {
  /** null while it loads. */
  segments: RundownSegment[] | null;
  status: SaveStatus;
  onChange: (segments: RundownSegment[]) => void;
  live: boolean;
  position: RundownPosition | null;
  /** Put a segment on air (its cues too), or stop with null. */
  onGo: (segment: RundownSegment | null) => Promise<void>;
  /** Sponsors a cue can put up. */
  sponsors: CueSponsor[];
  prompterOn?: boolean;
  /** The host's own teleprompter; a producer's console has none. */
  onPrompter?: () => void;
  /** The segment being worked on, for the prompter before a show. */
  onFocus?: (segmentId: string) => void;
  /** The rundown is the host's to write; a producer runs it as it is. */
  editable?: boolean;
}) {
  const [editing, setEditing] = useState(!live);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Going live lands in the running order; the editor is a tap away.
  const [wasLive, setWasLive] = useState(live);
  if (live !== wasLive) {
    setWasLive(live);
    setEditing(!live);
  }

  const list = segments ?? [];
  const onAirIndex = position?.segmentId ? list.findIndex((s) => s.id === position.segmentId) : -1;
  const onAir = onAirIndex >= 0 ? list[onAirIndex]! : null;
  const next = onAirIndex >= 0 ? (list[onAirIndex + 1] ?? null) : (list[0] ?? null);

  const go = async (segment: RundownSegment | null) => {
    setBusy(true);
    setError(null);
    try {
      await onGo(segment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through — try again.");
    } finally {
      setBusy(false);
    }
  };

  const planned = totalSeconds(list);
  const header = (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-wide text-[17px] font-bold tracking-[-0.02em]">Run of show</p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
          {segments === null
            ? "Loading…"
            : list.length === 0
              ? "No segments yet"
              : `${list.length} ${list.length === 1 ? "segment" : "segments"} · ${formatLength(planned)} planned`}
          {segments !== null && list.length > 0 && editable && (
            <span className={cn(status === "error" ? "text-chili-hi" : "text-muted-foreground/70")}>
              {" "}
              · {status === "saving" ? "Saving…" : status === "error" ? "Not saved — retrying" : "Saved"}
            </span>
          )}
        </p>
      </div>
      {onPrompter && (
        <button
          type="button"
          onClick={onPrompter}
          aria-pressed={prompterOn}
          className={cn(
            "press flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors",
            prompterOn ? "bg-white text-[#0b0708]" : "bg-white/[0.07] text-foreground hover:bg-white/[0.11]"
          )}
        >
          <ClapperboardText size={14} />
          Prompter
        </button>
      )}
      {live && list.length > 0 && editable && (
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="press flex h-8 shrink-0 items-center rounded-full bg-white/[0.07] px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-white/[0.11]"
        >
          {editing ? "Done" : "Edit"}
        </button>
      )}
    </div>
  );

  if (segments === null) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="h-40 animate-pulse rounded-[14px] bg-white/[0.04]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      {live && !editing && list.length > 0 && (
        <OnAirCard
          segments={list}
          onAir={onAir}
          onAirIndex={onAirIndex}
          next={next}
          position={position}
          busy={busy}
          onNext={() => void go(next)}
          onStop={() => void go(null)}
        />
      )}
      {error && <p className="rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">{error}</p>}

      {list.length === 0 ? (
        editable ? (
          <Templates onPick={(picked) => onChange(picked)} />
        ) : (
          <p className="rounded-[12px] bg-white/[0.04] px-4 py-5 text-[13px] leading-snug text-muted-foreground">
            No run of show yet — the host writes it in their studio, and it shows up here.
          </p>
        )
      ) : editing && editable ? (
        <Editor segments={list} onChange={onChange} sponsors={sponsors} onFocus={onFocus} />
      ) : (
        <ol className="flex flex-col gap-1">
          {list.map((s, i) => {
            const state = onAirIndex < 0 ? "later" : i < onAirIndex ? "done" : i === onAirIndex ? "on" : "later";
            return (
              <li
                key={s.id}
                className={cn(
                  "group flex items-start gap-3 rounded-[12px] px-3 py-2.5 transition-colors",
                  state === "on" ? "bg-ember/[0.12]" : "hover:bg-white/[0.04]"
                )}
              >
                <span
                  className={cn(
                    "mt-px flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold tabular-nums",
                    state === "on" ? "bg-ember text-on-ember" : state === "done" ? "bg-white/[0.06] text-muted-foreground" : "bg-white/[0.08] text-foreground/80"
                  )}
                >
                  {state === "done" ? <Check size={11} weight="bold" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("flex items-baseline gap-2 text-[13.5px] font-semibold", state === "done" && "text-muted-foreground")}>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 font-mono text-[11.5px] font-medium text-muted-foreground tabular-nums">{formatLength(s.seconds)}</span>
                  </p>
                  {s.cues.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {s.cues.map((c, j) => (
                        <span key={j} className="max-w-full truncate rounded-[6px] bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] font-medium text-foreground/70">
                          {cueLabel(c, sponsors)}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {state !== "on" && live && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void go(s)}
                    aria-label={`Put “${s.title}” on air`}
                    className="press mt-px h-7 shrink-0 rounded-full bg-white/[0.07] px-2.5 text-[11.5px] font-semibold text-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40 [@media(hover:none)]:opacity-100"
                  >
                    Go
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!live && list.length > 0 && (
        <p className="text-[12px] leading-snug text-muted-foreground">
          {editable ? "Once you're live, " : "Once the host is live, "}
          <span className="text-foreground/85">Start the show</span> puts the first segment on air — its cues change the picture, and its clock
          starts. {editable ? "The prompter reads the segment on air." : "The host's prompter follows it."}
        </p>
      )}
    </div>
  );
}

/** The segment on air: its clock, the show's, and the one-tap way on. */
function OnAirCard({
  segments,
  onAir,
  onAirIndex,
  next,
  position,
  busy,
  onNext,
  onStop,
}: {
  segments: RundownSegment[];
  onAir: RundownSegment | null;
  onAirIndex: number;
  next: RundownSegment | null;
  position: RundownPosition | null;
  busy: boolean;
  onNext: () => void;
  onStop: () => void;
}) {
  const clock = useSegmentClock(position, onAir);
  if (!onAir || !clock) {
    return (
      <div className="rounded-[14px] bg-white/[0.05] p-4">
        <p className={LABEL}>Ready when you are</p>
        <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
          First up: <span className="font-semibold text-foreground">{segments[0]?.title}</span> · {formatLength(segments[0]?.seconds ?? 0)}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={onNext}
          className="press mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-white text-[13.5px] font-bold text-[#0b0708] disabled:opacity-50"
        >
          <SkipForward size={15} weight="fill" />
          Start the show
        </button>
      </div>
    );
  }
  const over = clock.left < 0;
  const planned = totalSeconds(segments.slice(0, onAirIndex)) + clock.elapsed;
  // Ahead or behind: how the show's clock compares with the plan up to here.
  const drift = Math.round((clock.show - planned) / 60);
  const share = Math.min(1, clock.elapsed / onAir.seconds);
  return (
    <div className={cn("rounded-[14px] p-4 transition-colors", over ? "bg-warning/[0.1]" : "bg-ember/[0.1]")}>
      <p className="flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", over ? "animate-pulse bg-warning" : "bg-ember")} />
        <span className={LABEL}>
          On air · {onAirIndex + 1} of {segments.length}
        </span>
      </p>
      <div className="mt-2 flex items-baseline gap-3">
        <p className="min-w-0 flex-1 truncate font-wide text-[18px] font-bold tracking-[-0.02em]">{onAir.title}</p>
        <p className={cn("shrink-0 font-mono text-[20px] font-bold tabular-nums", over ? "text-warning" : "text-foreground")}>
          {formatClock(clock.left, true)}
        </p>
      </div>
      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <span className={cn("block h-full rounded-full transition-[width] duration-1000 ease-linear", over ? "bg-warning" : "bg-ember")} style={{ width: `${share * 100}%` }} />
      </span>
      <p className="mt-2 text-[12px] text-muted-foreground tabular-nums">
        {over ? "Over its time" : `${formatClock(clock.left)} left`} · show {formatClock(clock.show)}
        {Math.abs(drift) >= 1 && ` · ${Math.abs(drift)} min ${drift > 0 ? "behind" : "ahead"}`}
      </p>
      <div className="mt-3 flex gap-2">
        {next ? (
          <button
            type="button"
            disabled={busy}
            onClick={onNext}
            className={cn(
              "press flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-4 text-[13.5px] font-bold disabled:opacity-50",
              over ? "bg-warning text-[#1a1203]" : "bg-white text-[#0b0708]"
            )}
          >
            <SkipForward size={15} weight="fill" className="shrink-0" />
            <span className="truncate">Next: {next.title}</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onStop}
            className="press flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 text-[13.5px] font-bold text-[#0b0708] disabled:opacity-50"
          >
            <Check size={15} weight="bold" />
            That&apos;s the show
          </button>
        )}
        {next && (
          <button
            type="button"
            disabled={busy}
            onClick={onStop}
            aria-label="Stop the run of show"
            title="Stop the run of show"
            className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-muted-foreground transition-colors hover:bg-white/[0.11] hover:text-foreground disabled:opacity-50"
          >
            <Stop size={13} weight="fill" />
          </button>
        )}
      </div>
    </div>
  );
}

/** A first rundown from a shape that fits, or a blank one. */
function Templates({ onPick }: { onPick: (segments: RundownSegment[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] leading-snug text-muted-foreground">
        Plan the show in segments: how long each runs, what you&apos;ll say (the prompter reads it), and what goes on screen when it starts.
      </p>
      {TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPick(t.segments.map((s) => ({ ...s, id: newSegmentId() })))}
          className="press flex items-center gap-3 rounded-[12px] bg-white/[0.05] px-3.5 py-3 text-left transition-colors hover:bg-white/[0.08]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold">{t.name}</span>
            <span className="block truncate text-[12px] text-muted-foreground">{t.blurb}</span>
          </span>
          <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">
            {t.segments.length} · {formatLength(t.segments.reduce((n, s) => n + s.seconds, 0))}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPick([{ id: newSegmentId(), title: "Opening", seconds: 300, script: "", cues: [] }])}
        className="press flex h-10 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
      >
        <Plus size={14} weight="bold" />
        Start blank
      </button>
    </div>
  );
}

/** Each segment's title, length, script and cues, editable in place. */
function Editor({
  segments,
  onChange,
  sponsors,
  onFocus,
}: {
  segments: RundownSegment[];
  onChange: (segments: RundownSegment[]) => void;
  sponsors: CueSponsor[];
  onFocus?: (segmentId: string) => void;
}) {
  const used = scriptLength(segments);
  const set = (id: string, patch: Partial<RundownSegment>) => onChange(segments.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...segments];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2.5">
      {segments.map((s, i) => (
        <SegmentEditor
          key={s.id}
          index={i}
          count={segments.length}
          segment={s}
          scriptRoom={Math.min(MAX_SEGMENT_SCRIPT, MAX_RUNDOWN_SCRIPT - used + s.script.length)}
          sponsors={sponsors}
          onFocus={() => onFocus?.(s.id)}
          onChange={(patch) => set(s.id, patch)}
          onMove={(by) => move(i, by)}
          onRemove={() => onChange(segments.filter((x) => x.id !== s.id))}
        />
      ))}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={segments.length >= MAX_SEGMENTS}
          onClick={() => {
            const id = newSegmentId();
            onChange([...segments, { id, title: "", seconds: 300, script: "", cues: [] }]);
            onFocus?.(id);
          }}
          className="press flex h-9 items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 text-[12.5px] font-semibold transition-colors hover:bg-white/[0.11] disabled:opacity-40"
        >
          <Plus size={14} weight="bold" />
          Add segment
        </button>
        <span className="font-mono text-[11px] text-muted-foreground/70 tabular-nums">
          Script {used.toLocaleString("en-US")}/{MAX_RUNDOWN_SCRIPT.toLocaleString("en-US")}
        </span>
      </div>
    </div>
  );
}

function SegmentEditor({
  index,
  count,
  segment: s,
  scriptRoom,
  sponsors,
  onFocus,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  segment: RundownSegment;
  scriptRoom: number;
  sponsors: CueSponsor[];
  onFocus: () => void;
  onChange: (patch: Partial<RundownSegment>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const minutes = s.seconds / 60;
  const step = (by: number) => onChange({ seconds: Math.min(240, Math.max(0.5, Math.round((minutes + by) * 2) / 2)) * 60 });
  return (
    <div className="rounded-[14px] bg-white/[0.04] p-3" onFocusCapture={onFocus}>
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] font-mono text-[11px] font-bold tabular-nums">{index + 1}</span>
        <input
          value={s.title}
          onChange={(e) => onChange({ title: e.target.value.slice(0, 60) })}
          placeholder="Segment name"
          aria-label={`Segment ${index + 1} name`}
          className={cn(FIELD, "h-9 flex-1 font-semibold")}
        />
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up" className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.07] hover:text-foreground disabled:opacity-30">
          <CaretUp size={14} weight="bold" />
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down" className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.07] hover:text-foreground disabled:opacity-30">
          <CaretDown size={14} weight="bold" />
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-[12px] text-muted-foreground">Runs</span>
        <div className="flex items-center rounded-full bg-white/[0.06]">
          <button type="button" onClick={() => step(minutes <= 1 ? -0.5 : -1)} aria-label="Shorter" className="press flex size-8 items-center justify-center rounded-full text-foreground/80 hover:bg-white/[0.08]">
            −
          </button>
          <span className="min-w-[4.5rem] text-center font-mono text-[12.5px] font-semibold tabular-nums">{formatLength(s.seconds)}</span>
          <button type="button" onClick={() => step(minutes < 1 ? 0.5 : 1)} aria-label="Longer" className="press flex size-8 items-center justify-center rounded-full text-foreground/80 hover:bg-white/[0.08]">
            +
          </button>
        </div>
        <span className="flex-1" />
        {confirming ? (
          <span className="flex items-center gap-1">
            <button type="button" onClick={onRemove} className="press h-8 rounded-full bg-chili px-3 text-[12px] font-semibold text-white">
              Remove
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="press h-8 rounded-full px-2.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
              Keep
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} aria-label={`Remove segment ${index + 1}`} className="press flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.07] hover:text-foreground">
            <Trash size={14} />
          </button>
        )}
      </div>

      <label className="mt-2.5 block">
        <span className="sr-only">Script for the prompter</span>
        <textarea
          value={s.script}
          onChange={(e) => onChange({ script: e.target.value.slice(0, scriptRoom) })}
          maxLength={scriptRoom}
          rows={3}
          placeholder="What you'll say — the prompter reads it"
          className={cn(FIELD, "min-h-20 resize-y py-2.5 leading-snug")}
        />
      </label>

      <CueEditor cues={s.cues} sponsors={sponsors} onChange={(cues) => onChange({ cues })} />
    </div>
  );
}

type CueKind = "layout" | "card" | "lower-third" | "banner" | "sponsor";

/** What a segment puts on screen as it starts: chips, and a picker to add one. */
function CueEditor({ cues, sponsors, onChange }: { cues: RundownCue[]; sponsors: CueSponsor[]; onChange: (cues: RundownCue[]) => void }) {
  const [adding, setAdding] = useState<CueKind | "menu" | null>(null);
  const [text, setText] = useState("");
  const [sub, setSub] = useState("");
  const kindOf = (c: RundownCue) => c.do.replace(/^(hide|clear)-/, "");
  const has = (kind: string) => cues.some((c) => kindOf(c) === kind);
  const add = (cue: RundownCue) => {
    onChange([...cues.filter((c) => kindOf(c) !== kindOf(cue)), cue]);
    setAdding(null);
    setText("");
    setSub("");
  };
  const chip = "press h-7 rounded-full bg-white/[0.07] px-2.5 text-[11.5px] font-semibold text-foreground/85 transition-colors hover:bg-white/[0.11] disabled:opacity-35";

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[12px] text-muted-foreground">On screen</span>
        {cues.map((c, i) => (
          <span key={i} className="flex h-7 max-w-full items-center rounded-full bg-ember/[0.12] pl-2.5 text-[11.5px] font-semibold text-ember-hi">
            <span className="truncate">{cueLabel(c, sponsors)}</span>
            <button type="button" onClick={() => onChange(cues.filter((_, j) => j !== i))} aria-label={`Remove “${cueLabel(c, sponsors)}”`} className="flex size-7 shrink-0 items-center justify-center rounded-full hover:text-foreground">
              <X size={11} weight="bold" />
            </button>
          </span>
        ))}
        {cues.length < MAX_SEGMENT_CUES && adding === null && (
          <button type="button" onClick={() => setAdding("menu")} className="press flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">
            <Plus size={12} weight="bold" />
            {cues.length === 0 ? "Add a change" : "Add"}
          </button>
        )}
      </div>

      {adding !== null && (
        <div className="mt-2 rounded-[12px] bg-black/25 p-2.5">
          {adding === "menu" && (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={chip} disabled={has("layout")} onClick={() => setAdding("layout")}>Layout</button>
              <button type="button" className={chip} disabled={has("card")} onClick={() => setAdding("card")}>Card</button>
              <button type="button" className={chip} disabled={has("lower-third")} onClick={() => setAdding("lower-third")}>Lower third</button>
              <button type="button" className={chip} disabled={has("banner")} onClick={() => setAdding("banner")}>Banner</button>
              <button type="button" className={chip} disabled={has("sponsor") || sponsors.length === 0} onClick={() => setAdding("sponsor")} title={sponsors.length === 0 ? "Add a sponsor first, under Sponsorships" : undefined}>Sponsor</button>
              <button type="button" className={chip} disabled={has("countdown")} onClick={() => add({ do: "countdown" })}>Countdown</button>
              <button type="button" onClick={() => setAdding(null)} className="press h-7 rounded-full px-2 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          )}
          {adding === "layout" && (
            <div className="flex flex-wrap gap-1.5">
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" className={chip} onClick={() => add({ do: "layout", layout: l.id })}>
                  {l.label}
                </button>
              ))}
            </div>
          )}
          {adding === "card" && (
            <div className="flex flex-wrap gap-1.5">
              {CARDS.map((c) => (
                <button key={c.id} type="button" className={chip} onClick={() => add({ do: "card", card: c.id })}>
                  {c.title}
                </button>
              ))}
              <button type="button" className={chip} onClick={() => add({ do: "clear-card" })}>
                Take the card down
              </button>
            </div>
          )}
          {(adding === "lower-third" || adding === "banner") && (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                add(adding === "banner" ? { do: "banner", text: text.trim().slice(0, 100) } : { do: "lower-third", title: text.trim().slice(0, 48), subtitle: sub.trim().slice(0, 72) });
              }}
            >
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={adding === "banner" ? 100 : 48} placeholder={adding === "banner" ? "Giveaway at 100 allies" : "A name or a topic"} aria-label={adding === "banner" ? "Banner text" : "Lower third title"} className={cn(FIELD, "h-9")} />
              {adding === "lower-third" && (
                <input value={sub} onChange={(e) => setSub(e.target.value)} maxLength={72} placeholder="A line under it (optional)" aria-label="Lower third subtitle" className={cn(FIELD, "h-9")} />
              )}
              <div className="flex gap-1.5">
                <button type="submit" disabled={!text.trim()} className="press h-8 rounded-full bg-white px-3.5 text-[12px] font-bold text-[#0b0708] disabled:opacity-40">
                  Add
                </button>
                <button type="button" className={chip} onClick={() => add(adding === "banner" ? { do: "hide-banner" } : { do: "hide-lower-third" })}>
                  Take it down instead
                </button>
              </div>
            </form>
          )}
          {adding === "sponsor" && (
            <div className="flex flex-wrap gap-1.5">
              {sponsors.map((sp) => (
                <button key={`${sp.source}:${sp.id}`} type="button" className={chip} onClick={() => add({ do: "sponsor", source: sp.source, sponsorId: sp.id })}>
                  {sp.name}
                </button>
              ))}
              <button type="button" className={chip} onClick={() => add({ do: "hide-sponsor" })}>
                Take the sponsor down
              </button>
            </div>
          )}
          {adding !== "menu" && (
            <button type="button" onClick={() => setAdding("menu")} className="mt-1.5 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">
              ‹ Back
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The segment on air, on the stage itself (host-only): what it is, the
 * time it has left, and Next — so the running order is never more than a
 * glance and a tap away.
 */
export function SegmentChip({
  segment,
  index,
  count,
  position,
  next,
  busy,
  onNext,
  onOpen,
  compact = false,
}: {
  segment: RundownSegment;
  index: number;
  count: number;
  position: RundownPosition;
  next: RundownSegment | null;
  busy: boolean;
  onNext: () => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  const clock = useSegmentClock(position, segment);
  if (!clock) return null;
  const over = clock.left < 0;
  return (
    <div className="pointer-events-auto flex max-w-full items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        className={cn("obj press flex h-8 min-w-0 items-center gap-2 rounded-full pr-3 pl-2.5 text-[12px] font-semibold", over && "text-warning")}
        title="Open the run of show"
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", over ? "animate-pulse bg-warning" : "bg-ember")} />
        {!compact && (
          <span className="shrink-0 font-mono text-[11px] text-white/55 tabular-nums">
            {index + 1}/{count}
          </span>
        )}
        <span className="min-w-0 truncate text-white">{segment.title}</span>
        <span className={cn("shrink-0 font-mono tabular-nums", over ? "text-warning" : "text-white/80")}>{formatClock(clock.left, true)}</span>
      </button>
      {next && (
        <button
          type="button"
          disabled={busy}
          onClick={onNext}
          aria-label={`Next: ${next.title}`}
          title={`Next: ${next.title}`}
          className={cn("press flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold disabled:opacity-50", over ? "bg-warning text-[#1a1203]" : "obj text-white")}
        >
          <SkipForward size={13} weight="fill" />
          {!compact && "Next"}
        </button>
      )}
    </div>
  );
}
