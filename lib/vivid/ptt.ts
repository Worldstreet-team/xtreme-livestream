"use client"

import { useSyncExternalStore } from "react"

/**
 * Push-to-talk for Vivid while the host is live (Phase 3, Vivid as
 * producer). On air the host is talking to their audience, not to Vivid —
 * so the studio switches Vivid's ears to push-to-talk and Vivid hears only
 * while the host holds the talk key. The voice session reads `vividHears()`
 * for every frame it would send.
 */

let pushToTalk = false
let held = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function setPushToTalk(on: boolean) {
  if (pushToTalk === on) return
  pushToTalk = on
  if (!on) held = false
  emit()
}

export function setTalkHeld(on: boolean) {
  if (held === on) return
  held = on
  emit()
}

/** Whether Vivid should hear the mic right now. */
export function vividHears() {
  return !pushToTalk || held
}

let snapshot = { pushToTalk, held }
function read() {
  if (snapshot.pushToTalk !== pushToTalk || snapshot.held !== held) snapshot = { pushToTalk, held }
  return snapshot
}

export function usePushToTalk() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    read,
    () => ({ pushToTalk: false, held: false }),
  )
}
