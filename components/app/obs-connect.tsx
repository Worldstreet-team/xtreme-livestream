"use client";

import { useEffect, useState } from "react";
import { Broadcast, Check, Stop } from "@/components/icons";
import {
  applyXtreamPreset,
  connectObs,
  disconnectObs,
  obsStreamStatus,
  sendKeyToObs,
  startObsStream,
  stopObsStream,
  useObs,
  type ObsStreamStatus,
} from "@/lib/obs-websocket";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 min-w-0 rounded-full bg-white/[0.06] px-3.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:bg-white/[0.09] focus:shadow-[inset_0_0_0_1.5px_var(--ember)]";
const BUTTON = "press flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors disabled:opacity-50";

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * "Set up OBS for me", inside the studio's encoder block: connect to OBS on
 * this computer (obs-websocket, Tools → WebSocket Server Settings), send the
 * server and key across, apply Xtream's 720p30 preset, and — once live —
 * start and stop OBS from here.
 */
export function ObsConnect({
  protocol,
  server,
  secret,
  live,
}: {
  protocol: "rtmp" | "whip";
  server: string | null;
  secret: string | null;
  /** The Xtream broadcast is on: OBS can be started from here. */
  live: boolean;
}) {
  const obs = useObs();
  const [open, setOpen] = useState(false);
  const [port, setPort] = useState("4455");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<ObsStreamStatus | null>(null);
  const connected = obs.status === "connected";

  // OBS's own stream, every few seconds while connected.
  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    const read = () =>
      obsStreamStatus()
        .then((s) => !stopped && setStream(s))
        .catch(() => {});
    read();
    const t = setInterval(read, 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [connected]);

  const act = async (key: string, work: () => Promise<string>) => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      setDone(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : "OBS turned that down.");
    } finally {
      setBusy(null);
    }
  };

  if (!connected) {
    return (
      <div className="mt-3 border-t border-white/[0.06] pt-3">
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className={cn(BUTTON, "bg-white/[0.07] text-foreground hover:bg-white/[0.11]")}>
            <Broadcast size={14} />
            Set up OBS for me
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connectObs(Number(port) || 4455, password);
            }}
          >
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              In OBS: <span className="text-foreground/85">Tools → WebSocket Server Settings</span>, tick Enable, then Show Connect Info for the
              password. It stays on this page and goes only to OBS.
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
                inputMode="numeric"
                aria-label="OBS WebSocket port"
                className={cn(FIELD, "w-[4.75rem] shrink-0 font-mono tabular-nums")}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                aria-label="OBS WebSocket password"
                autoComplete="off"
                className={cn(FIELD, "flex-1")}
              />
              <button
                type="submit"
                disabled={obs.status === "connecting"}
                className={cn(BUTTON, "h-9 shrink-0 bg-white px-3.5 text-[#0b0708]")}
              >
                {obs.status === "connecting" ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : "Connect"}
              </button>
            </div>
            {obs.status === "error" && (
              <p role="alert" className="mt-2 text-[12px] leading-snug text-chili-hi">
                {obs.error}
              </p>
            )}
          </form>
        )}
      </div>
    );
  }

  const onAir = Boolean(stream?.outputActive);
  const dropped = stream && stream.outputTotalFrames > 0 ? Math.round((stream.outputSkippedFrames / stream.outputTotalFrames) * 1000) / 10 : 0;

  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <div className="flex items-center gap-2">
        <span className="size-1.5 shrink-0 rounded-full bg-success" />
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">Connected to OBS{obs.version ? ` ${obs.version}` : ""}</p>
        <button type="button" onClick={disconnectObs} className="shrink-0 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          Disconnect
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!server || !secret || busy !== null}
          onClick={() =>
            void act("key", async () => {
              await sendKeyToObs(protocol, server!, secret!);
              return protocol === "whip" ? "OBS will stream to Xtream over WHIP." : "OBS will stream to Xtream.";
            })
          }
          className={cn(BUTTON, "bg-white text-[#0b0708]")}
        >
          {busy === "key" ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Check size={12} weight="bold" />}
          Send my key to OBS
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void act("preset", async () => {
              const { bitrate } = await applyXtreamPreset();
              return bitrate ? "OBS is set to 1280×720, 30 fps, 2,500 kbps." : "OBS is set to 1280×720, 30 fps. Set 2,500 kbps in its encoder settings.";
            })
          }
          className={cn(BUTTON, "bg-white/[0.07] text-foreground hover:bg-white/[0.11]")}
        >
          {busy === "preset" && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          Use 720p · 30 fps
        </button>
      </div>

      {live && stream && (
        <div className="mt-2.5 flex items-center gap-2 rounded-[10px] bg-white/[0.04] py-1.5 pr-1.5 pl-3">
          <span className={cn("size-1.5 shrink-0 rounded-full", onAir ? (stream.outputReconnecting ? "animate-pulse bg-warning" : "bg-chili") : "bg-white/25")} />
          <p className="min-w-0 flex-1 truncate text-[12.5px]">
            {onAir ? (
              <>
                <span className="font-semibold">{stream.outputReconnecting ? "OBS is reconnecting" : "OBS is streaming"}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {clock(stream.outputDuration)}
                  {dropped > 0 ? ` · ${dropped}% dropped` : ""}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">OBS isn&apos;t streaming yet</span>
            )}
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void act(onAir ? "stop" : "start", async () => {
                if (onAir) await stopObsStream();
                else await startObsStream();
                setStream(await obsStreamStatus().catch(() => stream));
                return onAir ? "OBS stopped streaming." : "OBS is going live — the picture lands here in a few seconds.";
              })
            }
            className={cn(BUTTON, "shrink-0", onAir ? "bg-white/[0.07] text-foreground hover:bg-white/[0.11]" : "bg-white text-[#0b0708]")}
          >
            {onAir ? <Stop size={11} weight="fill" /> : <Broadcast size={13} />}
            {onAir ? "Stop in OBS" : "Start in OBS"}
          </button>
        </div>
      )}

      {(done || error) && (
        <p role={error ? "alert" : "status"} className={cn("mt-2 text-[12px] leading-snug", error ? "text-chili-hi" : "text-success")}>
          {error ?? done}
        </p>
      )}
    </div>
  );
}
