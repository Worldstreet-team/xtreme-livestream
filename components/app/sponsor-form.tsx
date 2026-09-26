"use client";

import { useRef, useState } from "react";
import { ImageSquare, Trash } from "@/components/icons";
import { TextField } from "@/components/ui/text-field";
import { apiUrl } from "@/lib/api-client";
import { compressImage } from "@/lib/image-utils";
import { SPONSOR_CATEGORIES, SPONSOR_CATEGORY_LABELS, type SponsorCategory, type SponsorDraft, type SponsorView } from "@/lib/sponsors";
import { cn } from "@/lib/utils";

/** A web address someone typed, as one the card can link to ("shop.example.com" works too). */
export function normalizeLink(raw: string) {
  const t = raw.trim();
  if (!t) return "";
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A brand's logo: the one it has, a new one picked here (squeezed to WebP,
 * which keeps transparency), or none. `value` is a data URI once changed,
 * "" once removed, and undefined while it's the one already stored.
 */
export function LogoPicker({
  current,
  value,
  onChange,
  onError,
}: {
  current: string | null;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  onError: (message: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const shown = value === undefined ? (current ? apiUrl(current) : null) : value || null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    onError(null);
    if (!/^image\/(png|webp|jpeg|svg\+xml)$/.test(file.type)) return onError("Use a PNG, WebP, JPEG or SVG.");
    if (file.size > 5 * 1024 * 1024) return onError("That file is over 5 MB.");
    setBusy(true);
    try {
      let uri = await compressImage(file, 384, 0.9, "image/webp");
      if (uri.length > 150_000) uri = await compressImage(file, 256, 0.8, "image/webp");
      onChange(uri);
    } catch {
      onError("Couldn't use that image — try another.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-white p-1.5">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview or the logo the API serves
          <img src={shown} alt="Logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <ImageSquare size={22} className="text-[#0b0708]/35" />
        )}
      </span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="press flex h-9 items-center rounded-full bg-white/[0.07] px-3.5 text-[12.5px] font-semibold transition-colors hover:bg-white/[0.11] disabled:opacity-50"
        >
          {busy ? "Squeezing…" : shown ? "Replace logo" : "Add logo"}
        </button>
        {shown && !busy && (
          <button
            type="button"
            onClick={() => onChange(current ? "" : undefined)}
            aria-label="Remove logo"
            className="press flex size-9 items-center justify-center rounded-full bg-white/[0.07] text-muted-foreground transition-colors hover:bg-white/[0.11] hover:text-foreground"
          >
            <Trash size={15} />
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** What a sponsor sells, as chips: the restricted ones say where they won't show. */
export function CategoryPicker({ value, onChange }: { value: SponsorCategory; onChange: (c: SponsorCategory) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label font-medium">What they sell</span>
      <div role="radiogroup" aria-label="What they sell" className="flex flex-wrap gap-1.5">
        {SPONSOR_CATEGORIES.map((c) => {
          const on = value === c;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(c)}
              className={cn(
                "press h-9 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                on ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
              )}
            >
              {SPONSOR_CATEGORY_LABELS[c].label}
            </button>
          );
        })}
      </div>
      {/* Not through cn(): tailwind-merge reads text-caption as a colour and drops it. */}
      <p className={`text-caption ${value === "crypto" || value === "betting" || value === "alcohol" ? "text-warning" : "text-muted-foreground"}`}>
        {SPONSOR_CATEGORY_LABELS[value].hint}
      </p>
    </div>
  );
}

/**
 * Add or change one of your own sponsors: the brand's mark, name, line,
 * where the card links, and a promo code viewers can use.
 */
export function SponsorForm({
  sponsor,
  onSave,
  onCancel,
}: {
  sponsor: SponsorView | null;
  onSave: (draft: SponsorDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(sponsor?.name ?? "");
  const [line, setLine] = useState(sponsor?.line ?? "");
  const [link, setLink] = useState(sponsor?.url ?? "");
  const [code, setCode] = useState(sponsor?.code ?? "");
  const [category, setCategory] = useState<SponsorCategory>(sponsor?.category ?? "everyday");
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const url = normalizeLink(link);
  const codeOk = /^[A-Za-z0-9_-]*$/.test(code.trim());

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError("Give the sponsor a name.");
    if (url === null) return setError("That link doesn't look like a web address.");
    if (!codeOk) return setError("Promo codes use letters, numbers, - and _ only.");
    setSaving(true);
    try {
      await onSave({ name: name.trim(), line: line.trim(), url, code: code.trim(), category, ...(logo !== undefined ? { logo } : {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-5"
    >
      <LogoPicker current={sponsor?.logoUrl ?? null} value={logo} onChange={setLogo} onError={setError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ofada Express" required />
        <TextField label="Promo code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={24} placeholder="XTREAM10" hint="Optional — shown on the card" />
      </div>
      <TextField label="Their line" value={line} onChange={(e) => setLine(e.target.value)} maxLength={80} placeholder="Food at your door in 30 minutes" />
      <TextField label="Link" value={link} onChange={(e) => setLink(e.target.value)} maxLength={300} inputMode="url" placeholder="ofadaexpress.com" hint="Where the card takes viewers who tap it" />
      <CategoryPicker value={category} onChange={setCategory} />
      {error && <p role="alert" className="rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="press flex h-10 items-center rounded-full bg-white px-5 text-[13.5px] font-semibold text-[#0b0708] disabled:opacity-50">
          {saving ? "Saving…" : sponsor ? "Save changes" : "Add sponsor"}
        </button>
        <button type="button" onClick={onCancel} className="press flex h-10 items-center rounded-full px-4 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </form>
  );
}
