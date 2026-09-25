"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { ArrowUpRight, Camera, Check, Copy, Eye, EyeSlash, Plus, Shield, SignOut, Warning, X } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { CATEGORY_GROUPS, POPULAR_CATEGORIES, formatNumber } from "@/lib/categories";
import { categoryArt } from "@/lib/category-art";
import { compressImage } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { SelectField } from "@/components/ui/select-field";
import { SwitchField } from "@/components/ui/selection-controls";
import { UserAvatar } from "@/components/ui/user-avatar";

/**
 * Settings, in the same grammar as Schedule and Your channel (owner,
 * 2026-09-24: "can we do for the settings and the studio same way"). Five
 * sections on one page, reached from a sticky index that follows the
 * scroll: who you are (with a live preview of how people see you), your
 * encoder key, your chat rules, what your feed leads with, and your
 * account. Switches save the moment they flip; the profile saves as one
 * edit, with a bar that only appears when there's something to save.
 */

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "streaming", label: "Streaming" },
  { id: "chat", label: "Chat" },
  { id: "feed", label: "Your feed" },
  { id: "account", label: "Account" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["pcm", "Nigerian Pidgin"],
  ["yo", "Yorùbá"],
  ["ig", "Igbo"],
  ["ha", "Hausa"],
  ["fr", "Français"],
  ["pt", "Português"],
  ["es", "Español"],
  ["sw", "Kiswahili"],
  ["ar", "العربية"],
];
const MAX_INTERESTS = 8;

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";
const FIELD =
  "w-full rounded-control bg-white/[0.06] px-4 text-[15px] text-foreground outline-none shadow-[inset_0_0_0_1px_rgba(255,236,230,0.1)] transition-[background-color,box-shadow] placeholder:text-muted-foreground/50 hover:bg-white/[0.08] focus:bg-white/[0.08] focus:shadow-[inset_0_0_0_1.5px_var(--color-ember)]";

export default function SettingsPage() {
  const { user } = useAuth();
  const [active, setActive] = useState<SectionId>("profile");

  // Which section is on screen — the one whose top has most recently passed under the bar.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => Boolean(el));
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id as SectionId);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [user]);

  if (!user) {
    return (
      <Shell>
        <div className="h-[60vh] animate-pulse rounded-panel bg-surface" />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-6 md:mb-8">
        <p className={EYEBROW}>Settings</p>
        <h1 className="mt-2 font-wide text-[clamp(2rem,4.2vw,3.4rem)] leading-[0.98] font-bold tracking-[-0.04em] text-balance">Make it yours.</h1>
        <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-muted-foreground">
          How people see you, the key your encoder uses, the rules in your chat and what your home feed leads with.
        </p>
      </header>

      <nav aria-label="Settings sections" className="sticky top-14 z-20 -mx-4 mb-6 bg-background/85 px-4 backdrop-blur-xl md:top-16 md:-mx-8 md:px-8">
        <div className="flex gap-6 overflow-x-auto shadow-[inset_0_-1px_0_rgba(255,236,230,0.08)] scrollbar-none">
          {SECTIONS.map((s) => {
            const on = s.id === active;
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                aria-current={on ? "true" : undefined}
                onClick={() => setActive(s.id)}
                className={cn(
                  "relative flex h-11 shrink-0 items-center text-[14px] whitespace-nowrap transition-colors md:text-[15px]",
                  on ? "font-bold text-foreground" : "font-medium text-foreground/50 hover:text-foreground/85",
                )}
              >
                {on && <span aria-hidden className="absolute inset-x-0 -bottom-px mx-auto h-[2px] w-5 rounded-full bg-ember motion-safe:animate-[xt-pop_.3s_var(--ease-spring)_both]" />}
                {s.label}
              </a>
            );
          })}
        </div>
      </nav>

      <div className="flex flex-col gap-10 md:gap-14">
        <ProfileSection />
        <StreamingSection />
        <ChatSection />
        <FeedSection />
        <AccountSection />
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <div className="mx-auto max-w-[1180px]">{children}</div>
    </div>
  );
}

function SectionHead({ id, title, lede }: { id: SectionId; title: string; lede: string }) {
  return (
    <div className="mb-4 md:mb-5">
      <h2 id={`${id}-title`} className="font-wide text-[22px] font-bold tracking-[-0.03em] md:text-[24px]">
        {title}
      </h2>
      <p className="mt-1 max-w-[62ch] text-[14px] text-muted-foreground">{lede}</p>
    </div>
  );
}

/** A small "Saved" that fades in beside whatever just saved itself. */
function useSavedFlash() {
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((ok: boolean, text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setFlash({ ok, text });
    timer.current = setTimeout(() => setFlash(null), ok ? 2200 : 6000);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [flash, show] as const;
}

function Flash({ flash, className }: { flash: { ok: boolean; text: string } | null; className?: string }) {
  if (!flash) return null;
  return (
    <p role="status" className={cn("flex items-center gap-1.5 text-[13px] font-semibold motion-safe:animate-fade-in", flash.ok ? "text-foreground" : "text-chili-hi", className)}>
      {flash.ok ? <Check size={14} weight="bold" className="text-ember-hi" /> : <Warning size={14} />}
      {flash.text}
    </p>
  );
}

/* ── Profile ─────────────────────────────────────────────────────────── */

function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, show] = useSavedFlash();
  const file = useRef<HTMLInputElement>(null);

  if (!user) return null;
  const dirty = displayName !== user.displayName || username !== user.username || bio !== (user.bio || "") || avatar !== null;
  const name = displayName.trim() || user.username;

  const pickAvatar = async (f?: File | null) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      show(false, "That photo's over 5 MB — try a smaller one.");
      return;
    }
    try {
      setAvatar(await compressImage(f, 256, 0.85));
    } catch {
      show(false, "That photo didn't load — try another.");
    }
  };

  const discard = () => {
    setDisplayName(user.displayName);
    setUsername(user.username);
    setBio(user.bio || "");
    setAvatar(null);
  };

  const save = async () => {
    // Only what changed: an untouched legacy username shouldn't have to pass today's rules.
    const payload: Record<string, string> = {};
    if (displayName !== user.displayName) payload.displayName = displayName.trim();
    if (username !== user.username) payload.username = username.trim();
    if (bio !== (user.bio || "")) payload.bio = bio;
    if (avatar) payload.avatar = avatar;
    if (Object.keys(payload).length === 0) return;
    setSaving(true);
    try {
      await apiFetch("/api/user/me", { method: "PATCH", body: JSON.stringify(payload) });
      await refreshUser();
      setAvatar(null);
      show(true, "Profile saved");
    } catch (e) {
      show(false, e instanceof Error ? e.message : "Couldn't save your profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="profile" aria-labelledby="profile-title" className="scroll-mt-32">
      <SectionHead id="profile" title="Profile" lede="Your name, handle, photo and bio — the first things anyone sees on your channel." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className={cn(TILE, "p-6 md:p-8 lg:col-span-8")}>
          <div className="flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={() => file.current?.click()}
              aria-label="Change your photo"
              className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              <UserAvatar src={avatar || user.avatar} name={name} size={88} className="size-[88px]" />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Camera size={22} className="text-white" />
              </span>
              {avatar && <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-ember px-1.5 py-0.5 text-[10px] font-bold text-on-ember ring-2 ring-surface">New</span>}
            </button>
            <div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => file.current?.click()} className="press h-10 rounded-full bg-control px-4 text-[14px] font-semibold hover:bg-control-hover">
                  Change photo
                </button>
                {avatar && (
                  <button type="button" onClick={() => setAvatar(null)} className="press h-10 rounded-full px-3 text-[14px] font-semibold text-muted-foreground hover:text-foreground">
                    Undo
                  </button>
                )}
              </div>
              <p className="mt-2 text-[12.5px] text-muted-foreground">JPG, PNG, WebP or GIF · up to 5 MB · shown round</p>
            </div>
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                void pickAvatar(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <div className="mt-7 grid gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="settings-name" className={EYEBROW}>
                Display name
              </label>
              <input id="settings-name" value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} className={cn(FIELD, "mt-2 h-12")} />
            </div>
            <div>
              <label htmlFor="settings-username" className={EYEBROW}>
                Username
              </label>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[15px] text-muted-foreground">@</span>
                <input
                  id="settings-username"
                  value={username}
                  maxLength={30}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setUsername(e.target.value.replace(/\s/g, "").toLowerCase())}
                  className={cn(FIELD, "h-12 pl-8")}
                />
              </div>
              <p className="mt-2 font-mono text-[12px] text-muted-foreground">Your channel lives at /c/{username || "you"}</p>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="settings-bio" className={EYEBROW}>
                Bio
              </label>
              <span className={cn("font-mono text-[11px] tabular-nums", bio.length > 180 ? "text-ember-hi" : "text-muted-foreground")}>{bio.length}/200</span>
            </div>
            <textarea
              id="settings-bio"
              value={bio}
              maxLength={200}
              rows={3}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What you stream, when, and why people stay."
              className={cn(FIELD, "mt-2 resize-none py-3 leading-relaxed")}
            />
          </div>

          <div className="mt-6 flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-5">
            {dirty ? (
              <p className="text-[13.5px] text-muted-foreground">You have unsaved changes.</p>
            ) : flash ? (
              <Flash flash={flash} />
            ) : (
              <p className="text-[13.5px] text-muted-foreground/70">Everything&apos;s saved.</p>
            )}
            {dirty && (
              <div className="flex gap-2">
                <button type="button" onClick={discard} className="press h-11 rounded-full px-4 text-[14px] font-semibold text-muted-foreground hover:text-foreground">
                  Discard
                </button>
                <button type="button" onClick={save} disabled={saving} className="press h-11 rounded-full bg-white px-6 text-[14.5px] font-semibold text-[#0b0708] disabled:opacity-60">
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            )}
            {dirty && flash && !flash.ok && <Flash flash={flash} className="w-full" />}
          </div>
        </div>

        <aside aria-label="How people see you" className={cn(TILE, "flex flex-col p-6 md:p-7 lg:col-span-4")}>
          <p className={EYEBROW}>How people see you</p>
          <div className="mt-5 flex flex-col items-center text-center">
            <UserAvatar src={avatar || user.avatar} name={name} size={80} className="size-20" ring={user.isLive ? "live" : "none"} />
            <p className="mt-4 max-w-full truncate font-wide text-[20px] font-bold tracking-[-0.02em]">{name}</p>
            <p className="mt-0.5 text-[13.5px] text-muted-foreground">
              @{username || user.username} · <span className="font-semibold text-foreground tabular-nums">{formatNumber(user.followers)}</span> followers
            </p>
            <p className={cn("mt-3 line-clamp-3 max-w-[32ch] text-[13.5px] leading-relaxed", bio ? "text-foreground/80" : "text-muted-foreground/60 italic")}>
              {bio || "No bio yet — a line here turns a visit into a follow."}
            </p>
          </div>
          <Link
            href={`/c/${user.username}`}
            className="press mt-auto flex h-10 items-center justify-center gap-1.5 self-center rounded-full bg-control px-4 pt-0 text-[13.5px] font-semibold hover:bg-control-hover"
          >
            View public page
            <ArrowUpRight size={14} weight="bold" />
          </Link>
        </aside>
      </div>
    </section>
  );
}

/* ── Streaming ───────────────────────────────────────────────────────── */

function StreamingSection() {
  const [key, setKey] = useState<{ url: string; streamKey: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<"url" | "key" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [flash, show] = useSavedFlash();

  // Fetched on request, not on load: asking for the key sets up the account's ingress.
  const reveal = async () => {
    setLoading(true);
    try {
      const r = await apiFetch<{ success: boolean; data: { url: string; streamKey: string } }>("/api/users/me/stream-key");
      setKey(r.data);
      setShown(true);
    } catch (e) {
      show(false, e instanceof Error ? e.message : "Couldn't load your key");
    } finally {
      setLoading(false);
    }
  };

  const rotate = async () => {
    setLoading(true);
    try {
      const r = await apiFetch<{ success: boolean; data: { url: string; streamKey: string } }>("/api/users/me/stream-key/rotate", { method: "POST" });
      setKey(r.data);
      setShown(true);
      setConfirm(false);
      show(true, "New key ready — paste it into your encoder");
    } catch (e) {
      show(false, e instanceof Error ? e.message : "Couldn't replace the key");
    } finally {
      setLoading(false);
    }
  };

  const copy = async (what: "url" | "key", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      show(false, "Copy didn't work — select the text instead");
    }
  };

  return (
    <section id="streaming" aria-labelledby="streaming-title" className="scroll-mt-32">
      <SectionHead id="streaming" title="Streaming" lede="Broadcast from OBS, vMix or any RTMP encoder with one server and one key that never change." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className={cn(TILE, "p-6 md:p-8 lg:col-span-8")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={EYEBROW}>Encoder</p>
              <p className="mt-2 font-wide text-[20px] font-bold tracking-[-0.02em]">Your server and stream key</p>
            </div>
            <Link href="/studio?source=obs" className="press flex h-9 items-center gap-1.5 rounded-full bg-control px-3.5 text-[13px] font-semibold hover:bg-control-hover">
              Open the studio
              <ArrowUpRight size={13} weight="bold" />
            </Link>
          </div>

          {key ? (
            <div className="mt-6 grid gap-3">
              <KeyRow label="Server URL" value={key.url} copied={copied === "url"} onCopy={() => copy("url", key.url)} />
              <KeyRow
                label="Stream key"
                value={shown ? key.streamKey : "•".repeat(Math.min(28, key.streamKey.length))}
                secret
                copied={copied === "key"}
                onCopy={() => copy("key", key.streamKey)}
                onToggle={() => setShown((v) => !v)}
                shown={shown}
              />
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-start gap-3 rounded-[12px] bg-white/[0.035] p-5">
              <p className="max-w-[52ch] text-[14px] leading-relaxed text-muted-foreground">
                Keep it private — anyone with your key can broadcast on your channel. It shows here only when you ask.
              </p>
              <button type="button" onClick={reveal} disabled={loading} className="press flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-semibold text-[#0b0708] disabled:opacity-60">
                <Eye size={16} />
                {loading ? "Loading…" : "Show my key"}
              </button>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-5">
            <p className="max-w-[52ch] text-[12.5px] leading-relaxed text-muted-foreground">
              Set it once. If your connection drops, keep the encoder running — the stream holds for five minutes and picks up on its own.
            </p>
            {key &&
              (confirm ? (
                <div className="flex gap-2">
                  <button type="button" onClick={rotate} disabled={loading} className="press h-10 rounded-full bg-chili px-4 text-[13.5px] font-semibold text-white disabled:opacity-60">
                    {loading ? "Replacing…" : "Yes, replace it"}
                  </button>
                  <button type="button" onClick={() => setConfirm(false)} className="press h-10 rounded-full bg-control px-4 text-[13.5px] font-semibold hover:bg-control-hover">
                    Keep it
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirm(true)} className="press h-10 rounded-full bg-control px-4 text-[13.5px] font-semibold hover:bg-control-hover">
                  Replace key
                </button>
              ))}
          </div>
          {confirm && <p className="mt-3 text-[12.5px] text-chili-hi">The old key stops working the moment you replace it — any encoder still using it goes dark.</p>}
          <Flash flash={flash} className="mt-3" />
        </div>

        <div className={cn(TILE, "flex flex-col p-6 md:p-7 lg:col-span-4")}>
          <p className={EYEBROW}>Recommended settings</p>
          <dl className="mt-4 grid gap-3 text-[13.5px]">
            {[
              ["Resolution", "1280×720 or 1920×1080"],
              ["Frame rate", "30 fps"],
              ["Bitrate", "2,500–4,500 kbps CBR"],
              ["Keyframes", "Every 2 seconds"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] pb-3 last:border-0 last:pb-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-mono text-[12.5px] font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-auto pt-5 text-[12px] leading-relaxed text-muted-foreground/80">On a weak connection, 720p at 1,500–2,500 kbps keeps the picture steady.</p>
        </div>
      </div>
    </section>
  );
}

function KeyRow({
  label,
  value,
  copied,
  onCopy,
  secret,
  shown,
  onToggle,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  secret?: boolean;
  shown?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] bg-white/[0.045] py-2.5 pr-2.5 pl-4">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-semibold text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate font-mono text-[13.5px] tabular-nums">{value}</p>
      </div>
      {secret && onToggle && (
        <button type="button" onClick={onToggle} aria-label={shown ? "Hide key" : "Show key"} className="press flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground hover:text-foreground">
          {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
        </button>
      )}
      <button type="button" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`} className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
        {copied ? <Check size={14} weight="bold" className="text-ember-hi" /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ── Chat ────────────────────────────────────────────────────────────── */

function ChatSection() {
  const { user, refreshUser } = useAuth();
  const [flash, show] = useSavedFlash();
  const [values, setValues] = useState(() => ({
    slowMode: user?.settings.slowMode ?? false,
    subscriberOnly: user?.settings.subscriberOnly ?? false,
    profanityFilter: user?.settings.profanityFilter ?? true,
    autoRecord: user?.settings.autoRecord ?? false,
  }));

  // Each switch saves itself; a failure flips it back and says why.
  const set = async (k: keyof typeof values, v: boolean) => {
    setValues((s) => ({ ...s, [k]: v }));
    try {
      await apiFetch("/api/user/me", { method: "PATCH", body: JSON.stringify({ settings: { [k]: v } }) });
      void refreshUser();
      show(true, "Saved");
    } catch (e) {
      setValues((s) => ({ ...s, [k]: !v }));
      show(false, e instanceof Error ? e.message : "Couldn't save that");
    }
  };

  return (
    <section id="chat" aria-labelledby="chat-title" className="scroll-mt-32">
      <SectionHead id="chat" title="Chat" lede="The rules in your room. They apply the moment you flip them — even mid-stream." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className={cn(TILE, "p-6 md:p-8 lg:col-span-8")}>
          <div className="flex items-center justify-between gap-3">
            <p className={EYEBROW}>Moderation</p>
            <Flash flash={flash} />
          </div>
          <div className="mt-3 grid divide-y divide-white/[0.06]">
            <div className="py-2">
              <SwitchField label="Slow mode" description="Thirty seconds between messages. Enforced on the server — you're exempt in your own room." checked={values.slowMode} onCheckedChange={(v) => set("slowMode", v)} />
            </div>
            <div className="py-2">
              <SwitchField label="Followers-only chat" description="Only people who follow you can send messages." checked={values.subscriberOnly} onCheckedChange={(v) => set("subscriberOnly", v)} />
            </div>
            <div className="py-2">
              <SwitchField label="Profanity filter" description="Coming soon — nothing is filtered yet, so this stays off for now." checked={false} disabled />
            </div>
          </div>
        </div>
        <div className={cn(TILE, "flex flex-col p-6 md:p-7 lg:col-span-4")}>
          <p className={EYEBROW}>Replays</p>
          <div className="mt-3">
            <SwitchField label="Record my streams" description="Coming soon — replays aren't available yet." checked={false} disabled />
          </div>
          <p className="mt-auto pt-5 text-[12px] leading-relaxed text-muted-foreground/80">Recent broadcasts and their numbers live on Your channel.</p>
        </div>
      </div>
    </section>
  );
}

/* ── Feed ────────────────────────────────────────────────────────────── */

function FeedSection() {
  const { user, refreshUser } = useAuth();
  const [picked, setPicked] = useState<string[]>(() => user?.onboarding?.categories ?? []);
  const [language, setLanguage] = useState(() => user?.onboarding?.language || "en");
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, show] = useSavedFlash();

  const saved = useMemo(() => ({ picked: user?.onboarding?.categories ?? [], language: user?.onboarding?.language || "en" }), [user]);
  const dirty = picked.join("|") !== saved.picked.join("|") || language !== saved.language;
  const full = picked.length >= MAX_INTERESTS;
  const suggestions = POPULAR_CATEGORIES.filter((c) => !picked.includes(c)).slice(0, 6);

  const add = (c: string) => {
    if (!c || picked.includes(c) || full) return;
    setPicked((p) => [...p, c]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/user/me/onboarding", { method: "POST", body: JSON.stringify({ categories: picked, language }) });
      await refreshUser();
      show(true, "Your feed will lead with these");
    } catch (e) {
      show(false, e instanceof Error ? e.message : "Couldn't update your feed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="feed" aria-labelledby="feed-title" className="scroll-mt-32">
      <SectionHead id="feed" title="Your feed" lede="Home leads with what you pick here, then fills in with what's big right now." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className={cn(TILE, "p-6 md:p-8 lg:col-span-8")}>
          <div className="flex items-baseline justify-between gap-3">
            <p className={EYEBROW}>What you&apos;re into</p>
            <span className={cn("font-mono text-[11px] tabular-nums", full ? "text-ember-hi" : "text-muted-foreground")}>
              {picked.length}/{MAX_INTERESTS}
            </span>
          </div>

          {picked.length === 0 ? (
            <p className="mt-4 text-[14px] text-muted-foreground">Nothing picked yet — your feed shows what&apos;s popular until you do.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {picked.map((c) => (
                <li key={c} className="group relative overflow-hidden rounded-[10px] bg-white/[0.04] motion-safe:animate-[xt-spring-in_.4s_var(--ease-spring)_both]">
                  <div className="flex items-center gap-2.5 p-2 pr-9">
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote box art */}
                    <img src={categoryArt(c, { w: 72, h: 96 })} alt="" className="h-12 w-9 shrink-0 rounded-[6px] object-cover" />
                    <span className="line-clamp-2 text-[13px] leading-snug font-semibold">{c}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPicked((p) => p.filter((x) => x !== c))}
                    aria-label={`Remove ${c}`}
                    className="press absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
                  >
                    <X size={13} weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <SelectField
              id="settings-add-interest"
              full
              value={adding}
              placeholder={full ? "That's eight — remove one to add another" : "Add a category"}
              searchPlaceholder="Search 170 categories"
              art={(v) => categoryArt(v, { w: 72, h: 96 })}
              onChange={(v) => {
                add(v);
                setAdding("");
              }}
              groups={CATEGORY_GROUPS.map((g) => ({ label: g.label, options: g.topics.filter((t) => !picked.includes(t)).map((t) => ({ value: t, label: t })) })).filter((g) => g.options.length > 0)}
            />
          </div>
          {suggestions.length > 0 && !full && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-muted-foreground">Popular:</span>
              {suggestions.map((c) => (
                <button key={c} type="button" onClick={() => add(c)} className="press flex h-8 items-center gap-1 rounded-[10px] bg-control px-3 text-[12.5px] font-semibold hover:bg-control-hover">
                  <Plus size={12} weight="bold" />
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={cn(TILE, "flex flex-col p-6 md:p-7 lg:col-span-4")}>
          <label htmlFor="settings-language" className={EYEBROW}>
            Stream language
          </label>
          <div className="mt-3">
            <SelectField id="settings-language" full value={language} onChange={setLanguage} options={LANGUAGES.map(([code, label]) => ({ value: code, label }))} />
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">Rooms in your language get a nudge up your feed.</p>
          <div className="mt-auto flex flex-col gap-3 pt-6">
            <Flash flash={flash} />
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="press h-11 rounded-full bg-white text-[14.5px] font-semibold text-[#0b0708] transition-opacity disabled:opacity-40 disabled:shadow-none"
            >
              {saving ? "Updating…" : dirty ? "Update my feed" : "Feed's up to date"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Account ─────────────────────────────────────────────────────────── */

function AccountSection() {
  const { user, logout } = useAuth();
  const clerk = useClerk();
  const [leaving, setLeaving] = useState(false);
  if (!user) return null;
  return (
    <section id="account" aria-labelledby="account-title" className="scroll-mt-32">
      <SectionHead id="account" title="Account" lede="One WorldStreet account signs you in here, on WorldSpace and across the rest of the family." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className={cn(TILE, "flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between md:p-8 lg:col-span-8")}>
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
              <Shield size={20} className="text-ember-hi" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-bold">Sign-in and security</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
                Signed in as <span className="font-semibold text-foreground">{user.email || `@${user.username}`}</span>. Password, two-step verification and devices live in your WorldStreet account.
              </p>
            </div>
          </div>
          <button type="button" onClick={() => clerk.openUserProfile()} className="press h-11 shrink-0 rounded-full bg-control px-5 text-[14px] font-semibold hover:bg-control-hover">
            Manage account
          </button>
        </div>
        <div className={cn(TILE, "flex flex-col justify-between gap-4 p-6 md:p-7 lg:col-span-4")}>
          <div>
            <p className="text-[15px] font-bold">Sign out</p>
            <p className="mt-1 text-[13.5px] text-muted-foreground">Of this browser only — your other devices stay signed in.</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              setLeaving(true);
              await logout();
            }}
            disabled={leaving}
            className="press flex h-11 items-center justify-center gap-2 rounded-full bg-control text-[14px] font-semibold hover:bg-control-hover disabled:opacity-60"
          >
            <SignOut size={16} />
            {leaving ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </section>
  );
}
