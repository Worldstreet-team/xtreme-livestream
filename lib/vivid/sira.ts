import "server-only"

/**
 * Sira — the Gemini Live voice service at sira.vividintelligence.tech.
 *
 * Sira is a thin session broker: one REST call mints a session, the browser
 * then opens the session's WebSocket directly and streams PCM both ways. Only
 * this module knows the API key; the browser only ever sees the per-session
 * token the mint returns, which is single-use and expires in a minute.
 *
 * Provider is fixed to Gemini. The mint carries Vivid's persona and tool list
 * (see lib/vivid/voice-instructions.ts); tool calls arrive on the session's
 * WebSocket as `tool_call` events and the browser answers with `tool_result`.
 */

const DEFAULT_API_URL = "https://sira.vividintelligence.tech"

export const SIRA_VOICES = ["Kore", "Aoede", "Puck", "Charon", "Fenrir"] as const
export type SiraVoice = (typeof SIRA_VOICES)[number]
export const DEFAULT_SIRA_VOICE: SiraVoice = "Kore"

export interface SiraAudioFormat {
  encoding: string
  sample_rate: number
  channels: number
}

/** What Sira returns from POST /v1/voice/sessions — handed to the browser as-is. */
export interface SiraSession {
  id: string
  provider: "gemini"
  model: string
  voice: string
  stream_url: string
  token: string
  connect_within_seconds: number
  max_session_seconds: number
  input_audio: SiraAudioFormat
  output_audio: SiraAudioFormat
}

export class SiraError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "SiraError"
  }
}

function apiUrl(): string {
  return (process.env.SIRA_API_URL || DEFAULT_API_URL).replace(/\/+$/, "")
}

export function siraConfigured(): boolean {
  return Boolean(process.env.SIRA_API_KEY)
}

function headers(): HeadersInit {
  const key = process.env.SIRA_API_KEY
  if (!key) throw new SiraError("SIRA_API_KEY is not set", 503)
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
}

export function isSiraVoice(v: unknown): v is SiraVoice {
  return typeof v === "string" && (SIRA_VOICES as readonly string[]).includes(v)
}

export interface CreateSiraSessionInput {
  voice?: string
  /** Vivid's persona for this session. */
  instructions?: string
  /** OpenAI-style function definitions; calls come back as `tool_call` events. */
  tools?: unknown[]
}

/**
 * Mint a session. Throws SiraError with Sira's status on refusal.
 *
 * The persona and tools are sent with the mint. A Sira that does not accept
 * those fields yet answers 400/422 to the request as a whole, so the mint is
 * retried bare: voice keeps working, Vivid just has no tools on that call. The
 * warning in the log is the tell that Sira's side is not there yet.
 */
export async function createSiraSession(input: CreateSiraSessionInput = {}): Promise<SiraSession> {
  const base = { provider: "gemini", voice: isSiraVoice(input.voice) ? input.voice : DEFAULT_SIRA_VOICE }
  const extras = {
    ...(input.instructions ? { instructions: input.instructions } : {}),
    ...(input.tools?.length ? { tools: input.tools } : {}),
  }
  const mint = (payload: Record<string, unknown>) =>
    fetch(`${apiUrl()}/v1/voice/sessions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
      cache: "no-store",
    })

  let res = await mint({ ...base, ...extras })
  if ((res.status === 400 || res.status === 422) && Object.keys(extras).length) {
    console.warn(`[vivid/sira] mint refused with instructions/tools (${res.status}); retrying without`)
    res = await mint(base)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new SiraError(`Sira refused to mint a session (${res.status}): ${body.slice(0, 300)}`, res.status)
  }
  const session = (await res.json()) as SiraSession
  if (!session?.id || !session.stream_url || !session.token) {
    throw new SiraError("Sira returned a session without id, stream_url or token", 502)
  }
  return session
}

/** End a session. Sira answers 204; a 404 means it already ended, which is fine. */
export async function deleteSiraSession(id: string): Promise<void> {
  const res = await fetch(`${apiUrl()}/v1/voice/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(),
    cache: "no-store",
  })
  if (!res.ok && res.status !== 404) {
    throw new SiraError(`Sira refused to end session ${id} (${res.status})`, res.status)
  }
}
