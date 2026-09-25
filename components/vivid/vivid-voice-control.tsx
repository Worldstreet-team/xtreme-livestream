"use client"

import { useCallback, useEffect, type ReactNode } from "react"
import type { VividAgentState } from "@/lib/vivid/types"
import SilkOrb from "./silk-orb"
import { useSiraVivid } from "./sira-provider"

/**
 * Vivid's presence on the page, in two forms.
 *
 * Idle: the orb lives in the top bar (`VividLauncher`) — an "Ask Vivid"
 * pill on desktop, the bare orb on phones — so it never floats over the
 * picture (owner's pick, 2026-09-23: option 3B, in heat). Tap to start.
 *
 * Live: the orb docks into a slim capsule centred at the bottom of the screen —
 * the Codex grammar: one quiet bar that says who is listening and always shows
 * the way out. The page stays the star; the capsule is furniture.
 */

const STATE_LABELS: Record<VividAgentState, string> = {
  idle: "",
  connecting: "Connecting",
  ready: "Ready",
  listening: "Listening",
  processing: "Thinking",
  speaking: "Speaking",
  error: "",
}

/** State dot inside the live capsule — brand while working, credit when talking. */
const STATE_DOT: Record<VividAgentState, string> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-primary animate-pulse",
  ready: "bg-emerald-500",
  listening: "bg-primary animate-pulse",
  processing: "bg-primary animate-pulse",
  speaking: "bg-emerald-500 animate-pulse",
  error: "bg-destructive",
}

// Nobody talking for this long — Vivid finished and the user silent — ends the
// session. Without it, a forgotten tab with a live mic keeps billing turns off
// background noise until the link happens to drop.
const IDLE_END_MS = 30_000

const NOOP = () => {}
const NO_LEVELS = () => new Uint8Array(0)

export default function VividVoiceControl() {
  const vivid = useSiraVivid()
  const state = vivid?.state ?? "idle"
  const endSession = vivid?.endSession ?? NOOP
  const getAudioLevels = vivid?.getAudioLevels ?? NO_LEVELS

  const isLive = state !== "idle" && state !== "error"

  // "ready" is the only quiet state: not connecting, not listening to the user,
  // not thinking, not speaking. Any transition re-arms the timer.
  useEffect(() => {
    if (state !== "ready") return
    const timer = setTimeout(() => endSession(), IDLE_END_MS)
    return () => clearTimeout(timer)
  }, [state, endSession])

  return (
    <>
      {/* Live: the capsule, centred at the bottom — Vivid is in control. */}
      {isLive && (
        <div className="fixed inset-x-0 bottom-5 z-[45] flex justify-center px-4 max-md:bottom-24">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-card/90 py-1.5 pl-1.5 pr-2 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            <SilkOrb state={state} size="xs" getAudioLevels={getAudioLevels} label="Vivid" />

            <div className="flex items-center gap-2 pl-2 pr-1.5 select-none" aria-live="polite">
              <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[state]}`} />
              <span className="text-[12.5px] font-medium text-white/90 min-w-16">
                {STATE_LABELS[state]}
              </span>
            </div>

            <span className="h-5 w-px bg-white/[0.07]" aria-hidden />

            <CapsuleButton onClick={() => endSession()} label="End Vivid session" danger>
              <CloseIcon />
            </CapsuleButton>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * The way in, docked in the top bar. `pill` is desktop's "Ask Vivid" with a
 * small orb; `orb` is the phone's bare orb in a 36px slot. While a session
 * runs it says what Vivid is doing, and a tap ends it.
 */
export function VividLauncher({ variant, className = "" }: { variant: "pill" | "orb"; className?: string }) {
  const vivid = useSiraVivid()
  const state = vivid?.state ?? "idle"
  const isConnected = vivid?.isConnected ?? false
  const startSession = vivid?.startSession
  const endSession = vivid?.endSession ?? NOOP
  const getAudioLevels = vivid?.getAudioLevels ?? NO_LEVELS
  const isLive = state !== "idle" && state !== "error"

  const onClick = useCallback(async () => {
    // Connecting counts as live, so a second tap while it dials ends it.
    if (isLive) return endSession()
    if (!isConnected) await startSession?.()
  }, [isLive, endSession, isConnected, startSession])

  if (!vivid) return null
  const label = isLive ? "End Vivid session" : "Talk to Vivid"

  if (variant === "orb") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className={`press relative flex size-9 shrink-0 items-center justify-center rounded-full shadow-[0_0_20px_-6px_rgba(248,88,16,0.8)] ${className}`}
      >
        <SilkOrb state={state} size={40} getAudioLevels={getAudioLevels} className="pointer-events-none shrink-0" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`press flex h-10 shrink-0 items-center gap-2 rounded-full bg-control pr-4 pl-1 text-[13.5px] font-semibold whitespace-nowrap text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] transition-colors hover:bg-control-hover ${className}`}
    >
      <span className="relative flex size-8 items-center justify-center">
        <SilkOrb state={state} size={40} getAudioLevels={getAudioLevels} className="pointer-events-none shrink-0" />
      </span>
      <span aria-live="polite">{isLive ? STATE_LABELS[state] || "Vivid" : "Ask Vivid"}</span>
    </button>
  )
}

/** One round control inside the capsule — fill separates, never outline. */
function CapsuleButton({
  onClick,
  label,
  danger = false,
  children,
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150 ${
        danger
          ? "bg-destructive/15 text-destructive hover:bg-destructive hover:text-white"
          : "bg-white/[0.06] text-muted-foreground hover:bg-white/[0.1] hover:text-white"
      }`}
    >
      {children}
    </button>
  )
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
