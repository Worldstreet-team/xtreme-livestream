import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "@/components/ui/brand-mark";

/**
 * The frame around Clerk's sign-in and sign-up cards on the standalone
 * (local) routes: the pitch on the left, the card on the right; on a phone
 * the pitch shrinks to a line above the card. Production signs in on the
 * worldstreetgold.com hub instead, so this only ever shows off-satellite.
 */
export function AuthShell({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_minmax(440px,560px)]">
      <section className="relative flex flex-col justify-between gap-10 px-6 pt-8 pb-6 md:px-12 lg:py-12">
        <Link href="/explore" aria-label="Xtream home" className="w-fit">
          <BrandLockup size={30} wordSize={22} />
        </Link>
        <div className="hidden max-w-[34rem] lg:block">
          <p className="caps font-mono text-[10.5px] text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-3 font-wide text-[clamp(2.5rem,4.6vw,4rem)] leading-[0.96] font-bold tracking-[-0.045em] text-balance">{title}</h1>
          <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-muted-foreground">{lede}</p>
          <ul className="mt-10 grid max-w-[30rem] grid-cols-3 gap-3">
            {[
              ["Watch", "Every room, free"],
              ["Gift", "Straight to creators"],
              ["Earn", "Points for showing up"],
            ].map(([k, v]) => (
              <li key={k} className="rounded-panel bg-surface px-4 py-3.5">
                <p className="text-[14px] font-bold">{k}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{v}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-[12px] text-muted-foreground/70 lg:block">One WorldStreet account works across Xtream, WorldSpace and the rest of the family.</p>
      </section>

      <section className="flex flex-col items-center justify-center px-4 pb-12 lg:bg-surface/40 lg:px-10">
        <div className="mb-6 w-full max-w-[400px] lg:hidden">
          <h1 className="font-wide text-[28px] leading-[1.02] font-bold tracking-[-0.035em] text-balance">{title}</h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{lede}</p>
        </div>
        {children}
      </section>
    </main>
  );
}
