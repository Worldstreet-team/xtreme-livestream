import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { hasVividAccess } from "@/lib/vivid/entitlement"
import { serverFunctions } from "@/lib/vivid-functions.server"

export const runtime = "nodejs"

/**
 * Runs Vivid's server-side tools. The browser's tool bridge
 * (components/vivid/sira-provider.tsx) posts { name, args } here for any tool
 * whose executionContext is "server"; the answer is { success, result | error },
 * which is exactly what the bridge hands back to the model.
 *
 * Locked (unpaid) users never get a session in the first place, so a call
 * landing here without entitlement is someone poking the endpoint — refuse.
 */
export async function POST(request: Request) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  if (!(await hasVividAccess(userId))) {
    return NextResponse.json({ success: false, error: "Vivid access required" }, { status: 402 })
  }

  const body = (await request.json().catch(() => null)) as
    | { name?: string; args?: Record<string, unknown> }
    | null
  const fn = serverFunctions.find((f) => f.name === body?.name)
  if (!fn) {
    return NextResponse.json({ success: false, error: `Unknown function: ${body?.name}` }, { status: 404 })
  }
  try {
    // Tools that call the Fastify API on the user's behalf need their Clerk
    // session JWT; it is minted here and never leaves the server.
    const token = (await getToken()) ?? null
    const result = await fn.handler({ ...(body?.args ?? {}), userId, token })
    return NextResponse.json({ success: true, result })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Function failed" },
      { status: 500 },
    )
  }
}
