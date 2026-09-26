"use client";

import "@/components/app/messages/messaging.css";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { IDLE_CALL_STATE, callManager, type CallPeer, type CallState } from "@/lib/call-manager";
import { getMessagingSession, messaging } from "@/lib/messaging";
import { useCallTones } from "./use-call-tones";
import { CallSurface } from "./call-surface";

/**
 * Calls, on every page. A call can ring while you're watching a stream or
 * browsing, so the listener and the surface live in the app shell, not in
 * /messages. Mounted for everyone; it only listens once you're signed in.
 */

const actions = {
  startCall: (opts: { conversationId: string; peer: CallPeer; isVideo: boolean; isGroup?: boolean }) =>
    void callManager.startCall(opts),
  joinCall: (opts: { conversationId: string; peer: CallPeer; isVideo: boolean }) => void callManager.joinCall(opts),
  acceptCall: () => void callManager.acceptCall(),
  declineCall: () => callManager.declineCall(),
  endCall: () => callManager.endCall(),
  toggleMic: () => void callManager.toggleMic(),
  toggleCam: () => void callManager.toggleCam(),
  flipCamera: () => void callManager.flipCamera(),
  setMinimized: (minimized: boolean) => callManager.setMinimized(minimized),
  rejoin: () => void callManager.rejoin(),
  dismissRejoin: () => callManager.dismissRejoin(),
  clearError: () => callManager.clearError(),
};

export type CallContextValue = CallState & typeof actions & {
  /** Signed in and listening: calls can be placed. */
  ready: boolean;
  /** You, as the call surface shows you (your own tile in a group). */
  self: { name: string; avatar: string } | null;
};

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used inside CallProvider");
  return ctx;
}

export function CallProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const state = useSyncExternalStore(callManager.subscribeStore, callManager.getSnapshot, () => IDLE_CALL_STATE);
  const [ready, setReady] = useState(false);
  const [self, setSelf] = useState<{ name: string; avatar: string } | null>(null);

  // Wire the manager to the gateway and to my private calls channel.
  useEffect(() => {
    if (!enabled) {
      callManager.shutdown();
      return;
    }
    callManager.setBackend({
      token: (id) => messaging.calls.token(id),
      ring: (id, video) => messaging.calls.ring(id, video),
      signal: (id, type) => messaging.calls.signal(id, type),
      log: (input) => messaging.calls.log(input),
    });
    let cancelled = false;
    getMessagingSession()
      .then(({ me, live }) => {
        if (cancelled) return;
        callManager.initialize(me.id, (handler) => live.onCall(handler));
        setSelf({ name: me.name, avatar: me.avatar });
        setReady(true);
      })
      .catch(() => {
        // Messaging unreachable: calls stay unavailable; the thread says why.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useCallTones(state);

  // A call you can't see is a call you'll miss: in a background tab, ring
  // at the OS level too.
  const incoming = state.status === "ringing" && state.isIncoming ? state : null;
  useEffect(() => {
    if (!incoming?.peer || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted" || document.visibilityState === "visible") return;
    const who = incoming.isGroup ? `${incoming.groupCaller?.name ?? "Someone"} · ${incoming.peer.name}` : incoming.peer.name;
    const notification = new Notification(`${who} is calling`, {
      body: incoming.isVideo ? "Incoming video call on Xtream" : "Incoming voice call on Xtream",
      icon: incoming.peer.avatar || undefined,
      tag: "xtream-incoming-call",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return () => notification.close();
  }, [incoming?.peer, incoming?.isGroup, incoming?.groupCaller?.name, incoming?.isVideo]);

  // Ask for notification permission on the first call, never on page load.
  const active = state.status !== "idle";
  useEffect(() => {
    if (!active || typeof Notification === "undefined") return;
    if (Notification.permission === "default") void Notification.requestPermission().catch(() => {});
  }, [active]);

  // Closing the tab mid-call hangs up instead of leaving a ghost in the room.
  // Only while a call exists: a permanent listener costs back/forward cache.
  useEffect(() => {
    if (!active) return;
    const onLeave = () => {
      if (callManager.getState().status !== "idle") callManager.endCall();
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [active]);

  const value = useMemo<CallContextValue>(
    () => ({ ...state, ...actions, ready: enabled && ready, self }),
    [state, enabled, ready, self],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {enabled && <CallSurface />}
    </CallContext.Provider>
  );
}
