"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/** The admin pages, one row of tabs. */
export function AdminTabs({ current }: { current: "reports" | "appeals" | "transparency" | "campaigns" }) {
  return (
    <nav aria-label="Admin" className="mb-6 flex w-fit max-w-full overflow-x-auto rounded-full bg-tint/[0.05] p-1 [scrollbar-width:none]">
      {(
        [
          { id: "reports", label: "Reports", href: "/admin/reports" },
          { id: "appeals", label: "Appeals", href: "/admin/appeals" },
          { id: "transparency", label: "Transparency", href: "/admin/transparency" },
          { id: "campaigns", label: "Campaigns", href: "/admin/campaigns" },
        ] as const
      ).map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={current === t.id ? "page" : undefined}
          className={cn(
            "press flex h-9 shrink-0 items-center rounded-full px-4 text-[13px] font-semibold transition-colors",
            current === t.id ? "bg-inverse text-on-inverse" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
