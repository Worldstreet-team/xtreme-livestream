"use client";

import { useState } from "react";
import Image from "next/image";
import {
  User,
  Bell,
  Key,
  Shield,
  Palette,
  Copy,
  Eye,
  EyeSlash,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CURRENT_USER } from "@/lib/mock-data";

type SettingsTab = "profile" | "stream" | "notifications" | "security";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // Profile state
  const [displayName, setDisplayName] = useState(CURRENT_USER.displayName);
  const [bio, setBio] = useState(CURRENT_USER.bio);
  const [username, setUsername] = useState(CURRENT_USER.username);

  // Stream state
  const [streamKey, setStreamKey] = useState("xtws_live_a8f3k2m9x7b1n4p6");
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [autoRecord, setAutoRecord] = useState(true);
  const [chatSlowMode, setChatSlowMode] = useState(false);
  const [subscriberOnlyChat, setSubscriberOnlyChat] = useState(false);
  const [profanityFilter, setProfanityFilter] = useState(true);

  // Notification state
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [followNotifs, setFollowNotifs] = useState(true);
  const [tipNotifs, setTipNotifs] = useState(true);
  const [goLiveNotifs, setGoLiveNotifs] = useState(true);
  const [chatMentionNotifs, setChatMentionNotifs] = useState(true);

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: "profile", label: "Profile", icon: User },
    { id: "stream", label: "Stream & Chat", icon: Key },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security", icon: Shield },
  ];

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
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 max-w-2xl">
          {/* ── Profile ── */}
          {activeTab === "profile" && (
            <div className="space-y-6">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 space-y-5">
                <h2 className="text-base font-semibold text-foreground">
                  Profile Information
                </h2>

                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <Image
                    src={CURRENT_USER.avatar}
                    alt="Avatar"
                    width={64}
                    height={64}
                    className="size-16 rounded-full bg-white/10"
                  />
                  <div>
                    <Button variant="outline" size="sm">
                      Change Avatar
                    </Button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      JPG, PNG, GIF. Max 2MB.
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

                <Button className="bg-primary text-primary-foreground hover:bg-primary/80">
                  Save Changes
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
                    value={streamKey}
                    className="h-10 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-mono text-foreground"
                  />
                  <button
                    onClick={() => setShowStreamKey(!showStreamKey)}
                    className="flex size-10 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showStreamKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    onClick={() => navigator.clipboard?.writeText(streamKey)}
                    className="flex size-10 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => setStreamKey("xtws_live_" + Math.random().toString(36).slice(2, 18))}
                    className="flex size-10 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
                    title="Regenerate key"
                  >
                    <ArrowsClockwise size={16} />
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
            </div>
          )}

          {/* ── Notifications ── */}
          {activeTab === "notifications" && (
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 space-y-4">
              <h2 className="text-base font-semibold text-foreground">
                Notification Preferences
              </h2>
              <Toggle
                label="Email notifications"
                description="Receive important updates via email"
                checked={emailNotifs}
                onChange={setEmailNotifs}
              />
              <Toggle
                label="New followers"
                description="Get notified when someone follows you"
                checked={followNotifs}
                onChange={setFollowNotifs}
              />
              <Toggle
                label="Tips & donations"
                description="Get notified for crypto tips"
                checked={tipNotifs}
                onChange={setTipNotifs}
              />
              <Toggle
                label="Followed streamers go live"
                description="Get notified when streamers you follow start a stream"
                checked={goLiveNotifs}
                onChange={setGoLiveNotifs}
              />
              <Toggle
                label="Chat mentions"
                description="Get notified when someone mentions you in chat"
                checked={chatMentionNotifs}
                onChange={setChatMentionNotifs}
              />
            </div>
          )}

          {/* ── Security ── */}
          {activeTab === "security" && (
            <div className="space-y-6">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 space-y-4">
                <h2 className="text-base font-semibold text-foreground">
                  Connected Wallet
                </h2>
                <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      0x1a2B...9cD4
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Ethereum Mainnet
                    </p>
                  </div>
                  <Button variant="outline" size="sm">
                    Disconnect
                  </Button>
                </div>
                <Button variant="outline" size="sm">
                  Connect Another Wallet
                </Button>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 space-y-4">
                <h2 className="text-base font-semibold text-foreground">
                  Two-Factor Authentication
                </h2>
                <p className="text-sm text-muted-foreground">
                  Add an extra layer of security to your account.
                </p>
                <Button variant="outline" size="sm">
                  Enable 2FA
                </Button>
              </div>

              <div className="rounded-xl border border-red-500/10 bg-red-500/[0.02] p-6 space-y-4">
                <h2 className="text-base font-semibold text-red-400">
                  Danger Zone
                </h2>
                <p className="text-sm text-muted-foreground">
                  Permanently delete your channel and all associated data.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  className="bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
                >
                  Delete Channel
                </Button>
              </div>
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
