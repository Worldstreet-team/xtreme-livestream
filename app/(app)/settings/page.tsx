"use client";

import { useState, useEffect, useRef } from "react";
import {
  User,
  Bell,
  Key,
  Shield,
  Check,
  Camera,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { compressImage } from "@/lib/image-utils";
import { UserAvatar } from "@/components/ui/user-avatar";

type SettingsTab = "profile" | "stream" | "notifications" | "security";

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // Profile state
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [username, setUsername] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Stream state
  const [autoRecord, setAutoRecord] = useState(false);
  const [chatSlowMode, setChatSlowMode] = useState(false);
  const [subscriberOnlyChat, setSubscriberOnlyChat] = useState(false);
  const [profanityFilter, setProfanityFilter] = useState(true);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initialize from user data
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setBio(user.bio || "");
      setUsername(user.username);
      setAutoRecord(user.settings.autoRecord);
      setChatSlowMode(user.settings.slowMode);
      setSubscriberOnlyChat(user.settings.subscriberOnly);
      setProfanityFilter(user.settings.profanityFilter);
    }
  }, [user]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setSaveError("Image must be under 5MB");
      return;
    }
    try {
      const base64 = await compressImage(file, 256, 0.85);
      setAvatarPreview(base64);
    } catch {
      setSaveError("Failed to process image");
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // Send only what actually changed. Posting every field meant an
      // untouched username still had to satisfy the API's validation — so a
      // profile carrying a legacy short username couldn't save a bio edit.
      const payload: Record<string, string> = {};
      if (displayName !== user.displayName) payload.displayName = displayName;
      if (username !== user.username) payload.username = username;
      if (bio !== (user.bio || "")) payload.bio = bio;
      if (avatarPreview) payload.avatar = avatarPreview;

      if (Object.keys(payload).length === 0) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        return;
      }
      await apiFetch("/api/user/me", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await refreshUser();
      setAvatarPreview(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save changes"
      );
    } finally {
      setSaving(false);
    }
  };

  const saveStreamSettings = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await apiFetch("/api/user/me", {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            autoRecord,
            slowMode: chatSlowMode,
            subscriberOnly: subscriberOnlyChat,
            profanityFilter,
          },
        }),
      });
      await refreshUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save settings"
      );
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType; comingSoon?: boolean }[] = [
    { id: "profile", label: "Profile", icon: User },
    { id: "stream", label: "Stream & Chat", icon: Key },
    { id: "notifications", label: "Notifications", icon: Bell, comingSoon: true },
    { id: "security", label: "Security", icon: Shield, comingSoon: true },
  ];

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 pt-16 md:p-8">
      <div className="mx-auto max-w-[1200px]">
      <h1 className="mb-8 text-xl font-semibold tracking-tight text-foreground">
        Settings
      </h1>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Tab navigation */}
        <nav className="flex gap-1 overflow-x-auto lg:w-56 lg:shrink-0 lg:flex-col">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                activeTab === tab.id
                  ? "bg-white/[0.08] font-medium text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              )}
            >
              <tab.icon size={18} />
              {tab.label}
              {tab.comingSoon && (
                <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground/70">
                  Soon
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 max-w-2xl">
          {/* Save feedback */}
          {saved && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-500/10 px-4 py-2.5 text-sm text-green-400">
              <Check size={16} weight="bold" />
              Changes saved successfully
            </div>
          )}
          {saveError && (
            <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
              {saveError}
            </div>
          )}

          {/* ── Profile ── */}
          {activeTab === "profile" && (
            <div className="space-y-6">
              <div className="space-y-5 rounded-lg bg-white/[0.03] p-5">
                <h2 className="text-sm font-medium text-foreground">
                  Profile information
                </h2>

                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <UserAvatar
                      src={avatarPreview || user.avatar}
                      name={user.displayName || user.username}
                      size={64}
                      className="size-16"
                    />
                    {avatarPreview && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                        <span className="text-[0.6rem] font-medium text-white">New</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      onChange={handleAvatarChange}
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <Camera size={14} className="mr-1.5" />
                      Change avatar
                    </Button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      JPG, PNG, GIF, WebP. Max 5MB.
                    </p>
                  </div>
                </div>

                {/* Display name */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="h-9 w-full rounded-lg bg-white/[0.05] px-3 text-sm text-foreground transition-colors outline-none focus:bg-white/[0.07]"
                  />
                </div>

                {/* Username */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Username
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">@</span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="h-9 flex-1 rounded-lg bg-white/[0.05] px-3 text-sm text-foreground transition-colors outline-none focus:bg-white/[0.07]"
                    />
                  </div>
                </div>

                {/* Bio */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Bio
                  </label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={3}
                    maxLength={200}
                    className="w-full resize-none rounded-lg bg-white/[0.05] px-3 py-2 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:bg-white/[0.07]"
                  />
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {bio.length}/200
                  </p>
                </div>

                <Button
                  onClick={saveProfile}
                  disabled={saving}
                  className="h-9 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/85"
                >
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          )}

          {/* ── Stream & Chat ── */}
          {activeTab === "stream" && (
            <div className="space-y-6">
              {/* OBS / RTMP pointer — keys are per-stream now */}
              <div className="space-y-3 rounded-lg bg-white/[0.03] p-5">
                <h2 className="text-sm font-medium text-foreground">
                  Stream from OBS
                </h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Server URL and stream key are generated fresh for each
                  broadcast — there&apos;s no permanent key to keep safe. Pick
                  &ldquo;OBS / RTMP&rdquo; as your source in the studio and
                  the connection details appear the moment you go live.
                </p>
                <a
                  href="/studio?source=obs"
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/[0.06] px-4 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.09]"
                >
                  <Key size={15} />
                  Open the studio
                </a>
              </div>

              {/* Stream settings */}
              <div className="space-y-4 rounded-lg bg-white/[0.03] p-5">
                <h2 className="text-sm font-medium text-foreground">
                  Stream settings
                </h2>
                <Toggle
                  label="Auto-record streams"
                  description="Automatically save a VOD of your streams (coming soon — recordings are not yet available)"
                  checked={autoRecord}
                  onChange={setAutoRecord}
                  disabled
                />
              </div>

              {/* Chat moderation */}
              <div className="space-y-4 rounded-lg bg-white/[0.03] p-5">
                <h2 className="text-sm font-medium text-foreground">
                  Chat moderation
                </h2>
                <Toggle
                  label="Slow mode"
                  description="Require 30 seconds between messages. Enforced on the server — you're exempt on your own stream."
                  checked={chatSlowMode}
                  onChange={setChatSlowMode}
                />
                <Toggle
                  label="Followers-only chat"
                  description="Only people who follow you can send messages"
                  checked={subscriberOnlyChat}
                  onChange={setSubscriberOnlyChat}
                />
                <Toggle
                  label="Profanity filter"
                  description="Automatically censor inappropriate language (coming soon — no filtering is applied yet)"
                  checked={profanityFilter}
                  onChange={setProfanityFilter}
                  disabled
                />
              </div>

              <Button
                onClick={saveStreamSettings}
                disabled={saving}
                className="h-9 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/85"
              >
                {saving ? "Saving…" : "Save stream settings"}
              </Button>
            </div>
          )}

          {/* ── Notifications (Coming Soon) ── */}
          {activeTab === "notifications" && (
            <div className="rounded-lg bg-white/[0.03] p-8 text-center">
              <Bell size={36} className="mx-auto text-muted-foreground/30" />
              <h2 className="mt-4 text-sm font-medium text-foreground">
                Notifications
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
                Notification preferences are coming soon. You&apos;ll be able to
                control email alerts, follow notifications, and more.
              </p>
              <span className="mt-4 inline-flex rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
                Coming soon
              </span>
            </div>
          )}

          {/* ── Security (Coming Soon) ── */}
          {activeTab === "security" && (
            <div className="rounded-lg bg-white/[0.03] p-8 text-center">
              <Shield size={36} className="mx-auto text-muted-foreground/30" />
              <h2 className="mt-4 text-sm font-medium text-foreground">
                Security
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
                Wallet connections, two-factor authentication, and account
                security settings are coming soon.
              </p>
              <span className="mt-4 inline-flex rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
                Coming soon
              </span>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────
// Toggle component
// ──────────────────────────────────────

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  /** For settings that are persisted but not yet acted on anywhere. */
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", disabled && "opacity-50")}>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          checked ? "bg-primary" : "bg-white/10"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
