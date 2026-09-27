"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SHOUT_MAX_LENGTH, SHOUT_MIN_MINOR, SHOUT_TIERS } from "@xtreme/contracts";
import { Check, Clock, X, PaperPlaneRight, Sword, Wallet } from "@/components/icons";
import { GIFT_CATALOG, GIFT_MAX_MINOR, GIFT_MIN_MINOR, REQUEST_GIFT, SHOUT_GIFT, centsToDollars, type GiftDef } from "@/lib/gifts";
import type { RequestOrder, RequestsMenu } from "@/lib/requests";
import { useBattleGifts } from "@/lib/battle-gifts";
import { giftFilterLine } from "@/lib/battles";
import { cn } from "@/lib/utils";
import { GiftArt } from "@/components/app/gift-art";
import { GiftToken } from "@/components/xtream/gift-token";
import { usePhone } from "@/components/app/shelf";

export type GiftTab = "gifts" | "shout" | "requests";

/** How long a Shout stays pinned, as people say it. */
export function pinLength(seconds: number) {
  return seconds >= 3600 ? `${seconds / 3600} hr` : `${Math.round(seconds / 60)} min`;
}

const SEND =
  "press flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-heat text-sm font-semibold text-white transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The gift picker, built like a sticker keyboard: a grid of animated faces,
 * each wearing its price tag, that slides up from the bottom of the chat
 * the way a keyboard does. On phones it is a bottom sheet over the page;
 * on desktop it docks inside the chat column above the composer. One tap
 * picks a sticker, the Send row says exactly what is about to be charged.
 *
 * Two more ways to spend sit beside the stickers: a Shout — words pinned
 * over the chat for longer the more it costs — and, while the host is
 * taking them, Requests off their menu, refunded in full if they skip it.
 */
export function GiftKeyboard({
  open,
  onClose,
  balanceMinor,
  balanceLoading,
  busy,
  error,
  onSend,
  onShout,
  requests,
  openTab = "gifts",
}: {
  open: boolean;
  onClose: () => void;
  /** Spendable wallet balance in cents; null when unknown. */
  balanceMinor: number | null;
  balanceLoading: boolean;
  /** A gift or Shout is on its way. */
  busy: boolean;
  error: string | null;
  /** Fires with the chosen gift, or a custom amount in cents. */
  onSend: (choice: { gift: GiftDef | null; usdMinor: number }) => void;
  /** A Shout: the amount (which sets how long it's pinned) and the words. */
  onShout?: (usdMinor: number, message: string) => void;
  /** The host's menu while they're taking requests, and mine. */
  requests?: {
    hostName: string;
    menu: RequestsMenu;
    mine: RequestOrder[];
    onOrder: (itemId: string, note: string) => Promise<unknown>;
  } | null;
  /** Which tab it opens on. */
  openTab?: GiftTab;
}) {
  const phone = usePhone();
  const [tab, setTab] = useState<GiftTab>(openTab);
  const [picked, setPicked] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [shoutText, setShoutText] = useState("");
  const [shoutMinor, setShoutMinor] = useState<number>(500);
  const [item, setItem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [ordered, setOrdered] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  // A battle running here with a gift filter: the gifts that move its score.
  const counting = useBattleGifts();

  // Reopening starts clean — adjusted during render against the last `open`
  // seen, so there's no effect-driven second pass. The slide-down before
  // unmount is driven by the closing flag so the sheet never just vanishes.
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) {
      setClosing(false);
      setTab(openTab);
      setPicked(null);
      setCustom("");
      setShoutText("");
      setItem(null);
      setNote("");
      setOrderError(null);
      setOrdered(null);
    }
  }
  // Requests closed while the sheet was up: back to the stickers.
  const requestsOpen = Boolean(requests?.menu.open);
  if (tab === "requests" && !requestsOpen && !ordered) setTab("gifts");

  if (!open && !closing) return null;

  const close = () => {
    setClosing(true);
  };
  const finish = () => {
    if (closing) {
      setClosing(false);
      onClose();
    }
  };
  const over = (minor: number | null) => minor !== null && balanceMinor !== null && minor > balanceMinor;

  const tabs: { id: GiftTab; label: string }[] = [
    { id: "gifts", label: "Gifts" },
    ...(onShout ? [{ id: "shout" as const, label: "Shout" }] : []),
    ...(requestsOpen || ordered ? [{ id: "requests" as const, label: "Requests" }] : []),
  ];

  const header = (
    <div className="flex items-center gap-2 px-3 pt-3 pb-2">
      {phone && <span className="absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-white/20" />}
      {tabs.length > 1 ? (
        <div role="tablist" aria-label="Ways to send" className="flex min-w-0 items-center gap-0.5 rounded-full bg-white/[0.06] p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "press relative h-8 min-w-0 rounded-full px-3 text-[12.5px] font-semibold whitespace-nowrap transition-colors",
                tab === t.id ? "bg-white text-[#0b0708]" : "text-white/60 hover:text-white"
              )}
            >
              {t.label}
              {t.id === "requests" && tab !== "requests" && (
                <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-ember" />
              )}
            </button>
          ))}
        </div>
      ) : (
        <span className="px-1 text-[13px] font-semibold">Send a gift</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11.5px] text-value tabular-nums">
        <Wallet size={12} weight="fill" />
        {balanceLoading && balanceMinor === null
          ? "…"
          : balanceMinor !== null
            ? phone
              ? centsToDollars(balanceMinor)
              : `${centsToDollars(balanceMinor)} available`
            : "Wallet"}
      </span>
      <button type="button" onClick={close} aria-label="Close" className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-control text-muted-foreground hover:text-foreground">
        <X size={13} weight="bold" />
      </button>
    </div>
  );

  let body: ReactNode;
  let footer: ReactNode;
  let hint: ReactNode = null;

  if (tab === "shout") {
    const text = shoutText.trim();
    const exceeds = over(shoutMinor);
    const seconds = SHOUT_TIERS.find((t) => t.fromMinor === shoutMinor)?.seconds ?? 60;
    body = (
      <div className="px-3 pt-1 pb-3">
        <div className="relative">
          <textarea
            value={shoutText}
            onChange={(e) => setShoutText(e.target.value.slice(0, SHOUT_MAX_LENGTH))}
            rows={2}
            placeholder="Say it to the whole room"
            aria-label="Your Shout"
            className="block w-full resize-none rounded-[16px] bg-white/[0.06] px-3.5 pt-2.5 pb-6 text-[14px] leading-snug text-foreground shadow-[inset_0_0_0_1px_rgba(255,236,230,0.1)] outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09] focus:shadow-[inset_0_0_0_1.5px_var(--ember)]"
          />
          <span className="pointer-events-none absolute right-3.5 bottom-2 font-mono text-[10.5px] text-muted-foreground tabular-nums">
            {shoutText.length}/{SHOUT_MAX_LENGTH}
          </span>
        </div>
        <p className="caps mt-3 mb-2 px-1 font-mono text-[10.5px] text-muted-foreground">Pinned over the chat for</p>
        <div role="radiogroup" aria-label="How much, and how long it's pinned" className="grid grid-cols-3 gap-1.5">
          {SHOUT_TIERS.map((t) => {
            const on = shoutMinor === t.fromMinor;
            return (
              <button
                key={t.fromMinor}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setShoutMinor(t.fromMinor)}
                className={cn(
                  "press flex h-14 flex-col items-center justify-center rounded-[14px] transition-colors",
                  on ? "bg-white text-[#0b0708]" : "bg-white/[0.05] text-foreground hover:bg-white/[0.09]",
                  !on && over(t.fromMinor) && "opacity-45"
                )}
              >
                <span className="font-money text-[17px] leading-none tabular-nums">{centsToDollars(t.fromMinor)}</span>
                <span className={cn("mt-1 flex items-center gap-1 text-[11px] font-medium", on ? "text-[#0b0708]/60" : "text-muted-foreground")}>
                  <Clock size={10} />
                  {pinLength(t.seconds)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
    footer = (
      <button type="button" onClick={() => text && !exceeds && onShout?.(shoutMinor, text)} disabled={busy || !text || exceeds} className={SEND}>
        {busy ? (
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <>
            <GiftArt art={SHOUT_GIFT.art} emoji={SHOUT_GIFT.emoji} size={20} />
            <span className="truncate">{text ? `Shout · ${centsToDollars(shoutMinor)} · ${pinLength(seconds)} pinned` : "Write your Shout"}</span>
          </>
        )}
      </button>
    );
    hint =
      exceeds || error ? (
        <p className={cn("px-4 pb-3 text-[11.5px]", error ? "text-chili-hi" : "text-value")}>
          {error ?? `That's more than your ${centsToDollars(balanceMinor!)} balance — top up your dollar wallet to send it.`}
        </p>
      ) : (
        <p className="px-4 pb-3 text-[11.5px] text-muted-foreground">
          Shouts start at {centsToDollars(SHOUT_MIN_MINOR)} and keep to the room&apos;s chat rules. After the pin, it stays in chat.
        </p>
      );
  } else if (tab === "requests" && requests) {
    const chosen = requests.menu.items.find((i) => i.id === item) ?? null;
    const exceeds = chosen ? over(chosen.priceUsdMinor) : false;
    const mine = requests.mine;
    body = (
      <div className={cn("overflow-y-auto px-3 pt-1 pb-3 scrollbar-none", phone ? "max-h-[50dvh]" : "max-h-[46vh]")}>
        {ordered ? (
          <div className="flex items-center gap-3 rounded-[14px] bg-white/[0.05] px-3.5 py-3">
            <GiftArt art={REQUEST_GIFT.art} emoji={REQUEST_GIFT.emoji} size={36} />
            <p className="min-w-0 text-[13px] leading-snug">
              <span className="block font-semibold">Sent to {requests.hostName}</span>
              <span className="text-muted-foreground">You&apos;ll hear when it&apos;s done. If they skip it, the money comes straight back.</span>
            </p>
          </div>
        ) : (
          <>
            <p className="px-1 pb-2 text-[12px] leading-snug text-muted-foreground">
              Pay to ask {requests.hostName}. If they skip yours, you&apos;re refunded in full.
            </p>
            <ul role="radiogroup" aria-label="The menu" className="flex flex-col gap-1.5">
              {requests.menu.items.map((i) => {
                const on = item === i.id;
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setItem(on ? null : i.id);
                        setOrderError(null);
                      }}
                      className={cn(
                        "press flex w-full items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-left transition-colors",
                        on ? "bg-white/[0.1] shadow-[inset_0_0_0_1.5px_var(--ember)]" : "bg-white/[0.05] hover:bg-white/[0.08]",
                        !on && over(i.priceUsdMinor) && "opacity-45"
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">{i.title}</span>
                        {i.prompt && <span className="block truncate text-[12px] text-muted-foreground">{i.prompt}</span>}
                      </span>
                      <span className="shrink-0 font-money text-[16px] text-value tabular-nums">{centsToDollars(i.priceUsdMinor)}</span>
                    </button>
                    {on && (
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value.slice(0, 120))}
                        placeholder={i.prompt || "Add a note (optional)"}
                        aria-label={i.prompt || "A note for the host"}
                        autoFocus={!phone}
                        className="mt-1.5 h-11 w-full rounded-full bg-white/[0.06] px-4 text-[13.5px] text-foreground shadow-[inset_0_0_0_1px_rgba(255,236,230,0.1)] outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09] focus:shadow-[inset_0_0_0_1.5px_var(--ember)]"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {mine.length > 0 && (
          <div className="mt-3.5">
            <p className="caps mb-1.5 px-1 font-mono text-[10.5px] text-muted-foreground">Yours on this stream</p>
            <ul className="flex flex-col gap-1">
              {mine.slice(0, 6).map((o) => (
                <MyRequest key={o.id} order={o} />
              ))}
            </ul>
          </div>
        )}
      </div>
    );
    footer = ordered ? (
      <button type="button" onClick={() => setOrdered(null)} className="press flex h-11 flex-1 items-center justify-center rounded-full bg-white/[0.08] text-sm font-semibold text-foreground hover:bg-white/[0.12]">
        Ask for something else
      </button>
    ) : (
      <button
        type="button"
        disabled={!chosen || exceeds || ordering}
        onClick={async () => {
          if (!chosen) return;
          setOrdering(true);
          setOrderError(null);
          try {
            await requests.onOrder(chosen.id, note.trim());
            setOrdered(chosen.id);
            setItem(null);
            setNote("");
          } catch (err) {
            setOrderError(err instanceof Error ? err.message : "The request didn't go through.");
          } finally {
            setOrdering(false);
          }
        }}
        className={SEND}
      >
        {ordering ? (
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <>
            <GiftArt art={REQUEST_GIFT.art} emoji={REQUEST_GIFT.emoji} size={20} />
            <span className="truncate">{chosen ? `Pay ${centsToDollars(chosen.priceUsdMinor)} · ${chosen.title}` : "Pick something"}</span>
          </>
        )}
      </button>
    );
    if (orderError || exceeds) {
      hint = (
        <p className={cn("px-4 pb-3 text-[11.5px]", orderError ? "text-chili-hi" : "text-value")}>
          {orderError ?? `That's more than your ${centsToDollars(balanceMinor!)} balance — top up your dollar wallet to ask.`}
        </p>
      );
    }
  } else {
    const gift = GIFT_CATALOG.find((g) => g.id === picked) ?? null;
    const customMinor = custom.trim() ? Math.round(Number(custom) * 100) : null;
    const amount = gift ? gift.usdMinor : customMinor;
    const valid = amount !== null && Number.isFinite(amount) && amount >= GIFT_MIN_MINOR && amount <= GIFT_MAX_MINOR;
    const exceeds = valid && over(amount);
    // In a battle that counts only some gifts, those wear a small mark and
    // the line above says which; every gift still reaches the host.
    const battleLine = giftFilterLine(counting);
    // Seventeen faces now — the grid scrolls under a cap so the Send row
    // stays on screen on a short phone.
    body = (
      <>
        {battleLine && (
          <p className="flex items-center gap-1.5 px-4 pt-1 text-[12px] font-semibold text-ember-hi">
            <Sword size={12} weight="fill" />
            In the battle: {battleLine.charAt(0).toLowerCase() + battleLine.slice(1)}
          </p>
        )}
        <div className={cn("grid grid-cols-4 gap-2 overflow-y-auto px-3 pt-2 pb-3 scrollbar-none", phone ? "max-h-[50dvh]" : "max-h-[46vh]")}>
          {GIFT_CATALOG.map((g) => {
            const active = picked === g.id;
            const scores = counting.includes(g.id);
            const token = (
              <GiftToken
                key={g.id}
                gift={g}
                size={phone ? "md" : "sm"}
                state={active ? (busy ? "sending" : "picked") : "rest"}
                dimmed={balanceMinor !== null && g.usdMinor > balanceMinor}
                title={`${g.name} · ${centsToDollars(g.usdMinor)}${scores ? " · counts in the battle" : ""}`}
                onClick={() => {
                  setPicked(active ? null : g.id);
                  setCustom("");
                }}
              />
            );
            if (!scores) return token;
            return (
              <div key={g.id} className="relative">
                {token}
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1.5 right-1.5 flex size-[18px] items-center justify-center rounded-full bg-ember text-on-ember"
                >
                  <Sword size={10} weight="fill" />
                </span>
              </div>
            );
          })}
        </div>
      </>
    );
    footer = (
      <>
        <label className="relative w-[7.5rem] shrink-0">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs text-muted-foreground">$</span>
          <input
            type="number"
            inputMode="decimal"
            min={GIFT_MIN_MINOR / 100}
            max={GIFT_MAX_MINOR / 100}
            step="0.5"
            placeholder="Other"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setPicked(null);
            }}
            aria-label="Custom amount in dollars"
            className="h-11 w-full rounded-full bg-white/[0.06] pr-3 pl-6 text-sm text-foreground shadow-[inset_0_0_0_1px_rgba(255,236,230,0.1)] outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09] focus:shadow-[inset_0_0_0_1.5px_var(--ember)]"
          />
        </label>
        <button type="button" onClick={() => valid && !exceeds && onSend({ gift, usdMinor: amount! })} disabled={busy || !valid || exceeds} className={SEND}>
          {busy ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <>
              {gift && <GiftArt art={gift.art} emoji={gift.emoji} size={20} />}
              <span className="truncate">
                {gift ? `Send ${gift.name} · ${centsToDollars(gift.usdMinor)}` : valid ? `Send ${centsToDollars(amount!)}` : "Pick a gift"}
              </span>
              {!gift && <PaperPlaneRight size={14} weight="fill" />}
            </>
          )}
        </button>
      </>
    );
    if (exceeds || error || (custom.trim() && !valid)) {
      hint = (
        <p className={cn("px-4 pb-3 text-[11.5px]", error ? "text-chili-hi" : "text-value")}>
          {error ??
            (exceeds
              ? `That's more than your ${centsToDollars(balanceMinor!)} balance — top up your dollar wallet to send it.`
              : `Gifts run from ${centsToDollars(GIFT_MIN_MINOR)} to ${centsToDollars(GIFT_MAX_MINOR)}.`)}
        </p>
      );
    } else if (battleLine && valid && !(gift && counting.includes(gift.id))) {
      hint = <p className="px-4 pb-3 text-[11.5px] text-muted-foreground">This one goes to the host but won&apos;t move the battle score.</p>;
    }
  }

  const panel = (
    <div
      onAnimationEnd={finish}
      className={cn(
        "sheet-obj relative flex flex-col text-foreground",
        phone ? "rounded-t-overlay pb-[env(safe-area-inset-bottom)]" : "rounded-t-overlay",
        closing ? "animate-sheet-down" : "animate-sheet-up"
      )}
      role="dialog"
      aria-label="Send a gift"
    >
      {header}
      {body}
      <div className="flex items-center gap-2 border-t border-hairline px-3 py-3">{footer}</div>
      {hint}
    </div>
  );

  // `pointer-events-auto` on both roots: the chat's overlay variant sets
  // pointer-events-none on its root, and that inherits — even through
  // `fixed` — so without it the sheet drew fine and took no taps on
  // phones (Greg, 2026-09-22: "Can't click on any gift here").
  // On phones the sheet goes to the body: the chat's lane is its own layer
  // on the watch page, under the like and share buttons, and a sheet
  // inside it could never rise above them.
  if (phone) {
    return createPortal(
      <div className="pointer-events-auto fixed inset-0 z-[70]">
        <button type="button" aria-label="Close" onClick={close} className={cn("absolute inset-0 bg-black/60", closing ? "animate-fade-out" : "animate-fade-in")} />
        <div className="absolute inset-x-0 bottom-0">{panel}</div>
      </div>,
      document.body
    );
  }
  return <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.8)]">{panel}</div>;
}

/** One of my requests, and where it stands. */
function MyRequest({ order }: { order: RequestOrder }) {
  const done = order.status === "done";
  const waiting = order.status === "pending";
  return (
    <li className="flex items-center gap-2.5 rounded-[12px] px-2.5 py-1.5 text-[12.5px]">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{order.title}</span>
        {order.note && <span className="text-muted-foreground"> · {order.note}</span>}
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
          waiting ? "bg-ember/[0.14] text-ember-hi" : done ? "bg-success/15 text-success" : "bg-white/[0.06] text-muted-foreground"
        )}
      >
        {waiting ? <span aria-hidden className="size-1.5 rounded-full bg-ember" /> : done ? <Check size={10} weight="bold" /> : null}
        {waiting ? "Waiting" : done ? "Done" : order.refunded ? "Refunded" : "Refunding"}
      </span>
    </li>
  );
}
