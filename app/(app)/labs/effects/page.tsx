"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { Pill } from "@/components/ui/pill";
import { startFaceAnchors } from "@/lib/face-anchors";
import { applyLook, getLookProcessor, isLooksSupported, stopLook } from "@/lib/looks";
import {
  LAB_STAGES,
  STAGE_MS,
  VERDICT_LABEL,
  WARMUP_MS,
  frameRates,
  resultsText,
  soakSummary,
  verdict,
  type Battery,
  type DeviceInfo,
  type LabStage,
  type SoakResult,
  type StageResult,
  type Verdict,
} from "@/lib/effects-lab";
import { cn } from "@/lib/utils";

/**
 * The effects test: this phone's camera through each effect for fifteen
 * seconds, measured by the frames the preview actually shows. It's how we
 * learn what Tecno, Infinix and itel phones can carry before building more
 * effects for them. Nothing is recorded or sent — the results are copied
 * by hand. (Live Effects Plan, Phase 0.)
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Nav = Navigator & {
  deviceMemory?: number;
  userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string; platformVersion?: string }> };
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
  wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
};

async function readDevice(): Promise<DeviceInfo> {
  const nav = navigator as Nav;
  let gpu: string | null = null;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    gpu = null;
  }
  // The phone's model: Chrome hides it in the user agent now, but hands it over when asked.
  let model = "";
  try {
    const hi = await nav.userAgentData?.getHighEntropyValues?.(["model", "platform", "platformVersion"]);
    if (hi) model = [hi.model, hi.platform && `${hi.platform} ${hi.platformVersion ?? ""}`.trim()].filter(Boolean).join(" · ");
  } catch {
    model = "";
  }
  return {
    browser: [model, navigator.userAgent].filter(Boolean).join(" — "),
    cores: navigator.hardwareConcurrency || null,
    memoryGb: nav.deviceMemory ?? null,
    gpu,
    screen: `${screen.width}×${screen.height} at ${window.devicePixelRatio}x`,
  };
}

async function readBattery(): Promise<Battery | null> {
  try {
    const b = await (navigator as Nav).getBattery?.();
    return b ? { level: b.level, charging: b.charging } : null;
  } catch {
    return null;
  }
}

const VERDICT_TONE: Record<Verdict, string> = {
  smooth: "bg-emerald-500/15 text-emerald-300",
  usable: "bg-amber-500/15 text-amber-300",
  slow: "bg-chili/15 text-chili-hi",
  failed: "bg-white/[0.06] text-muted-foreground",
};

export default function EffectsLabPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<LocalVideoTrack | null>(null);
  const frames = useRef<number[] | null>(null);
  const cancelled = useRef(false);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [running, setRunning] = useState<null | { label: string; endsAt: number }>(null);
  const [results, setResults] = useState<StageResult[]>([]);
  const [soak, setSoak] = useState<SoakResult | null>(null);
  const [battery, setBattery] = useState<{ start: Battery | null; end: Battery | null }>({ start: null, end: null });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    void readDevice().then(setDevice);
    return () => {
      cancelled.current = true;
      trackRef.current?.stop();
    };
  }, []);

  // A countdown that redraws itself while a stage runs.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [running]);

  /** The camera, once, shown in the preview; every stage rides this one track. */
  async function camera(): Promise<LocalVideoTrack> {
    if (trackRef.current) return trackRef.current;
    const { createLocalVideoTrack } = await import("livekit-client");
    const track = await createLocalVideoTrack({ resolution: { width: 1280, height: 720, frameRate: 30 }, facingMode: "user" });
    trackRef.current = track;
    const video = videoRef.current!;
    track.attach(video);
    video.muted = true;
    await video.play().catch(() => {});
    // Every frame the preview shows, stamped — while a stage is counting.
    const onFrame = (now: number) => {
      frames.current?.push(now);
      video.requestVideoFrameCallback(onFrame);
    };
    if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(onFrame);
    return track;
  }

  /** One stage: put its effects on, let it warm up, count, take them off. */
  async function runStage(stage: LabStage, track: LocalVideoTrack, ms = STAGE_MS): Promise<StageResult> {
    const blank: StageResult = { id: stage.id, fps: 0, lowFps: 0, passMs: 0, faceMs: 0, faceHz: 0 };
    if (stage.look) {
      if (!isLooksSupported()) return { ...blank, error: "needs Chrome or Edge" };
      const r = await applyLook(track, stage.look);
      if (!r.ok) return { ...blank, error: r.reason };
    } else {
      await stopLook(track);
    }
    const face = stage.face ? startFaceAnchors({ track }) : null;
    const passes: number[] = [];
    const proc = getLookProcessor(track);
    if (proc) proc.onGraded = (msPass) => passes.push(msPass);
    setRunning({ label: stage.label, endsAt: Date.now() + ms });
    await sleep(WARMUP_MS);
    frames.current = [];
    passes.length = 0;
    await sleep(ms - WARMUP_MS);
    const times = frames.current ?? [];
    frames.current = null;
    if (proc) proc.onGraded = undefined;
    const faceStats = face ? { ...face.stats } : null;
    face?.stop();
    const { fps, lowFps } = frameRates(times);
    const passMs = passes.length ? Math.round((passes.reduce((a, b) => a + b, 0) / passes.length) * 10) / 10 : 0;
    if (face && faceStats?.state === "unavailable") return { ...blank, fps, lowFps, passMs, error: "the face model didn't load" };
    return {
      id: stage.id,
      fps,
      lowFps,
      passMs,
      faceMs: faceStats ? Math.round(faceStats.avgMs * 10) / 10 : 0,
      faceHz: faceStats ? Math.round(faceStats.hz * 10) / 10 : 0,
    };
  }

  /** Keep the screen on for the length of a test; fine if the phone says no. */
  async function keepAwake() {
    try {
      return (await (navigator as Nav).wakeLock?.request("screen")) ?? null;
    } catch {
      return null;
    }
  }

  async function runAll() {
    setError(null);
    setResults([]);
    setSoak(null);
    setCopied(false);
    const lock = await keepAwake();
    try {
      const start = await readBattery();
      const track = await camera();
      const out: StageResult[] = [];
      for (const stage of LAB_STAGES) {
        if (cancelled.current) return;
        out.push(await runStage(stage, track));
        setResults([...out]);
      }
      await stopLook(track);
      setBattery({ start, end: await readBattery() });
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "The camera wasn't allowed. Allow it in the browser's site settings and try again." : `The test stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(null);
      await lock?.release().catch(() => {});
    }
  }

  /** Everything on for a while, in ten-second slices: heat shows as a slide. */
  async function runSoak(minutes: number) {
    setError(null);
    setCopied(false);
    const lock = await keepAwake();
    try {
      const start = await readBattery();
      const track = await camera();
      const everything = LAB_STAGES.find((s) => s.id === "all")!;
      if (!isLooksSupported()) throw new Error("the effects need Chrome or Edge");
      const r = await applyLook(track, everything.look!);
      if (!r.ok) throw new Error(r.reason);
      const face = startFaceAnchors({ track });
      const slices: number[] = [];
      const endsAt = Date.now() + minutes * 60_000;
      setRunning({ label: `Soak, ${minutes} min`, endsAt });
      await sleep(WARMUP_MS);
      while (Date.now() < endsAt && !cancelled.current) {
        frames.current = [];
        await sleep(10_000);
        slices.push(frameRates(frames.current ?? []).fps);
        setSoak(soakSummary(slices, minutes));
      }
      frames.current = null;
      face.stop();
      await stopLook(track);
      setBattery({ start, end: await readBattery() });
    } catch (e) {
      setError(`The soak stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(null);
      await lock?.release().catch(() => {});
    }
  }

  async function copy() {
    if (!device) return;
    const text = resultsText(device, results, battery, soak);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Copying wasn't allowed here. Select the results below and copy them by hand.");
    }
  }

  const cameraFps = results.find((r) => r.id === "camera")?.fps ?? 30;
  const secondsLeft = running ? Math.max(0, Math.ceil((running.endsAt - Date.now()) / 1000)) : 0;
  const done = results.length === LAB_STAGES.length;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-6 pb-24 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="caps font-mono text-[11px] text-muted-foreground">Labs</p>
        <h1 className="font-wide text-[28px] font-bold tracking-[-0.03em]">Effects test</h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          Runs your camera through each effect for 15 seconds and measures how smoothly this phone keeps up. It takes about two minutes. Nothing is recorded or sent: copy the results to share them.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} playsInline muted className="size-full -scale-x-100 object-cover" />
          {running && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-3 py-2 text-[13px] text-white">
              <span className="font-semibold">{running.label}</span>
              <span className="font-mono tabular-nums">{secondsLeft}s</span>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-4 gap-y-2 text-[13px]">
          <dt className="text-muted-foreground">Phone</dt>
          <dd className="min-w-0 break-words">{device?.browser ?? "…"}</dd>
          <dt className="text-muted-foreground">CPU cores</dt>
          <dd>{device?.cores ?? "?"}</dd>
          <dt className="text-muted-foreground">Memory</dt>
          <dd>{device?.memoryGb != null ? `${device.memoryGb} GB` : "?"}</dd>
          <dt className="text-muted-foreground">GPU</dt>
          <dd className="min-w-0 break-words">{device?.gpu ?? "?"}</dd>
          <dt className="text-muted-foreground">Effects</dt>
          <dd>{device ? (isLooksSupported() ? "Supported in this browser" : "Not in this browser (Chrome or Edge only for now)") : "…"}</dd>
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Pill variant="primary" size="lg" disabled={Boolean(running)} onClick={() => void runAll()}>
          {results.length ? "Run again" : "Start the test"}
        </Pill>
        <Pill variant="glass" size="lg" disabled={Boolean(running) || !done} onClick={() => void runSoak(5)}>
          5-minute soak
        </Pill>
        <Pill variant="glass" size="lg" disabled={Boolean(running) || !done} onClick={() => void runSoak(10)}>
          10-minute soak
        </Pill>
      </div>
      <p className="-mt-5 text-[12.5px] text-muted-foreground">Keep this page open and the screen on. The soak runs everything at once to see whether the phone slows as it warms up.</p>

      {error && (
        <p role="alert" className="rounded-xl bg-chili/10 px-4 py-3 text-[14px] text-chili-hi">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-semibold">Results</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[14px]">
              <thead className="text-[11px] tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 pr-3 font-medium">Effect</th>
                  <th className="py-2 pr-3 font-medium">Frames/s</th>
                  <th className="py-2 pr-3 font-medium">Worst</th>
                  <th className="py-2 pr-3 font-medium">Cost</th>
                  <th className="py-2 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {results.map((r) => {
                  const stage = LAB_STAGES.find((s) => s.id === r.id)!;
                  const v = verdict(r, cameraFps);
                  const cost = [r.passMs ? `${r.passMs} ms a frame` : null, r.faceMs ? `face ${r.faceMs} ms, ${r.faceHz}/s` : null].filter(Boolean).join(" · ");
                  return (
                    <tr key={r.id} className="border-t border-hairline align-top">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{stage.label}</div>
                        <div className="text-[12px] text-muted-foreground">{r.error ? `Didn't run: ${r.error}` : stage.what}</div>
                      </td>
                      <td className="py-2.5 pr-3">{r.error ? "—" : r.fps}</td>
                      <td className="py-2.5 pr-3">{r.error ? "—" : r.lowFps}</td>
                      <td className="py-2.5 pr-3 text-[12.5px] text-muted-foreground">{cost || "—"}</td>
                      <td className="py-2.5">
                        <span className={cn("rounded-full px-2 py-1 text-[12px] font-semibold", VERDICT_TONE[v])}>{VERDICT_LABEL[v]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {soak && (
            <p className="text-[14px]">
              Soak: {soak.firstFps} frames/s at the start, {soak.lastFps} at the end, lowest {soak.minFps}
              {soak.slices.length ? ` (${soak.slices.length * 10}s so far)` : ""}.
            </p>
          )}
          {battery.start && battery.end && (
            <p className="text-[13px] text-muted-foreground">
              Battery {Math.round(battery.start.level * 100)}% → {Math.round(battery.end.level * 100)}%{battery.start.charging || battery.end.charging ? ", charging" : ""}.
            </p>
          )}
          {done && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Pill variant="glass" size="md" onClick={() => void copy()}>
                  Copy results
                </Pill>
                {copied && <span className="text-[13px] text-muted-foreground">Copied. Paste it wherever you&apos;re sharing.</span>}
              </div>
              {device && (
                <pre className="overflow-x-auto rounded-xl bg-white/[0.04] p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-muted-foreground select-all">
                  {resultsText(device, results, battery, soak)}
                </pre>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
