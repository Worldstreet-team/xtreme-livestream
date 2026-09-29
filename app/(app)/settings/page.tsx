"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { ArrowUpRight, Camera, Check, Copy, Eye, EyeSlash, Plus, Shield, SignOut, Warning, X } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { POPULAR_CATEGORIES, formatNumber } from "@/lib/categories";
import { categoryArt } from "@/lib/category-art";
import { useTheme } from "@/lib/theme";
import { compressImage } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { SelectField } from "@/components/ui/select-field";
import { CategoryField } from "@/components/app/category-chooser";
import { SwitchField } from "@/components/ui/selection-controls";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ShowRules } from "@/components/app/show-rules";
import { ControlKeys } from "@/components/app/control-keys";
import { ChatSafety } from "@/components/app/settings/chat-safety";
import { ThemeSwitch } from "@/components/app/theme-switch";
import { BrandKit, type BrandPatch } from "@/components/app/scene-graphics-panel";
import { SceneRenderer } from "@/components/app/scene-renderer";
import { DEFAULT_BRAND, DEFAULT_SCENE, readBrand, type Brand, type Scene } from "@/lib/scene";

/**
 * Settings, in the same grammar as Schedule and Your channel (owner,
 * 2026-09-24: "can we do for the settings and the studio same way").
 * Sections on one page, reached from a sticky index that follows the
 * scroll: who you are (with a live preview of how people see you), your
 * encoder key, your brand, your show rules and Stream Deck keys, your chat
 * rules, what your feed leads with, and your account. Switches save the
 * moment they flip; the profile saves as one edit, with a bar that only
 * appears when there's something to save.
 */

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "streaming", label: "Streaming" },
  { id: "brand", label: "Brand" },
  { id: "rules", label: "Show rules" },
  { id: "control", label: "Stream Deck" },
  { id: "chat", label: "Chat" },
  { id: "feed", label: "Your feed" },
  { id: "appearance", label: "Appearance" },
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
  "w-full rounded-control bg-tint/[0.06] px-4 text-[15px] text-foreground outline-none shadow-[inset_0_0_0_1px_var(--hairline-color)] transition-[background-color,box-shadow] placeholder:text-muted-foreground/50 hover:bg-tint/[0.08] focus:bg-tint/[0.08] focus:shadow-[inset_0_0_0_1.5px_var(--color-ember)]";

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
        <div className="flex gap-6 overflow-x-auto shadow-[inset_0_-1px_0_var(--hairline-color)] scrollbar-none">
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
        <BrandSection />
        <RulesSection />
        <ControlSection />
        <ChatSection />
        <FeedSection />
        <AppearanceSection />
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

          <div className="mt-6 flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-tint/[0.06] pt-5">
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
                <button type="button" onClick={save} disabled={saving} className="press h-11 rounded-full bg-inverse px-6 text-[14.5px] font-semibold text-on-inverse disabled:opacity-60">
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

type Protocol = "rtmp" | "whip";
const PROTOCOLS: { id: Protocol; label: string; server: string; key: string; hint: string }[] = [
  { id: "rtmp", label: "RTMP · any encoder", server: "Server URL", key: "Stream key", hint: "Works with OBS, vMix, Streamlabs, ffmpeg — anything that streams RTMP." },
  { id: "whip", label: "WHIP · OBS 30+", server: "WHIP server", key: "Bearer token", hint: "Lower delay. In OBS 30 or later: Settings → Stream → Service: WHIP, then paste the server and the bearer token. OBS 32.1+ also sends lighter qualities for viewers on weak connections." },
];

function StreamingSection() {
  const [protocol, setProtocol] = useState<Protocol>("rtmp");
  const [keys, setKeys] = useState<Record<Protocol, { url: string; streamKey: string } | null>>({ rtmp: null, whip: null });
  const key = keys[protocol];
  const setKey = (k: { url: string; streamKey: string }) => setKeys((all) => ({ ...all, [protocol]: k }));
  const how = PROTOCOLS.find((p) => p.id === protocol)!;
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<"url" | "key" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [flash, show] = useSavedFlash();

  // Fetched on request, not on load: asking for the key sets up the account's ingress.
  const reveal = async () => {
    setLoading(true);
    try {
      const r = await apiFetch<{ success: boolean; data: { url: string; streamKey: string } }>(`/api/users/me/stream-key?protocol=${protocol}`);
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
      const r = await apiFetch<{ success: boolean; data: { url: string; streamKey: string } }>(`/api/users/me/stream-key/rotate?protocol=${protocol}`, { method: "POST" });
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
      <SectionHead id="streaming" title="Streaming" lede="Broadcast from OBS, vMix or any encoder — RTMP, or WHIP for lower delay — with credentials that never change." />
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

          {/* Which way the encoder sends: each has its own server and key. */}
          <div role="tablist" aria-label="Protocol" className="mt-5 inline-flex rounded-full bg-tint/[0.05] p-1">
            {PROTOCOLS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={protocol === p.id}
                onClick={() => {
                  setProtocol(p.id);
                  setConfirm(false);
                }}
                className={cn(
                  "press h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                  protocol === p.id ? "bg-inverse text-on-inverse" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-2.5 max-w-[62ch] text-[12.5px] leading-relaxed text-muted-foreground">{how.hint}</p>

          {key ? (
            <div className="mt-5 grid gap-3">
              <KeyRow label={how.server} value={key.url} copied={copied === "url"} onCopy={() => copy("url", key.url)} />
              <KeyRow
                label={how.key}
                value={shown ? key.streamKey : "•".repeat(Math.min(28, key.streamKey.length))}
                secret
                copied={copied === "key"}
                onCopy={() => copy("key", key.streamKey)}
                onToggle={() => setShown((v) => !v)}
                shown={shown}
              />
            </div>
          ) : (
            <div className="mt-5 flex flex-col items-start gap-3 rounded-[12px] bg-tint/[0.035] p-5">
              <p className="max-w-[52ch] text-[14px] leading-relaxed text-muted-foreground">
                Keep it private — anyone with your key can broadcast on your channel. It shows here only when you ask.
              </p>
              <button type="button" onClick={reveal} disabled={loading} className="press flex h-10 items-center gap-2 rounded-full bg-inverse px-4 text-[14px] font-semibold text-on-inverse disabled:opacity-60">
                <Eye size={16} />
                {loading ? "Loading…" : "Show my key"}
              </button>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-tint/[0.06] pt-5">
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
              <div key={k} className="flex items-baseline justify-between gap-4 border-b border-tint/[0.05] pb-3 last:border-0 last:pb-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-mono text-[12.5px] font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-auto pt-5 text-[12px] leading-relaxed text-muted-foreground/80">
            On a weak connection, 720p at 1,500–2,500 kbps keeps the picture steady. WHIP needs OBS 30 or later; 32.1+ is best.
          </p>
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
    <div className="flex items-center gap-3 rounded-[12px] bg-tint/[0.045] py-2.5 pr-2.5 pl-4">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-semibold text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate font-mono text-[13.5px] tabular-nums">{value}</p>
      </div>
      {secret && onToggle && (
        <button type="button" onClick={onToggle} aria-label={shown ? "Hide key" : "Show key"} className="press flex size-9 shrink-0 items-center justify-center rounded-full bg-tint/[0.06] text-muted-foreground hover:text-foreground">
          {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
        </button>
      )}
      <button type="button" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`} className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-tint/[0.06] px-3 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
        {copied ? <Check size={14} weight="bold" className="text-ember-hi" /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ── Brand ───────────────────────────────────────────────────────────── */

/**
 * The brand kit, set up before going live: the same controls as the
 * studio's, beside the graphics drawn the way viewers will see them.
 */
function BrandSection() {
  const { user } = useAuth();
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);
  const [flash, show] = useSavedFlash();

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ success: boolean; data: { brand: unknown } }>("/api/users/me/brand")
      .then((r) => !cancelled && setBrand(readBrand(r.data.brand)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (patch: BrandPatch) => {
    const before = brand;
    setBrand((b) => ({
      ...b,
      ...(patch.accent ? { accent: patch.accent } : {}),
      ...(patch.lowerThird ? { lowerThird: patch.lowerThird } : {}),
      ...(patch.font ? { font: patch.font } : {}),
    }));
    try {
      const r = await apiFetch<{ success: boolean; data: { brand: unknown } }>("/api/users/me/brand", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setBrand(readBrand(r.data.brand));
      show(true, "Saved");
    } catch (e) {
      setBrand(before);
      show(false, e instanceof Error ? e.message : "Couldn't save that");
      throw e;
    }
  };

  const name = user?.displayName || user?.username || "Your name";
  // The graphics a stream usually opens with, in this brand.
  const preview: Scene = {
    ...DEFAULT_SCENE,
    layers: [
      { kind: "lower-third", title: name, subtitle: "Live on Xtream" },
      { kind: "ticker", text: "Your ticker runs here — next stream, a giveaway, a thank-you" },
      ...(brand.logoUrl ? [{ kind: "logo" as const, corner: "top-right" as const }] : []),
    ],
  };

  return (
    <section id="brand" aria-labelledby="brand-title" className="scroll-mt-32">
      <SectionHead id="brand" title="Brand" lede="How your graphics look on every stream: your colour, your lower third, your title face and your logo." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className={cn(TILE, "p-6 md:p-7 lg:col-span-5")}>
          <div className="mb-1 flex items-center justify-between gap-3">
            <p className={EYEBROW}>Brand kit</p>
            <Flash flash={flash} />
          </div>
          <BrandKit brand={brand} onBrand={save} onLogoRemoved={() => {}} heading={false} />
        </div>
        <div className={cn(TILE, "flex flex-col p-3 lg:col-span-7")}>
          {/* Stays dark: this is a picture of the stream, graphics over video. */}
          <div data-theme="dark" className="relative aspect-video overflow-hidden rounded-[14px] bg-[radial-gradient(120%_90%_at_30%_20%,#3a2320_0%,#1a1012_55%,#0b0708_100%)]">
            <SceneRenderer
              scene={preview}
              portrait={false}
              main={<div aria-hidden className="size-full" />}
              guests={[]}
              host={{ name, avatar: user?.avatar }}
              brand={brand}
            />
          </div>
          <p className="mt-3 px-2 pb-1 text-[12.5px] text-muted-foreground">
            As viewers see it. Put graphics up from the Scenes tab while you&apos;re live.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Show rules ──────────────────────────────────────────────────────── */

function RulesSection() {
  return (
    <section id="rules" aria-labelledby="rules-title" className="scroll-mt-32">
      <SectionHead
        id="rules"
        title="Show rules"
        lede="When something happens on your stream, the picture answers by itself — a thank-you for a big gift, a welcome for new allies, a sound when you win a battle."
      />
      <ShowRules />
    </section>
  );
}

/* ── Stream Deck & automation ────────────────────────────────────────── */

function ControlSection() {
  return (
    <section id="control" aria-labelledby="control-title" className="scroll-mt-32">
      <SectionHead
        id="control"
        title="Stream Deck & automation"
        lede="Put the studio's buttons on a Stream Deck, in Companion or in a script — scenes, graphics, sounds, the run of show and your rules — with keys you can remove any time."
      />
      <ControlKeys />
    </section>
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
      <SectionHead id="chat" title="Chat" lede="The rules in your room, what's filtered, and who keeps it. Changes apply at once — even mid-stream." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {user && (
          <ChatSafety
            userId={user.id}
            rules={
              <div className={cn(TILE, "p-6 md:p-7")}>
                <div className="flex items-center justify-between gap-3">
                  <p className={EYEBROW}>Room rules</p>
                  <Flash flash={flash} />
                </div>
                <div className="mt-3 grid divide-y divide-tint/[0.06]">
                  <div className="py-2">
                    <SwitchField label="Slow mode" description="Thirty seconds between messages. You and your moderators are exempt." checked={values.slowMode} onCheckedChange={(v) => set("slowMode", v)} />
                  </div>
                  <div className="py-2">
                    <SwitchField label="Followers-only chat" description="Only your allies can send messages." checked={values.subscriberOnly} onCheckedChange={(v) => set("subscriberOnly", v)} />
                  </div>
                  <div className="py-2">
                    <SwitchField label="Record my streams" description="Coming soon — replays aren't available yet." checked={false} disabled />
                  </div>
                </div>
                <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
                  <Shield size={14} className="mt-px shrink-0" />
                  Shield is one tap in your room&apos;s chat while you&apos;re live: allies only, slow mode, links and scams blocked.
                </p>
              </div>
            }
          />
        )}
      </div>
    </section>
  );
}

/* ── Feed ────────────────────────────────────────────────────────────── */

function FeedSection() {
  const theme = useTheme();
  const { user, refreshUser } = useAuth();
  const [picked, setPicked] = useState<string[]>(() => user?.onboarding?.categories ?? []);
  const [language, setLanguage] = useState(() => user?.onboarding?.language || "en");
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
      {/* The first-run flow again, from the picks: covers, creators, how you'll use it. */}
      <Link
        href="/welcome?tune=1"
        className="press mb-3 flex items-center justify-between gap-3 rounded-[12px] bg-surface px-5 py-4 transition-colors hover:bg-surface-hover"
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">Tune your feed</span>
          <span className="block text-[13px] text-muted-foreground">Pick rooms from their covers, follow creators and say how you use Xtream.</span>
        </span>
        <span className="shrink-0 rounded-full bg-inverse px-4 py-2 text-[13px] font-semibold text-on-inverse">Open</span>
      </Link>
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
                <li key={c} className="group relative overflow-hidden rounded-[10px] bg-tint/[0.04] motion-safe:animate-[xt-spring-in_.4s_var(--ease-spring)_both]">
                  <div className="flex items-center gap-2.5 p-2 pr-9">
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote box art */}
                    <img src={categoryArt(c, { w: 72, h: 96 }, theme)} alt="" className="h-12 w-9 shrink-0 rounded-[6px] object-cover" />
                    <span className="line-clamp-2 text-[13px] leading-snug font-semibold">{c}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPicked((p) => p.filter((x) => x !== c))}
                    aria-label={`Remove ${c}`}
                    className="press absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-tint/[0.08] hover:text-foreground"
                  >
                    <X size={13} weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <CategoryField
              id="settings-add-interest"
              value=""
              placeholder={full ? "That's eight — remove one to add another" : "Add a category"}
              label="Add a category"
              disabled={full}
              exclude={picked}
              fly={false}
              onChange={add}
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
              className="press h-11 rounded-full bg-inverse text-[14.5px] font-semibold text-on-inverse transition-opacity disabled:opacity-40 disabled:shadow-none"
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

/** Light or dark. Saved in this browser, so it's there before you sign in. */
function AppearanceSection() {
  return (
    <section id="appearance" aria-labelledby="appearance-title" className="scroll-mt-32">
      <SectionHead id="appearance" title="Appearance" lede="Light, dark, or whatever your phone is set to." />
      <div className={cn(TILE, "flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between md:p-8")}>
        <div className="min-w-0">
          <p className="text-[15px] font-bold">Theme</p>
          <p className="mt-1 max-w-[52ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Watching, the studio and the live feed stay dark either way — the picture looks best in a dark room.
          </p>
        </div>
        <ThemeSwitch className="shrink-0" />
      </div>
    </section>
  );
}

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
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tint/[0.06]">
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
