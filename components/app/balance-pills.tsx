"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Money } from "@/components/xtream/money";

/**
 * Points and wallet as two pills — the numbers you'd otherwise dig for.
 * Points wear an Ember coin; the wallet is money, so it's gold. Used in the
 * phone drawer and on the rail's account card. `size` is the pill height.
 */
export function BalancePills({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  const [points, setPoints] = useState<number | null>(null);
  const [cents, setCents] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ success: boolean; data: { balance: number } }>(`/api/user/me/points`)
      .then((r) => !cancelled && setPoints(r.data.balance))
      .catch(() => {});
    apiFetch<{ success: boolean; data: { availableUsdMinor: number } }>(`/api/wallet/balance`)
      .then((r) => !cancelled && setCents(r.data.availableUsdMinor))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const pill = cn(
    "press flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-control font-mono font-semibold text-foreground tabular-nums transition-colors hover:bg-control-hover",
    size === "sm" ? "h-8 text-[12px]" : "h-10 text-[13.5px]",
  );
  return (
    <div className={cn("flex gap-2", className)}>
      <Link href="/rewards" className={pill} aria-label={points === null ? "Points" : `${points.toLocaleString()} points`}>
        <span aria-hidden className="size-3 shrink-0 rounded-full bg-ember" />
        <span className="truncate">{points === null ? "—" : size === "sm" ? points.toLocaleString() : `${points.toLocaleString()} pts`}</span>
      </Link>
      <Link href="/wallet" className={pill} aria-label="Wallet">
        {cents === null ? (
          <span className="font-sans text-muted-foreground">Wallet</span>
        ) : (
          <Money cents={cents} size="sm" className={size === "sm" ? "text-[14px]" : undefined} />
        )}
      </Link>
    </div>
  );
}
