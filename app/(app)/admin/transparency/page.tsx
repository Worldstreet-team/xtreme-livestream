"use client";

import { useEffect, useState } from "react";
import type { TransparencyReport } from "@xtreme/contracts";
import { ShieldStar } from "@/components/icons";
import { Empty } from "@/components/app/empty";
import { AdminTabs } from "@/components/app/admin/admin-tabs";
import { TransparencySections } from "@/components/app/admin/transparency-sections";
import { Pill } from "@/components/ui/pill";
import { apiFetch } from "@/lib/api-client";
import { useIsAdmin } from "@/lib/admin";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/**
 * The transparency report (Phase 3, deeper moderation): a calendar year of
 * trust & safety in numbers — reports and how fast they were handled, what
 * came down, what appeals decided, and what creators and their moderators
 * did in their rooms. NITDA's code of practice asks large platforms to
 * publish one every year; this is the page it's published from (print it,
 * or copy the figures). Admins only.
 */

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

export default function TransparencyPage() {
  const { user, isLoading } = useAuth();
  const admin = useIsAdmin();
  const thisYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(thisYear);
  const [report, setReport] = useState<{ year: number; data: TransparencyReport } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    apiFetch<{ success: boolean; data: { report: TransparencyReport } }>(`/api/admin/transparency?year=${year}`)
      .then((r) => {
        if (!alive) return;
        setReport({ year, data: r.data.report });
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "The report didn't load"));
    return () => {
      alive = false;
    };
  }, [admin, year]);

  if (isLoading || (user && admin === null)) {
    return (
      <Shell>
        <div className="h-[60vh] animate-pulse rounded-panel bg-surface" />
      </Shell>
    );
  }
  if (!user || !admin) {
    return <Empty className="min-h-screen" icon={<ShieldStar size={36} />} title="Admins only" body="The transparency report is for the platform's trust and safety team." goLive={false} action={{ label: "Back home", href: "/" }} />;
  }

  const r = report?.year === year ? report.data : null;

  return (
    <Shell>
      <div className="print:hidden">
        <AdminTabs current="transparency" />
      </div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
        <div>
          <p className={EYEBROW}>Trust &amp; safety · Xtream</p>
          <h1 className="mt-2 font-wide text-[clamp(2rem,4.2vw,3.4rem)] leading-[0.98] font-bold tracking-[-0.04em] text-balance">
            Transparency report {year}
          </h1>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
            What was reported and how fast it was handled, what came down, what appeals decided, and what creators and their moderators did in
            their rooms — 1 January to 31 December {year}, UTC.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <div role="radiogroup" aria-label="Year" className="flex rounded-full bg-white/[0.05] p-1">
            {[thisYear - 2, thisYear - 1, thisYear].map((y) => (
              <button
                key={y}
                type="button"
                role="radio"
                aria-checked={year === y}
                onClick={() => setYear(y)}
                className={cn("press h-9 rounded-full px-3.5 font-mono text-[12.5px] font-semibold", year === y ? "bg-white text-[#0b0708]" : "text-muted-foreground hover:text-foreground")}
              >
                {y}
              </button>
            ))}
          </div>
          <Pill variant="glass" onClick={() => window.print()} disabled={!r}>
            Print
          </Pill>
        </div>
      </header>

      {error && <p className="mb-4 rounded-[12px] bg-chili/[0.12] px-4 py-3 text-[13px] text-chili-hi">{error}</p>}
      {!r ? (
        !error && <div className="h-[50vh] animate-pulse rounded-panel bg-surface" />
      ) : (
        <TransparencySections report={r} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 pt-6 pb-24 md:px-8 md:pt-10 print:p-0">
      <div className="mx-auto max-w-[980px]">{children}</div>
    </div>
  );
}
