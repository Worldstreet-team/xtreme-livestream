"use client";

import { useEffect, useState } from "react";
import { ArrowClockwise, Check, CheckCircle, MonitorPlay, PencilSimple, Plus, Ticket, X } from "@/components/icons";
import { SwitchField } from "@/components/ui/selection-controls";
import { Tip } from "@/components/ui/tip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { centsToDollars } from "@/lib/gifts";
import {
  MAX_REQUEST_ITEMS,
  REQUEST_PRICE_MAX_MINOR,
  REQUEST_PRICE_MIN_MINOR,
  type RequestItem,
  type RequestOrder,
  type useRequestQueue,
} from "@/lib/requests";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
const FIELD =
  "h-10 w-full rounded-full bg-white/[0.06] px-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:bg-white/[0.09] focus:shadow-[inset_0_0_0_1.5px_var(--ember)]";

/** Somewhere to start: what creators here most often take requests for. */
const STARTERS: Array<Omit<RequestItem, "id">> = [
  { title: "Song request", priceUsdMinor: 500, prompt: "Which song?" },
  { title: "Shout-out", priceUsdMinor: 300, prompt: "Who's it for?" },
  { title: "Chart call", priceUsdMinor: 1000, prompt: "Which pair or coin?" },
  { title: "Pick my next game", priceUsdMinor: 500, prompt: "Which game?" },
];

type Queue = ReturnType<typeof useRequestQueue>;

function ago(iso: string, now: number) {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  return mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
}

/**
 * Paid requests, from the studio: the switch that opens the menu to the
 * room, the queue the host works through, and the menu itself. The money
 * waits with Xtream until Done; Skip — or ending the stream — refunds it.
 */
export function RequestsPanel({
  queue,
  live,
  onScreenId,
  onScene,
}: {
  queue: Queue;
  live: boolean;
  /** The request that's on stream now, if one is. */
  onScreenId: string | null;
  /** The scene the API answered with, so the studio shows it at once. */
  onScene: (scene: unknown) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // "2m ago" keeps up; a Skip that wasn't confirmed stands down.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!confirmSkip) return;
    const t = setTimeout(() => setConfirmSkip(null), 4000);
    return () => clearTimeout(t);
  }, [confirmSkip]);

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  };

  const waitingMinor = queue.pending.reduce((n, o) => n + o.priceUsdMinor, 0);
  const empty = queue.items.length === 0;

  return (
    <div className="space-y-6 px-4 pt-4 pb-4">
      <div className="rounded-[12px] bg-white/[0.045] px-3.5 py-1.5">
        <SwitchField
          label="Taking requests"
          description={
            empty
              ? "Put something on your menu first."
              : queue.open
                ? "Your menu is open to the room."
                : "Open your menu and viewers can pay to ask."
          }
          checked={queue.open}
          disabled={!live || empty || busy === "open"}
          onCheckedChange={(on) => void run("open", () => queue.setOpen(on))}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">
          {error}
        </p>
      )}

      <section aria-labelledby="requests-waiting">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 id="requests-waiting" className={LABEL}>
            Waiting{queue.pending.length > 0 && ` · ${queue.pending.length}`}
          </h3>
          {waitingMinor > 0 && (
            <span className="text-[12px] text-muted-foreground">
              <span className="font-money text-[14px] text-value tabular-nums">{centsToDollars(waitingMinor)}</span> held for you
            </span>
          )}
        </div>
        {queue.pending.length === 0 ? (
          <div className="flex items-center gap-3 rounded-[12px] bg-white/[0.03] px-3.5 py-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground">
              <Ticket size={17} />
            </span>
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              {queue.open ? "Nothing waiting. New requests land here as they're paid for." : "When your menu is open, paid requests line up here — first come, first served."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.pending.map((o) => (
              <PendingRow
                key={o.id}
                order={o}
                now={now}
                busy={busy}
                onScreen={onScreenId === o.id}
                confirmingSkip={confirmSkip === o.id}
                onFeature={(on) =>
                  void run(`feature:${o.id}`, async () => {
                    const scene = await queue.feature(o.id, on);
                    if (scene) onScene(scene);
                  })
                }
                onDone={() => void run(`done:${o.id}`, () => queue.decide(o.id, "done"))}
                onSkip={() => {
                  if (confirmSkip !== o.id) {
                    setConfirmSkip(o.id);
                    return;
                  }
                  setConfirmSkip(null);
                  void run(`skip:${o.id}`, () => queue.decide(o.id, "skip"));
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {queue.decided.length > 0 && (
        <section aria-labelledby="requests-recent">
          <h3 id="requests-recent" className={cn(LABEL, "mb-2")}>
            Recent
          </h3>
          <ul className="flex flex-col gap-1">
            {queue.decided.slice(0, 6).map((o) => (
              <DecidedRow key={o.id} order={o} />
            ))}
          </ul>
        </section>
      )}

      <MenuEditor queue={queue} />
    </div>
  );
}

function PendingRow({
  order,
  now,
  busy,
  onScreen,
  confirmingSkip,
  onFeature,
  onDone,
  onSkip,
}: {
  order: RequestOrder;
  now: number;
  busy: string | null;
  onScreen: boolean;
  confirmingSkip: boolean;
  onFeature: (on: boolean) => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  const working = busy !== null && busy.endsWith(`:${order.id}`);
  return (
    <li className={cn("rounded-[12px] p-3 transition-colors", onScreen ? "bg-ember/[0.1]" : "bg-white/[0.045]")}>
      <div className="flex items-start gap-2.5">
        <UserAvatar src={order.viewer.avatar} name={order.viewer.username} size={32} className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-[13.5px] font-semibold">{order.title}</span>
            <span className="ml-auto shrink-0 font-money text-[14px] text-value tabular-nums">{centsToDollars(order.priceUsdMinor)}</span>
          </p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {order.viewer.username} · {ago(order.createdAt, now)}
          </p>
        </div>
      </div>
      {order.note && (
        <p className="mt-2 rounded-[10px] bg-white/[0.05] px-3 py-2 text-[13px] leading-snug break-words text-foreground/90">{order.note}</p>
      )}
      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onFeature(!onScreen)}
          disabled={working}
          aria-pressed={onScreen}
          className={cn(
            "press flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors disabled:opacity-50",
            onScreen ? "bg-ember text-on-ember" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
          )}
        >
          <MonitorPlay size={14} weight={onScreen ? "fill" : "regular"} className="shrink-0" />
          <span className="truncate">{onScreen ? "On stream" : "Show on stream"}</span>
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onSkip}
          disabled={working}
          className={cn(
            "press h-8 shrink-0 rounded-full px-3 text-[12px] font-semibold transition-colors disabled:opacity-50",
            confirmingSkip ? "bg-white/[0.14] text-foreground" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
          )}
        >
          {confirmingSkip ? `Refund ${centsToDollars(order.priceUsdMinor)}?` : "Skip"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={working}
          className="press flex h-8 shrink-0 items-center gap-1 rounded-full bg-white px-3.5 text-[12px] font-bold text-[#0b0708] transition-opacity disabled:opacity-50"
        >
          {busy === `done:${order.id}` ? (
            <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Check size={12} weight="bold" />
          )}
          Done
        </button>
      </div>
    </li>
  );
}

function DecidedRow({ order }: { order: RequestOrder }) {
  const done = order.status === "done";
  return (
    <li className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[12.5px]">
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", done ? "bg-success/15 text-success" : "bg-white/[0.06] text-muted-foreground")}>
        {done ? <CheckCircle size={13} weight="fill" /> : <ArrowClockwise size={12} />}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className={done ? "text-foreground/90" : "text-muted-foreground"}>{order.title}</span>
        <span className="text-muted-foreground"> · {order.viewer.username}</span>
      </span>
      {done ? (
        <span className="shrink-0 font-money text-[13px] text-value tabular-nums">{centsToDollars(order.priceUsdMinor)}</span>
      ) : (
        <span className="shrink-0 text-[11.5px] text-muted-foreground">{order.refunded ? "Refunded" : "Refunding…"}</span>
      )}
    </li>
  );
}

interface Draft {
  id?: string;
  title: string;
  price: string;
  prompt: string;
}

function draftProblem(d: Draft) {
  if (!d.title.trim()) return "Name it";
  const cents = Math.round(Number(d.price.replace(/[$,\s]/g, "")) * 100);
  if (!Number.isFinite(cents) || cents < REQUEST_PRICE_MIN_MINOR || cents > REQUEST_PRICE_MAX_MINOR) {
    return `Price it from ${centsToDollars(REQUEST_PRICE_MIN_MINOR)} to ${centsToDollars(REQUEST_PRICE_MAX_MINOR)}`;
  }
  return null;
}

/** The menu: up to eight things, each with its price and the question it asks. */
function MenuEditor({ queue }: { queue: Queue }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = queue.items;
  const full = items.length >= MAX_REQUEST_ITEMS;
  const issue = draft ? draftProblem(draft) : null;

  const save = async (next: Array<Omit<RequestItem, "id"> & { id?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      await queue.saveMenu(next);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your menu");
    } finally {
      setBusy(false);
    }
  };

  const commit = () => {
    if (!draft || issue) return;
    const item = {
      ...(draft.id ? { id: draft.id } : {}),
      title: draft.title.trim(),
      priceUsdMinor: Math.round(Number(draft.price.replace(/[$,\s]/g, "")) * 100),
      prompt: draft.prompt.trim(),
    };
    void save(draft.id ? items.map((i) => (i.id === draft.id ? item : i)) : [...items, item]);
  };

  return (
    <section aria-labelledby="requests-menu">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 id="requests-menu" className={LABEL}>
          Your menu
        </h3>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {items.length}/{MAX_REQUEST_ITEMS}
        </span>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) =>
            draft?.id === item.id ? null : (
              <li key={item.id} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.045] py-2 pr-1.5 pl-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{item.title}</span>
                  {item.prompt && <span className="block truncate text-[11.5px] text-muted-foreground">Asks “{item.prompt}”</span>}
                </span>
                <span className="shrink-0 font-money text-[14px] text-value tabular-nums">{centsToDollars(item.priceUsdMinor)}</span>
                <Tip label="Edit it">
                  <button
                    type="button"
                    onClick={() => setDraft({ id: item.id, title: item.title, price: String(item.priceUsdMinor / 100), prompt: item.prompt })}
                    aria-label={`Edit ${item.title}`}
                    className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
                  >
                    <PencilSimple size={14} />
                  </button>
                </Tip>
                <Tip label="Take it off the menu">
                  <button
                    type="button"
                    onClick={() => void save(items.filter((i) => i.id !== item.id))}
                    disabled={busy}
                    aria-label={`Take ${item.title} off the menu`}
                    className="press -ml-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.08] hover:text-foreground disabled:opacity-40"
                  >
                    <X size={13} weight="bold" />
                  </button>
                </Tip>
              </li>
            )
          )}
        </ul>
      )}

      {draft ? (
        <div className={cn("flex flex-col gap-2 rounded-[12px] bg-white/[0.07] p-3", items.length > 0 && "mt-1.5")}>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            maxLength={40}
            placeholder="What they're asking for — “Song request”"
            aria-label="What it is"
            autoFocus
            className={FIELD}
          />
          <div className="flex items-center gap-2">
            <label className="relative w-28 shrink-0">
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[13px] text-muted-foreground">
                $
              </span>
              <input
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                inputMode="decimal"
                aria-label="Price in dollars"
                className={cn(FIELD, "pl-7 font-mono tabular-nums")}
              />
            </label>
            <input
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              maxLength={60}
              placeholder="Ask them — “Which song?”"
              aria-label="What to ask the viewer (optional)"
              className={cn(FIELD, "min-w-0 flex-1")}
            />
          </div>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <p className="min-w-0 px-1 text-[11.5px] text-muted-foreground">{issue && draft.title.trim() ? issue : "The question is optional."}</p>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="press h-8 rounded-full bg-white/[0.06] px-3 text-[12px] font-semibold text-foreground/85 hover:bg-white/[0.1]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commit}
                disabled={Boolean(issue) || busy}
                className="press h-8 rounded-full bg-white px-3.5 text-[12px] font-bold text-[#0b0708] transition-opacity disabled:pointer-events-none disabled:opacity-40"
              >
                {draft.id ? "Save" : "Add to menu"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        !full && (
          <button
            type="button"
            onClick={() => setDraft({ title: "", price: "5", prompt: "" })}
            className={cn(
              "press flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-foreground/85 hover:bg-white/[0.06] hover:text-foreground",
              items.length > 0 && "mt-1.5"
            )}
          >
            <Plus size={13} weight="bold" />
            Add to your menu
          </button>
        )
      )}

      {items.length === 0 && !draft && (
        <div className="mt-2">
          <p className="mb-2 px-1 text-[11.5px] text-muted-foreground">Or start from one of these:</p>
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button
                key={s.title}
                type="button"
                disabled={busy}
                onClick={() => void save([...items, s])}
                className="press flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[12px] font-semibold text-foreground/85 hover:bg-white/[0.1] disabled:opacity-40"
              >
                {s.title}
                <span className="font-money text-value">{centsToDollars(s.priceUsdMinor)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 px-1 text-[12px] text-chili-hi">
          {error}
        </p>
      )}
      <p className="mt-3 px-1 text-[11.5px] leading-relaxed text-muted-foreground/80">
        Viewers pay when they ask, and it waits with Xtream until you tap Done. Skip one — or end the stream with it still waiting — and they get
        every cent back.
      </p>
    </section>
  );
}
