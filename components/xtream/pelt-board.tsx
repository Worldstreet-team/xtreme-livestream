import Link from "next/link";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Money } from "@/components/xtream/money";

/**
 * A ranked board — Gold Floor's flow, in Afterglow's skin. Rank numerals in
 * the thin, wide money face; the amounts in gold; and at the top the one
 * place foil is allowed: the Wolf of WorldStreet's pelt, worn by whoever
 * leads the week. Use it for the Wolf race, a stream's top allies, a
 * battle's backers — any list where the number is the point.
 */
export interface PeltRow {
  name: string;
  avatar?: string | null;
  cents: number;
  href?: string;
}

export function PeltBoard({
  title,
  unit = "Backed",
  rows,
  crown = "Wears the pelt",
  className,
}: {
  title: string;
  /** Right-hand column heading. */
  unit?: string;
  rows: PeltRow[];
  /** The badge on the leader. Pass null for a board without a pelt. */
  crown?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full rounded-panel bg-surface px-4 pt-3.5 pb-1.5",
        "shadow-[inset_0_0_0_1px_rgba(245,199,110,0.22),0_24px_50px_-28px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      <p className="mb-1 flex justify-between gap-3">
        <span className="caps text-[9.5px] font-bold text-muted-foreground">{title}</span>
        <span className="caps text-[9.5px] font-bold text-muted-foreground">{unit}</span>
      </p>
      <ol>
        {rows.map((row, i) => {
          const first = i === 0;
          const name = (
            <span className="min-w-0">
              <span className="block truncate text-[14.5px] font-semibold text-foreground">{row.name}</span>
              {first && crown && (
                <span className="mt-1 inline-block rounded-full bg-foil px-2 py-[3px] text-[8.5px] leading-none font-bold tracking-[0.2em] text-[#1a1206] uppercase">
                  {crown}
                </span>
              )}
            </span>
          );
          return (
            <li
              key={row.name + i}
              className="grid grid-cols-[2.25rem_auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-value/[0.14] py-2.5 first:border-t-0"
            >
              <span className={cn("font-money text-[28px] leading-none", first ? "text-foil" : "text-foreground/70")}>{i + 1}</span>
              <UserAvatar src={row.avatar} name={row.name} size={32} ring={first ? "live" : "none"} ringGapClassName="bg-surface" />
              {row.href ? (
                <Link href={row.href} className="min-w-0 hover:opacity-85">
                  {name}
                </Link>
              ) : (
                name
              )}
              <Money cents={row.cents} size="sm" compact={row.cents >= 1_000_000} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
