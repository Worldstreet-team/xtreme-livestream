"use client";

import { useState } from "react";
import { X, PaperPlaneRight, Wallet } from "@/components/icons";
import { GIFT_CATALOG, GIFT_MAX_MINOR, GIFT_MIN_MINOR, centsToDollars, type GiftDef } from "@/lib/gifts";
import { cn } from "@/lib/utils";
import { GiftArt } from "@/components/app/gift-art";
import { GiftToken } from "@/components/xtream/gift-token";
import { usePhone } from "@/components/app/shelf";

/**
 * The gift picker, built like a sticker keyboard: a grid of animated faces,
 * each wearing its price tag, that slides up from the bottom of the chat
 * the way a keyboard does. On phones it is a bottom sheet over the page;
 * on desktop it docks inside the chat column above the composer. One tap
 * picks a sticker, the Send row says exactly what is about to be charged.
 */
export function GiftKeyboard({
  open,
  onClose,
  balanceMinor,
  balanceLoading,
  busy,
  error,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  /** Spendable wallet balance in cents; null when unknown. */
  balanceMinor: number | null;
  balanceLoading: boolean;
  busy: boolean;
  error: string | null;
  /** Fires with the chosen gift, or a custom amount in cents. */
  onSend: (choice: { gift: GiftDef | null; usdMinor: number }) => void;
}) {
  const phone = usePhone();
  const [picked, setPicked] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [closing, setClosing] = useState(false);

  // Reopening starts clean — adjusted during render against the last `open`
  // seen, so there's no effect-driven second pass. The slide-down before
  // unmount is driven by the closing flag so the sheet never just vanishes.
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) {
      setClosing(false);
      setPicked(null);
      setCustom("");
    }
  }

  if (!open && !closing) return null;

  const gift = GIFT_CATALOG.find((g) => g.id === picked) ?? null;
  const customMinor = custom.trim() ? Math.round(Number(custom) * 100) : null;
  const amount = gift ? gift.usdMinor : customMinor;
  const valid = amount !== null && Number.isFinite(amount) && amount >= GIFT_MIN_MINOR && amount <= GIFT_MAX_MINOR;
  const exceeds = valid && balanceMinor !== null && amount! > balanceMinor;

  const close = () => {
    setClosing(true);
  };
  const finish = () => {
    if (closing) {
      setClosing(false);
      onClose();
    }
  };

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
      {/* Handle + title row */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        {phone && <span className="absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-white/20" />}
        <span className="text-[13px] font-semibold">Send a gift</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-value tabular-nums">
          <Wallet size={12} weight="fill" />
          {balanceLoading && balanceMinor === null ? "Checking…" : balanceMinor !== null ? `${centsToDollars(balanceMinor)} available` : "Dollar wallet"}
        </span>
        <button type="button" onClick={close} aria-label="Close" className="press flex size-8 items-center justify-center rounded-full bg-control text-muted-foreground hover:text-foreground">
          <X size={13} weight="bold" />
        </button>
      </div>

      {/* The stickers */}
      {/* Seventeen faces now — the grid scrolls under a cap so the Send
          row stays on screen on a short phone. */}
      <div className={cn("grid grid-cols-4 gap-2 overflow-y-auto px-3 pt-2 pb-3 scrollbar-none", phone ? "max-h-[50dvh]" : "max-h-[46vh]")}>
        {GIFT_CATALOG.map((g) => {
          const active = picked === g.id;
          return (
            <GiftToken
              key={g.id}
              gift={g}
              size={phone ? "md" : "sm"}
              state={active ? (busy ? "sending" : "picked") : "rest"}
              dimmed={balanceMinor !== null && g.usdMinor > balanceMinor}
              title={`${g.name} · ${centsToDollars(g.usdMinor)}`}
              onClick={() => {
                setPicked(active ? null : g.id);
                setCustom("");
              }}
            />
          );
        })}
      </div>

      {/* Custom amount + send */}
      <div className="flex items-center gap-2 border-t border-hairline px-3 py-3">
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
        <button
          type="button"
          onClick={() => valid && !exceeds && onSend({ gift, usdMinor: amount! })}
          disabled={busy || !valid || exceeds}
          className={cn(
            "press flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold text-white transition-[filter,opacity] disabled:cursor-not-allowed disabled:opacity-50",
            "bg-heat shadow-[inset_0_1px_0_rgba(255,255,255,0.42),var(--glow-heat)] hover:brightness-110"
          )}
        >
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
      </div>
      {(exceeds || error || (custom.trim() && !valid)) && (
        <p className={cn("px-4 pb-3 text-[11.5px]", error ? "text-chili-hi" : "text-value")}>
          {error ?? (exceeds ? `That's more than your ${centsToDollars(balanceMinor!)} balance — top up your dollar wallet to send it.` : `Gifts run from ${centsToDollars(GIFT_MIN_MINOR)} to ${centsToDollars(GIFT_MAX_MINOR)}.`)}
        </p>
      )}
    </div>
  );

  // `pointer-events-auto` on both roots: the chat's overlay variant sets
  // pointer-events-none on its root, and that inherits — even through
  // `fixed` — so without it the sheet drew fine and took no taps on
  // phones (Greg, 2026-09-22: "Can't click on any gift here").
  if (phone) {
    return (
      <div className="pointer-events-auto fixed inset-0 z-50">
        <button type="button" aria-label="Close" onClick={close} className={cn("absolute inset-0 bg-black/60", closing ? "animate-fade-out" : "animate-fade-in")} />
        <div className="absolute inset-x-0 bottom-0">{panel}</div>
      </div>
    );
  }
  return <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.8)]">{panel}</div>;
}
