"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PencilSimple } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { CATEGORY_GROUPS, MARKET_GROUP_LABELS } from "@/lib/categories";
import { categoryArt } from "@/lib/category-art";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The go-live screen's own small parts: an optional title, a category chip,
 * and — once on air — the pill and light sheet that change them. Going live
 * asks for nothing (owner, 2026-09-28: "let them just click Live"), so
 * every field here can be left alone.
 */

/**
 * The studio's category menu: what most people stream first, markets and
 * crypto last — they're an option on a social app, not its premise.
 */
export const STUDIO_CATEGORY_GROUPS = [
  ...CATEGORY_GROUPS.filter((g) => !MARKET_GROUP_LABELS.has(g.label)),
  ...CATEGORY_GROUPS.filter((g) => MARKET_GROUP_LABELS.has(g.label)),
].map((g) => ({ label: g.label, options: g.topics.map((t) => ({ value: t, label: t })) }));

const TITLE_PLACEHOLDER = "Add a title (optional)";

/**
 * The stream's title. `picture` sits on the camera (phones); `panel` is the
 * console's filled field. Blank is fine — the stream is named after you.
 */
export function TitleField({
  value,
  onChange,
  variant,
  id,
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (title: string) => void;
  variant: "picture" | "panel";
  id?: string;
  autoFocus?: boolean;
  /** Enter in the field — the details sheet saves on it. */
  onEnter?: () => void;
}) {
  const common = {
    id,
    type: "text",
    value,
    maxLength: 100,
    autoComplete: "off",
    enterKeyHint: "done" as const,
    autoFocus,
    placeholder: TITLE_PLACEHOLDER,
    "aria-label": "Stream title (optional)",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (onEnter) onEnter();
      else e.currentTarget.blur();
    },
  };
  if (variant === "panel") return <Input {...common} className="font-semibold" />;
  // 16px so iOS doesn't zoom the page when it's tapped.
  return (
    <input
      {...common}
      className="obj block h-12 w-full min-w-0 rounded-[14px] px-4 text-[16px] font-semibold text-white outline-none transition-shadow placeholder:font-medium placeholder:text-white/60 focus-visible:shadow-[inset_0_0_0_1.5px_var(--ember)]"
    />
  );
}

/** Where the stream lives, as a chip with its cover. Just Chatting unless you pick. */
export function CategoryChip({
  value,
  onChange,
  variant,
  id,
  full,
}: {
  value: string;
  onChange: (category: string) => void;
  variant: "picture" | "panel";
  id?: string;
  full?: boolean;
}) {
  return (
    <SelectField
      id={id}
      // A chip on the go-live screen; a full field in the details sheet.
      size={full ? "md" : "sm"}
      full={full}
      value={value}
      onChange={onChange}
      ariaLabel="Category"
      searchPlaceholder="Search categories"
      art={(v) => categoryArt(v, { w: 72, h: 96 })}
      groups={STUDIO_CATEGORY_GROUPS}
      // On the camera the chip wears the picture's object paint, like every control there.
      className={variant === "picture" ? "max-w-full bg-black/55! text-white shadow-none! hover:bg-black/65!" : undefined}
    />
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
      <div className="mt-4 space-y-2.5">
        <TitleField variant="panel" value={draftTitle} onChange={setDraftTitle} autoFocus onEnter={() => void save()} />
        <CategoryChip variant="panel" full value={draftCategory} onChange={setDraftCategory} />
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
