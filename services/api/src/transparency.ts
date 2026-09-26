import { REPORT_REASONS, type TransparencyReport } from "@xtreme/contracts";
import { Appeal, AuditLog, ChatMessage, Report, Stream } from "./models.js";

/**
 * The transparency report (Phase 3, deeper moderation): a calendar year of
 * trust & safety in numbers, from what's already kept — reports and how
 * they were resolved, appeals, and every moderation action in the audit
 * trail. NITDA's code of practice asks large platforms for one every
 * year; this is what the admins publish it from. "On time" is measured
 * against the 48 hours every report is given at intake — notices from an
 * authorised agency, which the Code gives 24 hours, aren't separated yet.
 */

const HOUR = 3_600_000;

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function transparencyReport(year: number): Promise<TransparencyReport> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const inYear = { createdAt: { $gte: from, $lt: to } };
  const acted = (action: string) => AuditLog.countDocuments({ ...inYear, action });

  const [reports, appeals, held, streams, chatLines, bans, timeouts, deletions, approved, denied, shields] = await Promise.all([
    Report.find(inYear).select("reason status streamId messageId dueAt resolvedAt createdAt").lean(),
    Appeal.find(inYear).select("status").lean(),
    ChatMessage.find({ ...inYear, heldReason: { $nin: ["", null] } }).select("heldReason").lean(),
    Stream.find({ startedAt: { $gte: from, $lt: to } }).select("streamerId").lean(),
    ChatMessage.countDocuments(inYear),
    acted("chat.ban"),
    acted("chat.timeout"),
    acted("chat.delete"),
    acted("chat.approve"),
    acted("chat.deny"),
    acted("chat.shield_on"),
  ]);

  const byReason = Object.fromEntries(REPORT_REASONS.map((r) => [r, 0])) as Record<string, number>;
  for (const r of reports) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  const resolved = reports.filter((r) => r.resolvedAt);
  const heldByReason: Record<string, number> = {};
  for (const m of held) heldByReason[m.heldReason] = (heldByReason[m.heldReason] ?? 0) + 1;

  return {
    year,
    from: from.toISOString(),
    to: to.toISOString(),
    scale: { streams: streams.length, creators: new Set(streams.map((s) => String(s.streamerId))).size, chatLines },
    reports: {
      total: reports.length,
      byReason,
      actioned: reports.filter((r) => r.status === "actioned").length,
      dismissed: reports.filter((r) => r.status === "dismissed" || r.status === "reviewed").length,
      open: reports.filter((r) => r.status === "open").length,
      onTime: resolved.filter((r) => new Date(r.resolvedAt!).getTime() <= new Date(r.dueAt).getTime()).length,
      medianHoursToResolve: (() => {
        const m = median(resolved.map((r) => (new Date(r.resolvedAt!).getTime() - new Date(r.createdAt).getTime()) / HOUR));
        return m === null ? null : Math.round(m * 10) / 10;
      })(),
    },
    // Several reports can close with one takedown: count what came down, not the reports.
    platform: {
      streamTakedowns: new Set(reports.filter((r) => r.status === "actioned" && !r.messageId).map((r) => String(r.streamId))).size,
      chatTakedowns: new Set(reports.filter((r) => r.status === "actioned" && r.messageId).map((r) => String(r.messageId))).size,
    },
    appeals: {
      received: appeals.length,
      reversed: appeals.filter((a) => a.status === "reversed").length,
      upheld: appeals.filter((a) => a.status === "upheld").length,
      open: appeals.filter((a) => a.status === "open").length,
    },
    rooms: { bans, timeouts, deletions, heldLines: held.length, heldApproved: approved, heldDenied: denied, shieldRaised: shields },
    heldByReason,
  };
}
