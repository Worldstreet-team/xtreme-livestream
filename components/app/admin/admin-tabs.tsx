"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/** The admin pages, one row of tabs. */
export function AdminTabs({ current }: { current: "reports" | "campaigns" }) {
  return (
    <nav aria-label="Admin" className="mb-6 flex w-fit rounded-full bg-white/[0.05] p-1">
      {(
        [
          { id: "reports", label: "Reports", href: "/admin/reports" },
          { id: "campaigns", label: "Campaigns", href: "/admin/campaigns" },
        ] as const
      ).map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={current === t.id ? "page" : undefined}
          className={cn(
            "press flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-colors",
            current === t.id ? "bg-white text-[#0b0708]" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
