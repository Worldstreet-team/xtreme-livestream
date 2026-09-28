import { ECOSYSTEM } from "@/lib/ecosystem";
import { cn } from "@/lib/utils";

/**
 * The rest of WorldStreet as a dock (owner, 2026-09-28: "I don't like the
 * grid, find another style"): a row of round app icons you swipe along, each
 * with its one-word name under it, the same round language as the live
 * rings, with no tiles, boxes or borders. Vivid isn't in it; it's docked in
 * the top bar, one tap from anywhere.
 */
const APPS = ECOSYSTEM.filter((app) => app.title !== "Vivid AI");

export function LauncherGrid({ className }: { className?: string }) {
  return (
    <nav aria-label="More from WorldStreet" className={cn("relative min-w-0 overflow-hidden", className)}>
      <ul className="relative flex gap-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {APPS.map((app) => (
          <li key={app.title} className="shrink-0">
            <a
              href={app.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${app.title}: ${app.description}`}
              className="press group flex w-[72px] flex-col items-center gap-1.5 rounded-control py-1 outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-control text-foreground transition-[background-color,transform] duration-200 group-hover:bg-control-hover group-active:scale-95">
                <app.icon size={21} weight="duotone" aria-hidden />
              </span>
              <span className="w-full truncate text-center text-[11px] font-semibold text-foreground/75">{app.short}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
