import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { hasVividAccess } from "@/lib/vivid/entitlement"
import { SiraError, createSiraSession, siraConfigured } from "@/lib/vivid/sira"
import { buildVividVoiceInstructions, vividVoiceTools } from "@/lib/vivid/voice-instructions"

export const runtime = "nodejs"

const MAX_FIELD = 200

/**
 * Session gate for the Sira voice engine.
 *
 * Sira authenticates callers with one shared API key, which must never reach
 * the browser. So the browser asks here: this route checks the caller is
 * signed in and has paid for Vivid, mints a session with the key — sending
 * Vivid's persona and tool list along — and hands back what the browser needs
 * to open the stream: a per-session token that is single-use and expires in a
 * minute, plus the audio formats and the session's own clock. There is no
 * locked preview: unsubscribed users get a 402 and the paywall.
 *
 * The voice is fixed server-side (DEFAULT_SIRA_VOICE): the vendor's voice
 * names would otherwise have to live in the browser.
 */
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  }

  let stage = "entitlement"
  try {
    const entitled = await hasVividAccess(userId)
    if (!entitled) {
      return NextResponse.json(
        { error: "Vivid access required", code: "vivid_locked" },
        { status: 402 },
      )
    }

    stage = "config"
    if (!siraConfigured()) {
      return NextResponse.json(
        { error: "sira_unconfigured", stage, detail: "SIRA_API_KEY is not set" },
        { status: 503 },
      )
    }

    stage = "mint"
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const str = (v: unknown) => (typeof v === "string" && v.length <= MAX_FIELD ? v : undefined)
    const session = await createSiraSession({
      instructions: buildVividVoiceInstructions({
        pathname: str(body?.pathname),
        userName: str(body?.userName),
        userLastName: str(body?.userLastName),
      }),
      tools: vividVoiceTools(),
    })
    console.info(`[vivid/sira-session] minted ${session.id} for ${userId} on ${session.model}`)
    // Only what the browser needs to open the stream. Sira's reply also names
    // the provider, model and voice, and none of that may reach the browser.
    return NextResponse.json(
      {
        id: session.id,
        stream_url: session.stream_url,
        token: session.token,
        connect_within_seconds: session.connect_within_seconds,
        max_session_seconds: session.max_session_seconds,
        input_audio: session.input_audio,
        output_audio: session.output_audio,
      },
      { status: 201 },
    )
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error(`[vivid/sira-session] ${stage} failed for ${userId}:`, err)
    // Sira's own status codes (a bad key is a 401 from Sira) must not be
    // mistaken for "you are signed out" by the browser — collapse them to 502.
    const status = err instanceof SiraError && err.status === 503 ? 503 : 502
    return NextResponse.json({ error: "session_mint_failed", stage, detail }, { status })
  }
}
