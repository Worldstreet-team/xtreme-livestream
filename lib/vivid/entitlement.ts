import "server-only"
import mongoose from "mongoose"

/**
 * Vivid is a paid feature ($100/month), bought and billed in the Worldstreet
 * web app. The source of truth is the `vividentitlements` collection in the
 * web app's MongoDB database ("user-account"). This is a read-only mirror of
 * the web app's check (lib/vivid/entitlement.ts there), so the paywall can't
 * be bypassed by coming in through Xtreme.
 *
 * Deliberately skipped for v1: the web app's "heal from ledger" step, which
 * rebuilds a missing/lapsed row from the Dollar Account ledger. A user whose
 * row lapsed but whose ledger says they paid gets access here only after
 * opening Vivid on the web once, which heals the row. Acceptable for now.
 *
 * Connection: VIVID_MONGODB_URI (the web app's MONGODB_URI). Xtreme's own
 * database is "xtreme-livestream" on MONGODB_URI, so this opens a separate
 * connection pinned to the web app's database name. If VIVID_MONGODB_URI is
 * unset, MONGODB_URI is tried — correct only when both apps share a cluster.
 */

const WEB_APP_DB_NAME = "user-account"

interface VividDbCache {
  conn: mongoose.Connection | null
  promise: Promise<mongoose.Connection> | null
}

declare global {
  var vividDbCache: VividDbCache | undefined
}

const cached: VividDbCache = global.vividDbCache ?? { conn: null, promise: null }
global.vividDbCache = cached

async function vividDb(): Promise<mongoose.Connection> {
  if (cached.conn && cached.conn.readyState === 1) return cached.conn
  if (cached.conn && cached.conn.readyState !== 1) {
    cached.conn = null
    cached.promise = null
  }
  if (!cached.promise) {
    const uri = process.env.VIVID_MONGODB_URI || process.env.MONGODB_URI
    if (!uri) throw new Error("VIVID_MONGODB_URI (or MONGODB_URI) is not set")
    cached.promise = mongoose
      .createConnection(uri, {
        dbName: WEB_APP_DB_NAME,
        bufferCommands: false,
        serverSelectionTimeoutMS: 15_000,
        maxPoolSize: 5,
      })
      .asPromise()
  }
  cached.conn = await cached.promise
  return cached.conn
}

// Field names confirmed against the web repo's models/VividEntitlement.ts.
interface EntitlementRow {
  userId: string
  plan?: "monthly" | "lifetime" | null
  status?: "active" | "past_due" | "canceled" | "expired"
  currentPeriodEnd?: Date | string | null
  graceUntil?: Date | string | null
}

/**
 * Same rule as the web app's rowGrantsAccess: rows that are not explicitly
 * `monthly` are lifetime (grandfathered buyers and admin comps — some predate
 * the `plan` field) and always grant. A monthly row grants until the later of
 * currentPeriodEnd and graceUntil, whatever its status says.
 */
function rowGrantsAccess(row: EntitlementRow, now: number): boolean {
  if (row.plan !== "monthly") return true
  const period = row.currentPeriodEnd ? new Date(row.currentPeriodEnd).getTime() : null
  const grace = row.graceUntil ? new Date(row.graceUntil).getTime() : null
  if (period === null && grace === null) return false
  return Math.max(period ?? 0, grace ?? 0) > now
}

export async function hasVividAccess(userId: string): Promise<boolean> {
  if (!userId) return false
  const conn = await vividDb()
  const row = (await conn.collection("vividentitlements").findOne({ userId })) as EntitlementRow | null
  if (!row) return false
  return rowGrantsAccess(row, Date.now())
}
