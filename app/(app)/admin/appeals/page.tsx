"use client";

import { useEffect, useState } from "react";
import type { AppealView } from "@xtreme/contracts";
import { Empty } from "@/components/app/empty";
import { AdminTabs } from "@/components/app/admin/admin-tabs";
import { AppealCard } from "@/components/app/admin/appeal-card";
import { apiFetch } from "@/lib/api-client";
import { useIsAdmin } from "@/lib/admin";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/**
 * Appeals (Phase 3, deeper moderation): creators asking the platform to
 * look again at a stream it took down, oldest first. Reversing brings the
 * stream's page back; upholding keeps it down. Either way the creator is
 * told, with the note, and it's in the audit trail. Admins only.
 */

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

export default function AppealsPage() {
  const { user, isLoading } = useAuth();
  const admin = useIsAdmin();
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [rows, setRows] = useState<AppealView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    apiFetch<{ success: boolean; data: { appeals: AppealView[] } }>(`/api/admin/appeals?status=${tab}`)
      .then((r) => {
        if (!alive) return;
        setRows(r.data.appeals);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "The appeals didn't load"));
    return () => {
      alive = false;
    };
  }, [admin, tab]);

  if (isLoading || (user && admin === null)) {
    return (
      <Shell>
        <div className="h-[60vh] animate-pulse rounded-panel bg-surface" />
      </Shell>
    );
  }
  if (!user || !admin) {
    return <Empty className="min-h-screen" scene="locked" title="Admins only" body="Appeals are for the platform's trust and safety team." goLive={false} action={{ label: "Back home", href: "/" }} />;
  }

  return (
    <Shell>
      <AdminTabs current="appeals" />
      <header className="mb-6 md:mb-8">
        <p className={EYEBROW}>Trust &amp; safety</p>
        <h1 className="mt-2 font-wide text-[clamp(2rem,4.2vw,3.4rem)] leading-[0.98] font-bold tracking-[-0.04em] text-balance">Appeals</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
          Creators asking for another look at a takedown, oldest first. Reversing brings the stream&apos;s page back; either way they&apos;re told,
          with your note.
        </p>
      </header>
      <div role="tablist" aria-label="Appeals" className="mb-5 flex w-fit rounded-full bg-tint/[0.05] p-1">
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
              tab === t ? "bg-inverse text-on-inverse" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "open" ? "Waiting" : "Decided"}
          </button>
        ))}
      </div>
      {error && <p className="mb-4 rounded-[12px] bg-chili/[0.12] px-4 py-3 text-[13px] text-chili-hi">{error}</p>}
      {rows === null ? (
        !error && <div className="h-40 animate-pulse rounded-panel bg-surface" />
      ) : rows.length === 0 ? (
        <div className="rounded-panel bg-surface">
          <Empty scene="cleared" title={tab === "open" ? "No appeals waiting." : "Nothing decided yet."} goLive={false} />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((a) => (
            <AppealCard key={a.id} appeal={a} onDecided={(next) => setRows((cur) => (cur ?? []).map((x) => (x.id === next.id ? next : x)))} />
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
