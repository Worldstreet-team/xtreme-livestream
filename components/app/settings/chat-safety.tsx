"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Plus, ShieldStar, Storefront, Trash, Warning, X } from "@/components/icons";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { FilterCategory, FilterLevel, ModRole, ModsCanFeature } from "@xtreme/contracts";

/**
 * Settings → Chat's safety kit: the chat filter (a level per category),
 * the creator's own blocked terms, and their moderators. Everything saves
 * the moment it changes, like the switches beside it.
 */

const ROLE_LABEL: Record<ModRole, string> = { mod: "Moderator", lead: "Lead", producer: "Producer" };
const NEXT_ROLE: Record<ModRole, ModRole> = { mod: "lead", lead: "producer", producer: "mod" };

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

export interface SafetyState {
  profanityFilter: boolean;
  filters: Record<FilterCategory, FilterLevel>;
  blockedTerms: string[];
  blockedTermsLevel: "hold" | "block";
  modsCanFeature: ModsCanFeature;
}

export interface ModRow {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  role: ModRole;
}

const CATEGORIES: { id: FilterCategory; label: string; hint: string }[] = [
  { id: "slurs", label: "Hate and slurs", hint: "Slurs against race, ethnicity, religion, gender or disability" },
  { id: "scams", label: "Scams and wallet addresses", hint: "“Double your money”, wallet addresses, seed phrases, phone numbers" },
  { id: "links", label: "Links", hint: "Web addresses, shorteners and chat-app invites" },
  { id: "sexual", label: "Sexual content", hint: "Explicit terms and solicitation" },
  { id: "insults", label: "Insults", hint: "Including Pidgin, Yoruba, Hausa and Igbo" },
  { id: "profanity", label: "Swearing", hint: "Everyday swear words" },
];

const LEVELS: { id: FilterLevel; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "hold", label: "Hold" },
  { id: "block", label: "Block" },
];

/** Off / Hold / Block, the selected one in its colour: ember holds, chili blocks. */
function LevelControl({
  value,
  onChange,
  disabled,
  label,
  levels = LEVELS,
}: {
  value: FilterLevel;
  onChange: (level: FilterLevel) => void;
  disabled?: boolean;
  label: string;
  levels?: typeof LEVELS;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex w-fit shrink-0 self-start rounded-full bg-white/[0.05] p-0.5 sm:self-center", disabled && "opacity-40")}>
      {levels.map((l) => {
        const on = value === l.id;
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => !on && onChange(l.id)}
            className={cn(
              "press h-7 min-w-[3.25rem] rounded-full px-2.5 text-[12px] font-semibold transition-colors disabled:pointer-events-none",
              on
                ? l.id === "block"
                  ? "bg-chili text-white"
                  : l.id === "hold"
                    ? "bg-ember text-on-ember"
                    : "bg-white/[0.12] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

function Flash({ flash }: { flash: { ok: boolean; text: string } | null }) {
  if (!flash) return null;
  return (
    <p role="status" className={cn("flex items-center gap-1.5 text-[13px] font-semibold motion-safe:animate-fade-in", flash.ok ? "text-foreground" : "text-chili-hi")}>
      {flash.ok ? <Check size={14} weight="bold" className="text-ember-hi" /> : <Warning size={14} />}
      {flash.text}
    </p>
  );
}

function useFlash() {
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.ok ? 2200 : 6000);
    return () => clearTimeout(t);
  }, [flash]);
  return [flash, (ok: boolean, text: string) => setFlash({ ok, text })] as const;
}

/**
 * The whole safety kit for Settings → Chat: loads the channel's filter and
 * moderators once, and hands each tile what it edits. Laid out on the
 * section's 12-column grid: the filter tall on the left, the room's rules
 * (passed in) and your terms stacked beside it, moderators across.
 */
export function ChatSafety({ userId, rules }: { userId: string; rules: ReactNode }) {
  const [safety, setSafety] = useState<SafetyState | null>(null);
  const [mods, setMods] = useState<ModRow[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ success: boolean; data: { safety: SafetyState; mods: ModRow[] } }>("/api/users/me/safety")
      .then((r) => {
        if (cancelled) return;
        setSafety(r.data.safety);
        setMods(r.data.mods);
      })
      .catch(() => !cancelled && setLoadError(true));
    apiFetch<{ success: boolean; data: { admin: boolean } }>("/api/admin/me")
      .then((r) => !cancelled && setAdmin(r.data.admin))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Save part of the filter; the tile shows it at once and puts it back if the save fails. */
  const saveSafety = async (patch: Partial<Omit<SafetyState, "profanityFilter">>, flash: (ok: boolean, text: string) => void) => {
    if (!safety) return;
    const before = safety;
    setSafety({ ...safety, ...patch, filters: { ...safety.filters, ...(patch.filters ?? {}) } });
    try {
      const r = await apiFetch<{ success: boolean; data: { safety: SafetyState } }>("/api/users/me/safety", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSafety(r.data.safety);
      flash(true, "Saved");
    } catch (e) {
      setSafety(before);
      flash(false, e instanceof Error ? e.message : "Couldn't save that");
    }
  };

  const saveMaster = async (on: boolean, flash: (ok: boolean, text: string) => void) => {
    if (!safety) return;
    setSafety({ ...safety, profanityFilter: on });
    try {
      await apiFetch("/api/user/me", { method: "PATCH", body: JSON.stringify({ settings: { profanityFilter: on } }) });
      flash(true, on ? "Chat filter on" : "Chat filter off");
    } catch (e) {
      setSafety({ ...safety, profanityFilter: !on });
      flash(false, e instanceof Error ? e.message : "Couldn't save that");
    }
  };

  if (loadError) {
    return (
      <div className={cn(TILE, "p-6 lg:col-span-12")}>
        <p className="text-[14px] text-muted-foreground">Your chat filter and moderators didn&apos;t load. Refresh to try again.</p>
      </div>
    );
  }

  return (
    <>
      <FilterTile safety={safety} onLevel={saveSafety} onMaster={saveMaster} />
      <div className="flex flex-col gap-3 lg:col-span-5">
        {rules}
        <TermsTile safety={safety} onSave={saveSafety} />
      </div>
      <ModsTile userId={userId} mods={mods} onMods={setMods} safety={safety} onSave={saveSafety} />
      {admin && (
        <Link
          href="/admin/reports"
          className={cn(TILE, "group flex items-center gap-4 p-5 transition-colors hover:bg-surface-raised lg:col-span-12")}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-chili/[0.14] text-chili-hi">
            <ShieldStar size={18} weight="fill" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">Report queue</span>
            <span className="block text-[12.5px] text-muted-foreground">Platform admin: every report, on its 48-hour clock.</span>
          </span>
          <ArrowUpRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      )}
      {admin && (
        <Link
          href="/admin/campaigns"
          className={cn(TILE, "group flex items-center gap-4 p-5 transition-colors hover:bg-surface-raised lg:col-span-12")}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-value/[0.14] text-value">
            <Storefront size={18} weight="fill" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">Campaigns</span>
            <span className="block text-[12.5px] text-muted-foreground">Platform admin: brands&apos; prepaid campaigns, creators&apos; pay and voucher quests.</span>
          </span>
          <ArrowUpRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      )}
    </>
  );
}

/* ── The filter ───────────────────────────────────────────────────────── */

export function FilterTile({
  safety,
  onLevel,
  onMaster,
}: {
  safety: SafetyState | null;
  onLevel: (patch: Partial<SafetyState>, flash: (ok: boolean, text: string) => void) => void;
  onMaster: (on: boolean, flash: (ok: boolean, text: string) => void) => void;
}) {
  const [flash, show] = useFlash();
  const on = safety?.profanityFilter ?? true;
  return (
    <div className={cn(TILE, "p-6 md:p-7 lg:col-span-7")}>
      <div className="flex items-center justify-between gap-3">
        <p className={EYEBROW}>Chat filter</p>
        <Flash flash={flash} />
      </div>
      <div className="mt-3 flex items-start justify-between gap-4">
        <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">Hold</strong> keeps a line out until you or a moderator lets it in;{" "}
          <strong className="font-semibold text-foreground">Block</strong> never sends it. You and your moderators are never filtered.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Chat filter"
          disabled={!safety}
          onClick={() => onMaster(!on, show)}
          className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40", on ? "bg-ember" : "bg-white/15")}
        >
          <span className={cn("absolute top-0.5 size-5 rounded-full bg-white transition-all", on ? "left-[calc(100%-1.375rem)]" : "left-0.5")} />
        </button>
      </div>
      <ul className="mt-4 divide-y divide-white/[0.06]">
        {CATEGORIES.map((c) => (
          // On a phone the words get the width and the control sits under them.
          <li key={c.id} className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold">{c.label}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{c.hint}</span>
            </span>
            {safety ? (
              <LevelControl
                label={c.label}
                value={safety.filters[c.id]}
                disabled={!on}
                onChange={(level) => onLevel({ filters: { ...safety.filters, [c.id]: level } }, show)}
              />
            ) : (
              <span className="h-8 w-[10.5rem] shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
            )}
          </li>
        ))}
      </ul>
      {!on && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          The filter is off. Shield still blocks links and scams while it&apos;s up.
        </p>
      )}
    </div>
  );
}

/* ── Your own terms ───────────────────────────────────────────────────── */

export function TermsTile({
  safety,
  onSave,
}: {
  safety: SafetyState | null;
  onSave: (patch: Partial<SafetyState>, flash: (ok: boolean, text: string) => void) => void;
}) {
  const [flash, show] = useFlash();
  const [draft, setDraft] = useState("");
  const terms = safety?.blockedTerms ?? [];

  const add = () => {
    const term = draft.trim().toLowerCase();
    if (!safety || !term) return;
    if (!term.replace(/[*\s]/g, "")) {
      show(false, "A term needs letters, not just *");
      return;
    }
    if (terms.includes(term)) {
      setDraft("");
      return;
    }
    if (terms.length >= 100) {
      show(false, "That's the most — 100 terms");
      return;
    }
    setDraft("");
    onSave({ blockedTerms: [...terms, term] }, show);
  };

  return (
    <div className={cn(TILE, "flex flex-1 flex-col p-6 md:p-7")}>
      <div className="flex items-center justify-between gap-3">
        <p className={EYEBROW}>Your blocked terms</p>
        <Flash flash={flash} />
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        Words your room doesn&apos;t say — spoilers, a rival&apos;s name, anything. A <code className="rounded-[4px] bg-white/[0.08] px-1 font-mono text-[12px] text-foreground">*</code> covers the rest of a word: <span className="text-foreground">rival*</span> catches rivals and rivalry.
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={40}
          placeholder="Add a term"
          aria-label="Add a blocked term"
          disabled={!safety}
          className="h-10 min-w-0 flex-1 rounded-full bg-white/[0.06] px-4 text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09]"
        />
        <button
          type="submit"
          disabled={!safety || !draft.trim()}
          className="press flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#0b0708] disabled:opacity-40"
        >
          <Plus size={14} weight="bold" />
          Add
        </button>
      </form>
      <div className="mt-3 flex min-h-10 flex-wrap content-start gap-1.5">
        {terms.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground/70">No terms yet.</p>
        ) : (
          terms.map((t) => (
            <span key={t} className="flex h-8 items-center gap-1 rounded-full bg-white/[0.07] pr-1 pl-3 font-mono text-[12.5px] text-foreground">
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => onSave({ blockedTerms: terms.filter((x) => x !== t) }, show)}
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.1] hover:text-foreground"
              >
                <X size={12} />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <span className="text-[13px] font-medium text-foreground/85">When one comes up</span>
        {safety && (
          <LevelControl
            label="When one of your terms comes up"
            value={safety.blockedTermsLevel}
            levels={LEVELS.filter((l) => l.id !== "off")}
            onChange={(level) => onSave({ blockedTermsLevel: level as "hold" | "block" }, show)}
          />
        )}
      </div>
    </div>
  );
}

/* ── Moderators ───────────────────────────────────────────────────────── */

const SCREEN_OPTIONS: { id: ModsCanFeature; label: string; hint: string }[] = [
  { id: "suggest", label: "Suggest", hint: "Moderators suggest lines for the screen; you put them up." },
  { id: "on", label: "Put up", hint: "Moderators put lines on screen themselves." },
  { id: "off", label: "Not at all", hint: "Only you put lines on screen." },
];

export function ModsTile({
  userId,
  mods,
  onMods,
  safety,
  onSave,
}: {
  userId: string;
  mods: ModRow[];
  onMods: (mods: ModRow[]) => void;
  safety: SafetyState | null;
  onSave: (patch: Partial<SafetyState>, flash: (ok: boolean, text: string) => void) => void;
}) {
  const [flash, show] = useFlash();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<ModRole>("mod");
  const [busy, setBusy] = useState<string | null>(null);

  const add = async () => {
    const name = username.trim().replace(/^@/, "").toLowerCase();
    if (!name) return;
    setBusy("add");
    try {
      const r = await apiFetch<{ success: boolean; data: { mods: ModRow[] } }>(`/api/channels/${userId}/mods`, {
        method: "POST",
        body: JSON.stringify({ username: name, role }),
      });
      onMods(r.data.mods);
      setUsername("");
      show(true, role === "producer" ? `@${name} is a producer — they've been sent the way into your console` : `@${name} is a ${role === "lead" ? "lead moderator" : "moderator"}`);
    } catch (e) {
      show(false, e instanceof Error ? e.message : "Couldn't add them");
    } finally {
      setBusy(null);
    }
  };

  const change = async (m: ModRow, next: ModRole | null) => {
    setBusy(m.userId);
    try {
      const r = next
        ? await apiFetch<{ success: boolean; data: { mods: ModRow[] } }>(`/api/channels/${userId}/mods`, {
            method: "POST",
            body: JSON.stringify({ username: m.username, role: next }),
          })
        : await apiFetch<{ success: boolean; data: { mods: ModRow[] } }>(`/api/channels/${userId}/mods/${m.userId}`, {
            method: "DELETE",
          });
      onMods(r.data.mods);
      show(true, next ? "Saved" : `@${m.username} is no longer a moderator`);
    } catch (e) {
      show(false, e instanceof Error ? e.message : "Couldn't change that");
    } finally {
      setBusy(null);
    }
  };

  const screen = safety?.modsCanFeature ?? "suggest";

  return (
    <div className={cn(TILE, "flex flex-col p-6 md:p-7 lg:col-span-12")}>
      <div className="flex items-center justify-between gap-3">
        <p className={EYEBROW}>Moderators</p>
        <Flash flash={flash} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Moderators keep your chat: they delete, time out and ban, pin, and decide on held lines. A{" "}
            <span className="font-semibold text-foreground">lead</span> also adds moderators and raises Shield. A{" "}
            <span className="font-semibold text-foreground">producer</span> runs your show from their own device — scenes, graphics, your
            run of show and the stage — without appearing on air.
          </p>
          <form
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              aria-label="Username of your new moderator"
              className="h-10 min-w-0 flex-1 basis-40 rounded-full bg-white/[0.06] px-4 text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09]"
            />
            <div role="radiogroup" aria-label="Role" className="flex shrink-0 rounded-full bg-white/[0.05] p-0.5">
              {(["mod", "lead", "producer"] as ModRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "press h-9 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                    role === r ? "bg-white/[0.12] text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={!username.trim() || busy === "add"}
              className="press flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#0b0708] disabled:opacity-40"
            >
              <Plus size={14} weight="bold" />
              Add
            </button>
          </form>

          <ul className="mt-4 flex flex-col gap-1">
            {mods.length === 0 ? (
              <li className="rounded-[12px] bg-white/[0.03] px-4 py-5 text-center text-[13px] text-muted-foreground">
                No moderators yet — add someone you trust from your community.
              </li>
            ) : (
              mods.map((m) => (
                <li key={m.userId} className="flex items-center gap-3 rounded-[12px] px-2 py-2 transition-colors hover:bg-white/[0.03]">
                  <UserAvatar src={m.avatar} name={m.displayName || m.username} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{m.displayName || m.username}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">@{m.username}</span>
                  </span>
                  {/* A tap moves them to the next role: moderator, lead, producer. */}
                  <button
                    type="button"
                    disabled={busy === m.userId}
                    onClick={() => void change(m, NEXT_ROLE[m.role])}
                    title={`Make a ${ROLE_LABEL[NEXT_ROLE[m.role]].toLowerCase()}`}
                    className={cn(
                      "press h-7 shrink-0 rounded-full px-2.5 text-[11.5px] font-bold transition-colors disabled:opacity-50",
                      m.role === "producer"
                        ? "bg-white/[0.14] text-foreground hover:bg-white/[0.18]"
                        : m.role === "lead"
                          ? "bg-ember/[0.16] text-ember-hi hover:bg-ember/25"
                          : "bg-white/[0.07] text-foreground/85 hover:bg-white/[0.11]"
                    )}
                  >
                    {ROLE_LABEL[m.role]}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove @${m.username} as a moderator`}
                    disabled={busy === m.userId}
                    onClick={() => void change(m, null)}
                    className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-chili/15 hover:text-chili-hi disabled:opacity-50"
                  >
                    <Trash size={14} />
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="lg:col-span-5 lg:border-l lg:border-white/[0.06] lg:pl-6">
          <p className="text-[14px] font-semibold">Moderators and the screen</p>
          <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
            Whether moderators can put chat lines on your stream.
          </p>
          <div role="radiogroup" aria-label="Moderators and the screen" className="mt-3 flex flex-col gap-1.5">
            {SCREEN_OPTIONS.map((o) => {
              const on = screen === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!safety}
                  onClick={() => !on && onSave({ modsCanFeature: o.id }, show)}
                  className={cn(
                    "press flex items-start gap-3 rounded-[12px] px-3.5 py-3 text-left transition-colors disabled:opacity-50",
                    on ? "bg-white/[0.08]" : "bg-white/[0.03] hover:bg-white/[0.06]"
                  )}
                >
                  <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full", on ? "bg-ember" : "bg-white/[0.12]")}>
                    {on && <span className="size-1.5 rounded-full bg-on-ember" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold">{o.label}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
