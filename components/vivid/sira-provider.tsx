"use client"

/**
 * SiraVividProvider — drives the Vivid voice orb via Sira, the Gemini Live
 * service. Vivid's only voice engine.
 *
 * The wire protocol, learned from Sira's own client since its OpenAPI spec
 * stops at the REST layer:
 *
 *   1. POST /api/vivid/sira-session (ours) → a session: stream_url, a
 *      single-use token, audio formats and the session's own clock. The route
 *      sends Vivid's persona and tool list to Sira with the mint.
 *   2. Open the stream. The FIRST message must be {type:"auth", token}; a
 *      token in the query string is refused with 1008.
 *   3. Send mic audio as binary 16-bit PCM frames (16 kHz mono, 20 ms each)
 *      and typed input as {type:"text", text}.
 *   4. Receive JSON events: ready, content (Gemini Live's own shape — audio
 *      parts as base64 PCM at 24 kHz, transcriptions, interrupted,
 *      turnComplete), tool, tool_call, notice, error, and usage (token counts
 *      per turn).
 *
 * Tool bridge: a `tool_call` {id, name, args} runs the matching
 * lib/vivid-functions tool — server-context ones through /api/vivid/function,
 * the rest right here in the browser — and the result goes back as
 * {type:"tool_result", id, result}. Vision is not offered on this engine, so
 * the orb hides the camera control.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { VividAgentState } from "@/lib/vivid/types"
import type { VoiceFunctionConfig } from "@/lib/vivid/types"

export interface VividUserLite {
  id: string
  firstName?: string
  lastName?: string
  email?: string
}

export interface SiraVividContextValue {
  state: VividAgentState
  isConnected: boolean
  startSession: () => Promise<void>
  endSession: () => void
  /** Frequency bins of what Vivid is saying, for the orb's animation. */
  getAudioLevels: () => Uint8Array
}

const WORKLET_URL = "/vivid/sira-capture.worklet.js"

// Playback is scheduled slightly ahead so back-to-back chunks join without a
// click; a chunk that arrives late just starts at "now + lead".
const PLAYBACK_LEAD_S = 0.035
// If the socket backs up past this the link can't carry live audio; hanging on
// only makes the conversation drift further behind, so end it with a reason.
const MAX_BUFFERED_BYTES = 128_000
// Local speech detection for the orb's Listening state (Sira itself does the
// real turn-taking): a frame this far above the noise floor counts as speech,
// and the state drops back to Ready after a short quiet spell.
const SPEECH_DB_ABOVE_NOISE = 12
const SPEECH_DB_FLOOR = -45
const SPEECH_HOLD_MS = 700

// What our mint route hands back: the vendor's own fields never reach here.
interface SiraSession {
  id: string
  stream_url: string
  token: string
  max_session_seconds: number
  output_audio?: { sample_rate?: number }
}

type SiraEvent =
  | { type: "ready" }
  | { type: "content"; content: GeminiContent }
  | { type: "tool"; name?: string; state?: string }
  | { type: "tool_call"; id?: string; name?: string; args?: Record<string, unknown> }
  | { type: "notice"; message?: string }
  | { type: "error"; message?: string }
  | { type: "usage"; usage?: Record<string, unknown> }

interface GeminiContent {
  interrupted?: boolean
  turnComplete?: boolean
  generationComplete?: boolean
  waitingForInput?: boolean
  inputTranscription?: { text?: string }
  outputTranscription?: { text?: string }
  modelTurn?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] }
}

const SiraVividContext = createContext<SiraVividContextValue | null>(null)

export function useSiraVivid(): SiraVividContextValue | null {
  return useContext(SiraVividContext)
}

interface ProviderProps {
  children: ReactNode
  user: VividUserLite | null
  isSignedIn: boolean
  requireAuth?: boolean
  onAuthRequired?: () => void
  /** Route the user is on when they tap the orb; sent with the mint for the persona. */
  pathname?: string
  /** The tools Vivid may call. Their definitions go to Sira via the mint route. */
  functions?: VoiceFunctionConfig[]
  /** Sira reports the model's token usage per turn; the browser is the only one who sees it. */
  onUsage?: (info: { sessionId: string; usage: Record<string, unknown> }) => void
}

type MintRequest = {
  pathname?: string
  userName?: string
  userLastName?: string
}

/**
 * Runs one tool call exactly as the chat surface's tools expect: server-context
 * tools go to /api/vivid/function (where the secrets are), the rest run here.
 * Never throws — the model needs an answer either way.
 */
async function runTool(
  functions: VoiceFunctionConfig[],
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    const fn = functions.find((f) => f.name === name)
    if (!fn) return { error: `Unknown function: ${name}` }
    if (fn.executionContext === "server") {
      const res = await fetch("/api/vivid/function", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, args }),
      })
      const json = await res.json()
      return json?.success ? json.result : { error: json?.error ?? "Function failed" }
    }
    return await (fn.handler as (a: Record<string, unknown>) => Promise<unknown>)(args)
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Tool execution failed" }
  }
}

class SessionError extends Error {
  constructor(
    message: string,
    readonly code: "unauthenticated" | "locked" | "unavailable",
  ) {
    super(message)
  }
}

async function mintSession(req: MintRequest): Promise<SiraSession> {
  const res = await fetch("/api/vivid/sira-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (res.status === 401) throw new SessionError("Not signed in", "unauthenticated")
  if (res.status === 402) throw new SessionError("Vivid access required", "locked")
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { stage?: string; detail?: string } | null
    const why = body?.detail ? ` (${body.stage ?? "server"}: ${body.detail})` : ""
    throw new SessionError(`sira-session failed: ${res.status}${why}`, "unavailable")
  }
  return (await res.json()) as SiraSession
}

// Stops every scheduled chunk. Lives outside React so the hooks linter can see
// it touches audio nodes, not component state.
function stopAll(sources: Set<AudioBufferSourceNode>) {
  for (const source of sources) {
    source.onended = null
    try {
      source.stop()
    } catch {
      // already stopped
    }
  }
  sources.clear()
}

function pcm16ToAudioBuffer(ctx: AudioContext, b64: string, rate: number): AudioBuffer | null {
  const bin = atob(b64)
  const samples = Math.floor(bin.length / 2)
  if (!samples) return null
  const buffer = ctx.createBuffer(1, samples, rate)
  const floats = buffer.getChannelData(0)
  for (let i = 0; i < samples; i++) {
    const lo = bin.charCodeAt(i * 2)
    const hi = bin.charCodeAt(i * 2 + 1)
    let v = (hi << 8) | lo
    if (v >= 0x8000) v -= 0x10000
    floats[i] = v / 32768
  }
  return buffer
}

export function SiraVividProvider({
  children,
  user,
  isSignedIn,
  requireAuth = false,
  onAuthRequired,
  pathname,
  functions = [],
  onUsage,
}: ProviderProps) {
  const [state, setState] = useState<VividAgentState>("idle")
  const [isConnected, setIsConnected] = useState(false)

  // Everything that belongs to one live session. Torn down as a unit so a
  // stale socket from an earlier attempt can never drive the orb.
  const runRef = useRef(0)
  const socketRef = useRef<WebSocket | null>(null)
  const sessionRef = useRef<SiraSession | null>(null)
  const micRef = useRef<MediaStream | null>(null)
  const inputCtxRef = useRef<AudioContext | null>(null)
  const outputCtxRef = useRef<AudioContext | null>(null)
  const captureRef = useRef<AudioWorkletNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const freqRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(0))
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const nextAtRef = useRef(0)
  const turnDoneRef = useRef(true)
  const readyRef = useRef(false)
  const noiseDbRef = useRef(-60)
  const speechUntilRef = useRef(0)
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onUsageRef = useRef(onUsage)
  useEffect(() => {
    onUsageRef.current = onUsage
  }, [onUsage])
  // Read at mint and at each tool call, not captured, so a session started on
  // one page still sees the current tool list and the page it began on.
  const functionsRef = useRef(functions)
  const mintRef = useRef<MintRequest>({})
  useEffect(() => {
    functionsRef.current = functions
    mintRef.current = { pathname, userName: user?.firstName, userLastName: user?.lastName }
  })

  const quietState = useCallback(() => {
    // No audio playing and the turn is over: the orb goes back to Ready, which
    // is also what arms the orb's own idle timer.
    if (sourcesRef.current.size === 0 && turnDoneRef.current) setState("ready")
  }, [])

  const clearAudio = useCallback(() => {
    stopAll(sourcesRef.current)
    nextAtRef.current = 0
  }, [])

  const teardown = useCallback(
    (next: VividAgentState) => {
      runRef.current++
      readyRef.current = false
      if (capTimerRef.current) {
        clearTimeout(capTimerRef.current)
        capTimerRef.current = null
      }
      const socket = socketRef.current
      socketRef.current = null
      if (socket) {
        socket.onclose = null
        socket.onmessage = null
        socket.onerror = null
        try {
          socket.close()
        } catch {
          // already closed
        }
      }
      clearAudio()
      const capture = captureRef.current
      captureRef.current = null
      if (capture) {
        capture.port.onmessage = null
        capture.disconnect()
      }
      micRef.current?.getTracks().forEach((t) => t.stop())
      micRef.current = null
      inputCtxRef.current?.close().catch(() => {})
      inputCtxRef.current = null
      outputCtxRef.current?.close().catch(() => {})
      outputCtxRef.current = null
      analyserRef.current = null
      freqRef.current = new Uint8Array(0)

      const session = sessionRef.current
      sessionRef.current = null
      if (session) {
        // Best effort, and never awaited: the tab may be closing.
        void fetch(`/api/vivid/sira-session/${encodeURIComponent(session.id)}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {})
      }
      setIsConnected(false)
      setState(next)
    },
    [clearAudio],
  )

  const playChunk = useCallback(
    (b64: string, mime: string | undefined) => {
      const output = outputCtxRef.current
      if (!output || !readyRef.current) return
      const rate = Number(mime?.match(/rate=(\d+)/)?.[1]) || sessionRef.current?.output_audio?.sample_rate || 24000
      const buffer = pcm16ToAudioBuffer(output, b64, rate)
      if (!buffer) return
      const source = output.createBufferSource()
      source.buffer = buffer
      const analyser = analyserRef.current
      if (analyser) source.connect(analyser)
      else source.connect(output.destination)
      const at = Math.max(output.currentTime + PLAYBACK_LEAD_S, nextAtRef.current)
      nextAtRef.current = at + buffer.duration
      sourcesRef.current.add(source)
      source.onended = () => {
        sourcesRef.current.delete(source)
        quietState()
      }
      source.start(at)
      setState("speaking")
    },
    [quietState],
  )

  const handleContent = useCallback(
    (c: GeminiContent) => {
      // An interruption must flush every scheduled chunk before the new turn's
      // audio is queued, or the old reply keeps talking over the new one.
      if (c.interrupted) {
        clearAudio()
        turnDoneRef.current = true
        setState("listening")
        return
      }
      if (c.inputTranscription?.text) setState("listening")
      if (c.outputTranscription?.text) turnDoneRef.current = false
      for (const part of c.modelTurn?.parts ?? []) {
        const data = part.inlineData
        if (data?.data && data.mimeType?.startsWith("audio/pcm")) {
          turnDoneRef.current = false
          playChunk(data.data, data.mimeType)
        }
      }
      if (c.turnComplete) {
        turnDoneRef.current = true
        quietState()
      }
      if (c.waitingForInput) quietState()
    },
    [clearAudio, playChunk, quietState],
  )

  const startSession = useCallback(async () => {
    if (socketRef.current) return
    if (requireAuth && !isSignedIn) {
      onAuthRequired?.()
      return
    }
    const run = ++runRef.current
    const live = () => run === runRef.current
    setState("connecting")
    try {
      const session = await mintSession(mintRef.current)
      if (!live()) return
      sessionRef.current = session

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
      if (!live()) {
        mic.getTracks().forEach((t) => t.stop())
        return
      }
      micRef.current = mic

      // 16 kHz is a request, not a guarantee — the worklet resamples if the
      // browser opened the context at another rate.
      const input = new AudioContext({ sampleRate: 16000 })
      const output = new AudioContext({ sampleRate: 24000 })
      inputCtxRef.current = input
      outputCtxRef.current = output
      await Promise.all([input.resume(), output.resume()])
      await input.audioWorklet.addModule(WORKLET_URL)
      if (!live()) return

      const analyser = output.createAnalyser()
      analyser.fftSize = 256
      analyser.connect(output.destination)
      analyserRef.current = analyser

      const micSource = input.createMediaStreamSource(mic)
      const capture = new AudioWorkletNode(input, "sira-capture")
      // Keep the graph pulling frames without monitoring the mic aloud.
      const sink = input.createGain()
      sink.gain.value = 0
      micSource.connect(capture)
      capture.connect(sink)
      sink.connect(input.destination)
      captureRef.current = capture

      turnDoneRef.current = true
      noiseDbRef.current = -60
      speechUntilRef.current = 0

      const socket = new WebSocket(session.stream_url)
      socketRef.current = socket

      capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (!live() || !readyRef.current || socket.readyState !== WebSocket.OPEN) return
        const pcm = new Int16Array(e.data)
        let sum = 0
        for (const s of pcm) sum += (s / 32768) ** 2
        const db = 20 * Math.log10(Math.sqrt(sum / pcm.length) + 1e-9)
        const playing = sourcesRef.current.size > 0
        if (!playing) {
          if (db > Math.max(SPEECH_DB_FLOOR, noiseDbRef.current + SPEECH_DB_ABOVE_NOISE)) {
            speechUntilRef.current = performance.now() + SPEECH_HOLD_MS
            setState("listening")
          } else {
            noiseDbRef.current = 0.99 * noiseDbRef.current + 0.01 * db
            if (speechUntilRef.current && performance.now() > speechUntilRef.current) {
              speechUntilRef.current = 0
              quietState()
            }
          }
        }
        if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
          console.warn("[vivid] sira: connection too slow for live audio")
          teardown("error")
          return
        }
        socket.send(e.data)
      }

      socket.onopen = () => {
        if (!live()) return
        socket.send(JSON.stringify({ type: "auth", token: session.token }))
      }
      socket.onmessage = (e) => {
        if (!live()) return
        let event: SiraEvent
        try {
          event = JSON.parse(String(e.data)) as SiraEvent
        } catch {
          console.warn("[vivid] sira: unreadable event")
          return
        }
        switch (event.type) {
          case "ready":
            readyRef.current = true
            setIsConnected(true)
            setState("ready")
            if (session.max_session_seconds > 0) {
              capTimerRef.current = setTimeout(
                () => teardown("idle"),
                session.max_session_seconds * 1000,
              )
            }
            break
          case "content":
            handleContent(event.content ?? {})
            break
          case "usage":
            if (event.usage) {
              onUsageRef.current?.({ sessionId: session.id, usage: event.usage })
            }
            break
          case "tool":
            setState("processing")
            if (event.state === "done") quietState()
            break
          case "tool_call": {
            if (!event.id || !event.name) break
            const { id, name } = event
            setState("processing")
            void runTool(functionsRef.current, name, event.args ?? {}).then((result) => {
              if (!live() || socket.readyState !== WebSocket.OPEN) return
              socket.send(JSON.stringify({ type: "tool_result", id, result }))
            })
            break
          }
          case "notice":
            if (event.message) console.info("[vivid] sira:", event.message)
            break
          case "error":
            console.error("[vivid] sira:", event.message)
            teardown("error")
            break
        }
      }
      socket.onerror = () => {
        if (!live()) return
        console.error("[vivid] sira: socket error")
        teardown("error")
      }
      socket.onclose = (e) => {
        if (!live()) return
        if (e.code !== 1000 && e.code !== 1005) console.warn(`[vivid] sira: closed ${e.code} ${e.reason}`)
        teardown("idle")
      }
    } catch (e) {
      if (!live()) return
      const code = e instanceof SessionError ? e.code : null
      if (code === "unauthenticated") {
        teardown("idle")
        onAuthRequired?.()
        return
      }
      if (code === "locked") {
        console.warn("[vivid] sira session refused: Vivid not unlocked")
        teardown("idle")
        window.dispatchEvent(new CustomEvent("vivid:unlock-required"))
        window.location.assign("https://worldstreetgold.com/vivid")
        return
      }
      console.error("[vivid] sira connect failed:", e)
      teardown("error")
    }
  }, [requireAuth, isSignedIn, onAuthRequired, handleContent, quietState, teardown])

  const endSession = useCallback(() => teardown("idle"), [teardown])

  // The mic must not outlive the tab.
  useEffect(() => {
    const onHide = () => {
      if (socketRef.current) teardown("idle")
    }
    window.addEventListener("pagehide", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      if (socketRef.current) teardown("idle")
    }
  }, [teardown])

  const getAudioLevels = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return freqRef.current
    if (freqRef.current.length !== analyser.frequencyBinCount) {
      freqRef.current = new Uint8Array(analyser.frequencyBinCount)
    }
    analyser.getByteFrequencyData(freqRef.current)
    return freqRef.current
  }, [])

  const ctxValue = useMemo<SiraVividContextValue>(
    () => ({ state, isConnected, startSession, endSession, getAudioLevels }),
    [state, isConnected, startSession, endSession, getAudioLevels],
  )

  return <SiraVividContext.Provider value={ctxValue}>{children}</SiraVividContext.Provider>
}
