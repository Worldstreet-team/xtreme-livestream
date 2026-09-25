"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ShieldStar, Warning } from "@/components/icons";
import { Empty } from "@/components/app/empty";
import { ReportCard, type ReportRow } from "@/components/app/admin/report-card";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * The report queue (safety kit): every report on its 48-hour clock — the
 * window Nigeria's NITDA code of practice gives a platform to act — with
 * the nearest deadline on top. Taking content down ends a live stream and
 * closes its room, or deletes a chat line; either way every open report on
 * the same thing resolves with it. Platform admins only (ADMIN_USERNAMES).
 */

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

export default function ReportQueuePage() {
  const { user, isLoading } = useAuth();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { admin: boolean } }>("/api/admin/me")
      .then((r) => !cancelled && setAdmin(r.data.admin))
      .catch(() => !cancelled && setAdmin(false));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ success: boolean; data: { reports: ReportRow[] } }>(`/api/admin/reports?status=${tab}`);
      setRows(r.data.reports);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The queue didn't load");
    }
  }, [tab]);

  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) void load();
    };
    run();
    // New reports arrive while the page is open.
    const t = setInterval(run, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [admin, load]);

  if (isLoading || (user && admin === null)) {
    return (
      <Shell>
        <div className="h-[60vh] animate-pulse rounded-panel bg-surface" />
      </Shell>
    );
  }

  if (!user || !admin) {
    return (
      <Empty
        className="min-h-screen"
        icon={<ShieldStar size={36} />}
        title="Admins only"
        body="The report queue is for the platform's trust and safety team."
        goLive={false}
        action={{ label: "Back home", href: "/" }}
      />
    );
  }

  const open = (rows ?? []).filter((r) => r.status === "open");
  const overdue = open.filter((r) => new Date(r.dueAt).getTime() < now).length;

  return (
    <Shell>
      <header className="mb-6 md:mb-8">
        <p className={EYEBROW}>Trust &amp; safety</p>
        <h1 className="mt-2 font-wide text-[clamp(2rem,4.2vw,3.4rem)] leading-[0.98] font-bold tracking-[-0.04em] text-balance">
          Report queue
        </h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
          Every report on its 48-hour clock, nearest deadline first. Taking something down ends a live stream or deletes a chat
          line — and closes every report on it.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Reports" className="flex rounded-full bg-white/[0.05] p-1">
          {(["open", "closed"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setRows(null);
              }}
              className={cn(
                "press h-9 rounded-full px-4 text-[13px] font-semibold transition-colors",
                tab === t ? "bg-white text-[#0b0708]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "open" ? "Open" : "Closed"}
            </button>
          ))}
        </div>
        {tab === "open" && rows && (
          <p className="flex items-center gap-3 text-[13px] text-muted-foreground">
            <span className="tabular-nums">{open.length} open</span>
            {overdue > 0 && (
              <span className="flex items-center gap-1.5 font-semibold text-chili-hi">
                <Warning size={14} weight="fill" />
                {overdue} overdue
              </span>
            )}
          </p>
        )}
      </div>

      {error && <p className="mb-4 rounded-[12px] bg-chili/[0.12] px-4 py-3 text-[13px] text-chili-hi">{error}</p>}

      {rows === null ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-panel bg-surface" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-panel bg-surface">
          <Empty
            icon={<Check size={32} />}
            title={tab === "open" ? "Nothing waiting" : "Nothing closed yet"}
            body={tab === "open" ? "Every report has been dealt with." : "Resolved reports show up here."}
            goLive={false}
          />
        </div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <ReportCard key={r.id} row={r} now={now} onResolved={() => void load()} />
          ))}
        </ul>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <div className="mx-auto max-w-[980px]">{children}</div>
    </div>
  );
}
