import { ECOSYSTEM } from "@/lib/ecosystem";
import { cn } from "@/lib/utils";

/**
 * The rest of WorldStreet as a launcher: three tiles across, a glyph and
 * one word each, like a phone's app folder. It replaces the Products
 * accordion in the rail and the long list in the phone drawer. Vivid isn't
 * a tile — it's docked in the top bar, one tap from anywhere.
 */
const APPS = ECOSYSTEM.filter((app) => app.title !== "Vivid AI");

export function LauncherGrid({ className }: { className?: string }) {
  return (
    <nav aria-label="More from WorldStreet" className={cn("grid grid-cols-3 gap-1.5", className)}>
      {APPS.map((app) => (
        <a
          key={app.title}
          href={app.href}
          target="_blank"
          rel="noopener noreferrer"
          title={`${app.title} — ${app.description}`}
          className="press group flex flex-col items-center gap-1.5 rounded-control bg-tint/[0.03] px-1 pt-2.5 pb-2 text-[11px] font-semibold text-foreground/80 shadow-[inset_0_0_0_1px_var(--hairline-color)] transition-colors hover:bg-tint/[0.06] hover:text-foreground"
        >
          <app.icon size={20} weight="duotone" className="text-foreground/85 transition-colors group-hover:text-foreground" aria-hidden />
          <span className="max-w-full truncate">{app.short}</span>
        </a>
      ))}
    </nav>
  );
}
