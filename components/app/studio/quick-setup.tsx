"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CategoryChooser, CoverThumb, flyCover, suggestCategories, thumbSrc } from "@/components/app/category-chooser";
import { PencilSimple } from "@/components/icons";
import { pushRecentCategory } from "@/lib/go-live-prefs";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The go-live screen's own small parts: the one details field, and — once
 * on air — the pill and light sheet that change it. Going live asks for
 * nothing (owner, 2026-09-28: "let them just click Live"), so the field can
 * be left alone: an untitled stream is named on the server from its host
 * and category.
 */

const TITLE_PLACEHOLDER = "Add a title (optional)";

/**
 * The title and the category as ONE control (owner, 2026-09-28: "you can
 * merge it with the input too, but they can go live without a name
 * though"). The category's cover sits at the front as a tappable poster
 * that opens the cover grid; the title is typed beside it, with the
 * category and a quiet Change under it. Typing suggests categories as
 * chips beneath ("valo" offers VALORANT); a tap takes one, and its cover
 * flies into the poster.
 *
 * `picture` rides the camera (phones) in the object paint; `panel` is the
 * console's filled field. `cover` opens the chooser over the console the
 * field sits in (an ancestor marked `data-chooser-host`); otherwise it's a
 * sheet on phones and a popover elsewhere. One ring: the field's inset
 * ember line while you type, or the base outline on the poster button.
 */
export function DetailsField({
  variant,
  title,
  onTitleChange,
  category,
  onCategoryChange,
  id,
  autoFocus,
  onEnter,
  cover,
  trailing,
}: {
  variant: "picture" | "panel";
  title: string;
  onTitleChange: (title: string) => void;
  category: string;
  onCategoryChange: (category: string) => void;
  id?: string;
  autoFocus?: boolean;
  /** Enter in the title — the details sheet saves on it. */
  onEnter?: () => void;
  cover?: boolean;
  /** Rides the suggestions row on its right (the camera's More). */
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const poster = useRef<HTMLButtonElement>(null);
  const thumb = useRef<HTMLImageElement>(null);
  // Suggestions answer typing, not a title remembered from last time.
  const [typed, setTyped] = useState(false);
  const suggestions = useMemo(() => (typed ? suggestCategories(title, category) : []), [typed, title, category]);
  const picture = variant === "picture";

  const take = (c: string, chip: HTMLElement) => {
    const img = chip.querySelector("img");
    if (img) flyCover(thumbSrc(c, theme), img.getBoundingClientRect(), thumb.current);
    onCategoryChange(c);
    pushRecentCategory(c);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        className={cn(
          "flex min-w-0 items-center gap-3 rounded-[14px] p-2 pr-3.5 transition-[background-color,box-shadow] duration-200",
          picture ? "obj text-white" : "bg-tint/[0.06] shadow-[inset_0_0_0_1px_var(--hairline-color)] hover:bg-tint/[0.08]",
          "has-[input:focus-visible]:shadow-[inset_0_0_0_1.5px_var(--ring)]"
        )}
      >
        <button
          ref={poster}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Category: ${category}. Change`}
          className="press shrink-0 rounded-[8px]"
        >
          <CoverThumb ref={thumb} category={category} className="h-14 w-[42px] rounded-[8px]" />
        </button>
        <div className="min-w-0 flex-1">
          <input
            id={id}
            type="text"
            value={title}
            maxLength={100}
            autoComplete="off"
            enterKeyHint="done"
            autoFocus={autoFocus}
            placeholder={TITLE_PLACEHOLDER}
            aria-label="Stream title (optional)"
            onChange={(e) => {
              setTyped(true);
              onTitleChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (onEnter) onEnter();
              else e.currentTarget.blur();
            }}
            // 16px so iOS doesn't zoom the page when it's tapped. The ring is the field's, above.
            className={cn(
              "block h-7 w-full min-w-0 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium",
              picture ? "text-white placeholder:text-white/60" : "text-foreground placeholder:text-muted-foreground/80"
            )}
          />
          {/* A bigger target for the same chooser; the poster is the keyboard's way in. */}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setOpen(true)}
            className={cn("group mt-0.5 flex max-w-full min-w-0 items-center gap-1.5 text-left text-[12.5px]", picture ? "text-white/70" : "text-muted-foreground")}
          >
            <span className="truncate font-medium">{category}</span>
            <span aria-hidden className="opacity-50">
              ·
            </span>
            <span className={cn("shrink-0 font-semibold transition-colors", picture ? "group-hover:text-white" : "group-hover:text-foreground")}>Change</span>
          </button>
        </div>
      </div>

      {(suggestions.length > 0 || trailing) && (
        <div className="flex min-w-0 items-center gap-2">
          <div role="group" aria-label="Suggested categories" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {suggestions.map((c) => (
              <button
                key={c}
                type="button"
                onClick={(e) => take(c, e.currentTarget)}
                aria-label={`Set the category to ${c}`}
                className={cn(
                  "press flex h-9 shrink-0 items-center gap-2 rounded-[10px] pr-3 pl-1.5 text-[12.5px] font-semibold whitespace-nowrap motion-safe:animate-[xt-spring-in_.4s_var(--ease-spring)_both]",
                  picture ? "obj text-white" : "bg-control text-foreground/90 hover:bg-control-hover hover:text-foreground"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- our own generated cover */}
                <img src={thumbSrc(c, theme)} alt="" draggable={false} className="h-6 w-[18px] rounded-[4px] object-cover" />
                {c}
              </button>
            ))}
          </div>
          {trailing}
        </div>
      )}

      <CategoryChooser
        open={open}
        onOpenChange={setOpen}
        value={category}
        onChange={onCategoryChange}
        anchor={poster}
        flyTo={thumb}
        resolveHost={cover ? (a) => a.closest<HTMLElement>("[data-chooser-host]") : undefined}
        recent
        label="Category"
      />
    </div>
  );
}

/** A view sliding in from the side as it mounts — the console's More panel. */
export function Appear({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = prefersReducedMotion();
    const a = el.animate(
      reduce
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateX(18px)" },
            { opacity: 1, transform: "none" },
          ],
      { duration: reduce ? DURATION.fade : 340, easing: EASE.unfold }
    );
    return () => a.cancel();
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** On air: the title (or an invitation to add one) as a pill on the picture. */
export function DetailsPill({ title, category, onOpen, className }: { title: string; category: string; onOpen: () => void; className?: string }) {
  const named = title.trim();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={named ? `Stream details: ${named}. Change the title or category` : "Add a title and category"}
      className={cn("obj press flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full pr-3.5 pl-3 text-[12.5px] font-semibold text-white/90 hover:text-white", className)}
    >
      <PencilSimple size={13} className="shrink-0" />
      <span className="truncate">{named || "Add title"}</span>
      {!named && (
        <>
          <span aria-hidden className="text-white/40">
            ·
          </span>
          <span className="truncate font-medium text-white/70">{category}</span>
        </>
      )}
    </button>
  );
}

/**
 * The light sheet the pill opens while live: the title and category, saved
 * through the stream's PATCH — the API tells the room, so viewers see the
 * new title at once. A bottom sheet on phones, a card under the pill
 * elsewhere.
 */
export function StreamDetailsSheet({
  phone,
  title,
  category,
  onSave,
  onClose,
}: {
  phone: boolean;
  title: string;
  category: string;
  onSave: (details: { title: string; category: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftCategory, setDraftCategory] = useState(category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = draftTitle.trim() === title.trim() && draftCategory === category;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (saving) return;
    if (unchanged) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ title: draftTitle.trim(), category: draftCategory });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that — try again.");
      setSaving(false);
    }
  };

  const body = (
    <>
      <p className="font-wide text-[17px] leading-tight font-bold tracking-[-0.02em]">Stream details</p>
      <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">Viewers see the change right away. Leave the title blank and it&apos;s named after you.</p>
      <div className="mt-4">
        <DetailsField
          variant="panel"
          title={draftTitle}
          onTitleChange={setDraftTitle}
          category={draftCategory}
          onCategoryChange={setDraftCategory}
          autoFocus
          onEnter={() => void save()}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[12.5px] text-chili-hi">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onClose} className="press h-11 flex-1 rounded-full bg-control text-[14px] font-semibold text-foreground transition-colors hover:bg-control-hover">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-inverse text-[14px] font-semibold text-on-inverse transition-opacity disabled:opacity-60"
        >
          {saving && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          {saving ? "Saving" : "Save"}
        </button>
      </div>
    </>
  );

  if (phone) {
    return (
      <>
        <button type="button" aria-label="Close" onClick={onClose} className="animate-fade-in absolute inset-0 z-[39] bg-black/50" />
        <div role="dialog" aria-label="Stream details" className="sheet-obj animate-sheet-up absolute inset-x-0 bottom-0 z-40 rounded-t-overlay px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom),16px)] text-foreground">
          <span aria-hidden className="mx-auto mb-3 block h-1 w-9 rounded-full bg-tint/[0.28]" />
          {body}
        </div>
      </>
    );
  }
  return (
    <>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 z-[39] cursor-default" />
      <div role="dialog" aria-label="Stream details" className="animate-pop-in absolute top-14 right-4 z-40 w-[min(360px,calc(100%-2rem))] rounded-overlay bg-popover p-4 text-foreground shadow-[0_24px_64px_-16px_rgba(0,0,0,0.7)]">
        {body}
      </div>
    </>
  );
}
