"use client";

import { useSyncExternalStore } from "react";

/**
 * "Set up OBS for me": the studio talks to OBS on the creator's own computer
 * over obs-websocket (built into OBS 28+, off until they turn it on), so the
 * server and key land in OBS without copy and paste, and OBS starts and
 * stops from the studio. Protocol v5, JSON over a local WebSocket; no
 * library. The password stays in this tab's memory — never stored or sent
 * anywhere but OBS.
 *
 * One connection per tab, held here rather than in a component, so it
 * outlives the setup screen when the studio goes live.
 */

export class ObsError extends Error {
  constructor(
    message: string,
    public code = 0
  ) {
    super(message);
    this.name = "ObsError";
  }
}

/** OBS's own words for the two ways it streams to a custom server. */
const SERVICE = { rtmp: "rtmp_custom", whip: "whip_custom" } as const;
const REQUEST_TIMEOUT_MS = 8_000;
const CONNECT_TIMEOUT_MS = 6_000;

/** What OBS sends: a hello with its password challenge, then answers to requests. */
interface ObsMessage {
  op: number;
  d: {
    authentication?: { challenge: string; salt: string };
    requestId?: string;
    requestStatus?: { result: boolean; code: number; comment?: string };
    responseData?: unknown;
  };
}

async function sha256b64(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

class ObsSocket {
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private seq = 0;

  constructor(
    private ws: WebSocket,
    onClose: () => void
  ) {
    ws.onmessage = (ev) => {
      let msg: ObsMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.op !== 7 || !msg.d.requestId) return;
      const waiting = this.pending.get(msg.d.requestId);
      if (!waiting) return;
      this.pending.delete(msg.d.requestId);
      const status = msg.d.requestStatus;
      if (status?.result) waiting.resolve(msg.d.responseData ?? {});
      else waiting.reject(new ObsError(status?.comment || `OBS turned that down (code ${status?.code ?? 0})`, status?.code ?? 0));
    };
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new ObsError("OBS closed the connection."));
      this.pending.clear();
      onClose();
    };
  }

  request<T>(requestType: string, requestData?: Record<string, unknown>): Promise<T> {
    const requestId = String(++this.seq);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } }));
      setTimeout(() => {
        if (this.pending.delete(requestId)) reject(new ObsError("OBS didn't answer in time."));
      }, REQUEST_TIMEOUT_MS);
    });
  }

  close() {
    this.ws.close();
  }
}

/** Open the socket, answer OBS's password challenge, and learn its version. */
function open(port: number, password: string, onClose: () => void) {
  return new Promise<{ socket: ObsSocket; version: string }>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`, "obswebsocket.json");
    } catch {
      reject(new ObsError("This browser won't let the page reach OBS. Try Chrome or Edge on the computer OBS runs on."));
      return;
    }
    let identified = false;
    const timer = setTimeout(() => {
      ws.close();
      reject(new ObsError("OBS didn't answer. Is it open on this computer, with its WebSocket server on?"));
    }, CONNECT_TIMEOUT_MS);

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(String(ev.data)) as ObsMessage;
      if (msg.op === 0) {
        const challenge = msg.d.authentication;
        let authentication: string | undefined;
        if (challenge) {
          if (!password) {
            clearTimeout(timer);
            ws.close();
            reject(new ObsError("OBS wants its WebSocket password — find it under Tools → WebSocket Server Settings → Show Connect Info."));
            return;
          }
          authentication = await sha256b64((await sha256b64(password + challenge.salt)) + challenge.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, ...(authentication ? { authentication } : {}) } }));
      } else if (msg.op === 2) {
        identified = true;
        clearTimeout(timer);
        const socket = new ObsSocket(ws, onClose);
        try {
          const v = await socket.request<{ obsVersion?: string }>("GetVersion");
          resolve({ socket, version: v.obsVersion ?? "" });
        } catch (err) {
          socket.close();
          reject(err);
        }
      }
    };
    ws.onclose = (ev) => {
      clearTimeout(timer);
      if (identified) return;
      reject(
        new ObsError(
          ev.code === 4009
            ? "That password didn't work — check it under Tools → WebSocket Server Settings → Show Connect Info."
            : "Couldn't reach OBS on this computer. Is it open, with its WebSocket server on?",
          ev.code
        )
      );
    };
  });
}

export type ObsStatus = "idle" | "connecting" | "connected" | "error";
export interface ObsState {
  status: ObsStatus;
  /** OBS's version once connected ("31.1.2"). */
  version: string;
  error: string;
}

const IDLE: ObsState = { status: "idle", version: "", error: "" };
let state: ObsState = IDLE;
let socket: ObsSocket | null = null;
const listeners = new Set<() => void>();

function set(next: ObsState) {
  state = next;
  for (const l of listeners) l();
}

/** The tab's connection to OBS, as it stands. */
export function useObs() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => IDLE
  );
}

export async function connectObs(port: number, password: string) {
  socket?.close();
  socket = null;
  set({ status: "connecting", version: "", error: "" });
  try {
    const opened = await open(port, password, () => {
      socket = null;
      if (state.status === "connected") set({ status: "idle", version: "", error: "" });
    });
    socket = opened.socket;
    set({ status: "connected", version: opened.version, error: "" });
  } catch (err) {
    set({ status: "error", version: "", error: err instanceof Error ? err.message : "Couldn't reach OBS." });
  }
}

export function disconnectObs() {
  const s = socket;
  socket = null;
  set(IDLE);
  s?.close();
}

function request<T>(type: string, data?: Record<string, unknown>) {
  if (!socket) return Promise.reject(new ObsError("Connect to OBS first."));
  return socket.request<T>(type, data);
}

/** Point OBS at Xtream: the server and key over RTMP, or the server and bearer token over WHIP. */
export async function sendKeyToObs(protocol: "rtmp" | "whip", server: string, secret: string) {
  if (protocol === "whip") {
    const major = parseInt(state.version, 10);
    if (major && major < 30) throw new ObsError("WHIP needs OBS 30 or later — switch to RTMP, or update OBS.");
    await request("SetStreamServiceSettings", { streamServiceType: SERVICE.whip, streamServiceSettings: { server, bearer_token: secret } });
  } else {
    await request("SetStreamServiceSettings", { streamServiceType: SERVICE.rtmp, streamServiceSettings: { server, key: secret, use_auth: false } });
  }
}

/**
 * Xtream's preset: 1280×720 at 30 fps — the size phones on mobile data
 * handle best — and 2,500 kbps when OBS is in Simple output mode (in
 * Advanced mode the bitrate lives in the encoder's own settings).
 */
export async function applyXtreamPreset() {
  try {
    await request("SetVideoSettings", { fpsNumerator: 30, fpsDenominator: 1, outputWidth: 1280, outputHeight: 720 });
  } catch (err) {
    // OBS won't change its video while it's streaming or recording.
    if (err instanceof ObsError && err.code === 500) throw new ObsError("Stop streaming and recording in OBS first — it won't change size mid-stream.", 500);
    throw err;
  }
  const mode = await request<{ parameterValue: string | null }>("GetProfileParameter", { parameterCategory: "Output", parameterName: "Mode" }).catch(() => ({
    parameterValue: null,
  }));
  if (mode.parameterValue === "Simple") {
    await request("SetProfileParameter", { parameterCategory: "SimpleOutput", parameterName: "VBitrate", parameterValue: "2500" });
    return { bitrate: true };
  }
  return { bitrate: false };
}

export interface ObsStreamStatus {
  outputActive: boolean;
  outputReconnecting: boolean;
  /** Milliseconds on air. */
  outputDuration: number;
  outputSkippedFrames: number;
  outputTotalFrames: number;
}

export const obsStreamStatus = () => request<ObsStreamStatus>("GetStreamStatus");
export const startObsStream = () => request("StartStream");
export const stopObsStream = () => request("StopStream");
