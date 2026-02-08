"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  User,
  Bell,
  Key,
  Shield,
  Copy,
  Eye,
  EyeSlash,
  ArrowsClockwise,
  Check,
  Camera,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { compressImage } from "@/lib/image-utils";

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
  const [showStreamKey, setShowStreamKey] = useState(false);
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
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const payload: Record<string, string> = { displayName, username, bio };
      if (avatarPreview) {
        payload.avatar = avatarPreview;
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
    <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">
      <h1 className="mb-6 text-2xl font-bold text-foreground">Settings</h1>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Tab navigation */}
        <nav className="flex gap-1 overflow-x-auto lg:w-56 lg:shrink-0 lg:flex-col">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors shrink-0",
                activeTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              <tab.icon size={18} />
              {tab.label}
              {tab.comingSoon && (
                <span className="ml-auto rounded-full bg-white/5 px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
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
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-2.5 text-sm text-green-400">
              <Check size={16} weight="bold" />
              Changes saved successfully
            </div>
          )}
          {saveError && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
              {saveError}
            </div>
          )}

          {/* ── Profile ── */}
          {activeTab === "profile" && (
            <div className="space-y-6">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 space-y-5">
                <h2 className="text-base font-semibold text-foreground">
                  Profile Information
                </h2>

                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Image
                      src={avatarPreview || user.avatar}
                      alt="Avatar"
                      width={64}
                      height={64}
                      className="size-16 rounded-full bg-white/10 object-cover"
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
                      Change Avatar
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
                    className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
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
                      className="h-10 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
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
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                  />
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {bio.length}/200
                  </p>
                </div>

                <Button
                  onClick={saveProfile}
                  disabled={saving}
                  className="bg-primary text-primary-foreground hover:bg-primary/80"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}

          {/* ── Stream & Chat ── */}
          {activeTab === "stream" && (
            <div className="space-y-6">
              {/* Stream key */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 space-y-4">
                <h2 className="text-base font-semibold text-foreground">
                  Stream Key
                </h2>
                <p className="text-xs text-muted-foreground">
                  Use this key in OBS, Streamlabs, or any RTMP software to stream on Xtreme Worldstreet.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type={showStreamKey ? "text" : "password"}
                    readOnly
                    value={user.streamKey}
                    className="h-10 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-mono text-foreground"
                  />
                  <button
                    onClick={() => setShowStreamKey(!showStreamKey)}
                    className="flex size-10 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showStreamKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    onClick={() => navigator.clipboard?.writeText(user.streamKey)}
                    className="flex size-10 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Copy size={16} />
                  </button>
                </div>
              </div>

              {/* Stream settings */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 space-y-4">
                <h2 className="text-base font-semibold text-foreground">
                  Stream Settings
                </h2>
                <Toggle
                  label="Auto-record streams"
                  description="Automatically save a VOD of your streams"
                  checked={autoRecord}
                  onChange={setAutoRecord}
                />
              </div>

              {/* Chat moderation */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 space-y-4">
                <h2 className="text-base font-semibold text-foreground">
                  Chat Moderation
                </h2>
                <Toggle
                  label="Slow mode"
                  description="Require 30 seconds between messages"
                  checked={chatSlowMode}
                  onChange={setChatSlowMode}
                />
                <Toggle
                  label="Subscriber-only chat"
                  description="Only followers can send messages"
                  checked={subscriberOnlyChat}
                  onChange={setSubscriberOnlyChat}
                />
                <Toggle
                  label="Profanity filter"
                  description="Automatically censor inappropriate language"
                  checked={profanityFilter}
                  onChange={setProfanityFilter}
                />
              </div>

              <Button
                onClick={saveStreamSettings}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/80"
              >
                {saving ? "Saving..." : "Save Stream Settings"}
              </Button>
            </div>
          )}

          {/* ── Notifications (Coming Soon) ── */}
          {activeTab === "notifications" && (
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center">
              <Bell size={40} className="mx-auto text-muted-foreground/40" />
              <h2 className="mt-4 text-base font-semibold text-foreground">
                Notifications
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
                Notification preferences are coming soon. You&apos;ll be able to
                control email alerts, follow notifications, and more.
              </p>
              <span className="mt-4 inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                Coming Soon
              </span>
            </div>
          )}

          {/* ── Security (Coming Soon) ── */}
          {activeTab === "security" && (
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center">
              <Shield size={40} className="mx-auto text-muted-foreground/40" />
              <h2 className="mt-4 text-base font-semibold text-foreground">
                Security
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
                Wallet connections, two-factor authentication, and account
                security settings are coming soon.
              </p>
              <span className="mt-4 inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                Coming Soon
              </span>
            </div>
          )}
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
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
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
