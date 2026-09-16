import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { deleteSiraSession, siraConfigured } from "@/lib/vivid/sira"

export const runtime = "nodejs"

const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/

/**
 * Ends a Sira session on the user's behalf when they hang up. Closing the
 * WebSocket already ends the conversation; this makes sure the session is
 * released on Sira's side too, so a dropped tab doesn't hold its slot for the
 * full twenty minutes. Best effort: the browser sends it with keepalive and
 * never waits on the answer.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return new NextResponse(null, { status: 401 })

  const { id } = await ctx.params
  if (!SESSION_ID.test(id)) return new NextResponse(null, { status: 400 })
  if (!siraConfigured()) return new NextResponse(null, { status: 204 })

  try {
    await deleteSiraSession(id)
  } catch (err) {
    console.warn(`[vivid/sira-session] end ${id} failed for ${userId}:`, err)
  }
  return new NextResponse(null, { status: 204 })
}
