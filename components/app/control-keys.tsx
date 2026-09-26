"use client";

import { useEffect, useState } from "react";
import { CONTROL_SCOPES, MAX_CONTROL_KEYS, type ControlKeyView, type ControlScope } from "@xtreme/contracts";
import { Check, Copy, Key, Trash, Warning } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { apiFetch, apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";
const INPUT =
  "h-10 w-full min-w-0 rounded-full bg-white/[0.06] px-4 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09]";

const SCOPE_LABELS: Record<ControlScope, { label: string; hint: string }> = {
  scene: { label: "Scene", hint: "layouts, cards, lower thirds, banners, countdowns" },
  sound: { label: "Sounds", hint: "the audio desk's pads" },
  show: { label: "Run of show", hint: "start, next, stop — with each segment's cues" },
  rules: { label: "Rules", hint: "fire a show rule by hand" },
};

/** What a few buttons send — copied straight into Companion or a script. */
const EXAMPLES: { label: string; method: "POST" | "GET"; path: string; body?: string; stream?: boolean; note?: string }[] = [
  { label: "Be right back", method: "POST", path: "/control/do", body: '{"actions":[{"do":"card","card":"brb"}]}' },
  { label: "Back from the break", method: "POST", path: "/control/do", body: '{"actions":[{"do":"card","card":null}]}' },
  { label: "Next segment", method: "POST", path: "/control/show", body: '{"step":"next"}' },
  { label: "Airhorn", method: "POST", path: "/control/do", body: '{"actions":[{"do":"sound","pad":"airhorn"}]}' },
  { label: "What's on", method: "GET", path: "/control/state" },
  {
    label: "Events, as they happen",
    method: "GET",
    path: "/control/events",
    stream: true,
    note: "Server-sent events: whether you're live first, then each scene change, rule firing, gift or guest as event: and its JSON. Chat isn't in it.",
  },
];

/** A curl for an example — `-N` for the feed, so nothing waits on a buffer. */
const curlFor = (base: string, e: (typeof EXAMPLES)[number]) =>
  e.stream
    ? `curl -N ${base}${e.path} -H "Authorization: Bearer xck_…"`
    : `curl -X ${e.method} ${base}${e.path} -H "Authorization: Bearer xck_…"${e.body ? ` -H "Content-Type: application/json" -d '${e.body}'` : ""}`;

/** The MCP server (packages/control-mcp), added to Claude Code in one line; the API base rides along so it needn't be localhost. */
const mcpAddFor = (base: string) => `claude mcp add xtream -e XTREAM_CONTROL_KEY=xck_… -e XTREAM_API_URL=${base} -- node packages/control-mcp/dist/index.js`;

function ago(iso: string | null) {
  if (!iso) return "never used";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "used just now";
  if (s < 3600) return `used ${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `used ${Math.floor(s / 3600)} h ago`;
  return `used ${Math.floor(s / 86_400)} days ago`;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          })
          .catch(() => {});
      }}
      className="press flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-[12px] font-semibold text-foreground hover:bg-white/[0.12]"
    >
      {done ? <Check size={13} weight="bold" /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </button>
  );
}

/**
 * Stream Deck & automation (Phase 3, control API): keys for a Stream Deck,
 * Companion or a script, each allowed only what it needs, and the requests
 * their buttons send. A key is shown once, when it's made.
 */
export function ControlKeys() {
  const [keys, setKeys] = useState<ControlKeyView[] | null>(null);
  const [name, setName] = useState("Stream Deck");
  const [scopes, setScopes] = useState<ControlScope[]>(["scene", "sound", "show"]);
  const [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<{ success: boolean; data: { keys: ControlKeyView[] } }>("/api/users/me/control-keys")
      .then((r) => alive && setKeys(r.data.keys))
      .catch(() => alive && setProblem("Couldn't load your keys — try again in a moment."));
    return () => {
      alive = false;
    };
  }, []);

  const make = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { key: ControlKeyView; secret: string } }>("/api/users/me/control-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || "Stream Deck", scopes }),
      });
      setKeys((cur) => [...(cur ?? []), r.data.key]);
      setFresh({ name: r.data.key.name, secret: r.data.secret });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't make that key");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setProblem(null);
    setKeys((cur) => (cur ?? []).filter((k) => k.id !== id));
    try {
      await apiFetch(`/api/users/me/control-keys/${id}`, { method: "DELETE" });
    } catch {
      setProblem("Couldn't remove that key — try again.");
    }
  };

  const base = apiUrl("/api").startsWith("/") && typeof window !== "undefined" ? `${window.location.origin}/api` : apiUrl("/api");
  const full = (keys?.length ?? 0) >= MAX_CONTROL_KEYS;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <div className={cn(TILE, "p-5 md:p-6 lg:col-span-7")}>
        <p className={EYEBROW}>Your keys</p>
        {problem && <p className="mt-3 rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">{problem}</p>}

        {fresh && (
          <div className="mt-3 rounded-[14px] bg-ember/[0.1] p-4">
            <p className="flex items-center gap-2 text-[13.5px] font-semibold">
              <Warning size={15} className="text-ember-hi" />
              Copy “{fresh.name}” now — it won&apos;t be shown again
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-full bg-black/30 px-3.5 py-2 font-mono text-[12px]">{fresh.secret}</code>
              <CopyButton text={fresh.secret} />
            </div>
            <button type="button" onClick={() => setFresh(null)} className="mt-2.5 text-[12px] font-semibold text-ember-hi hover:underline">
              I&apos;ve saved it
            </button>
          </div>
        )}

        {keys === null ? (
          !problem && <div className="mt-3 h-20 animate-pulse rounded-[14px] bg-white/[0.04]" />
        ) : keys.length === 0 ? (
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">No keys yet. Make one for each device or script, so you can remove one without the others.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 rounded-[14px] bg-white/[0.045] px-3.5 py-3">
                <Key size={16} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">{k.name}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    <span className="font-mono">{k.prefix}…</span> · {k.scopes.map((s) => SCOPE_LABELS[s].label).join(", ")} · {ago(k.lastUsedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(k.id)}
                  aria-label={`Remove ${k.name}`}
                  className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-chili/15 hover:text-chili-hi"
                >
                  <Trash size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!full && (
          <div className="mt-5 border-t border-white/[0.06] pt-5">
            <p className="text-[13.5px] font-semibold">Make a key</p>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Key name" placeholder="Stream Deck" className={cn(INPUT, "mt-2.5")} />
            <div role="group" aria-label="What it can do" className="mt-3 flex flex-col gap-1.5">
              {CONTROL_SCOPES.map((s) => {
                const on = scopes.includes(s);
                return (
                  <label key={s} className="flex cursor-pointer items-start gap-3 rounded-[12px] px-1 py-1.5">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setScopes((cur) => (on ? cur.filter((x) => x !== s) : [...cur, s]))}
                      className="mt-0.5 size-4.5 shrink-0 accent-ember"
                    />
                    <span className="text-[13px] leading-snug">
                      <span className="font-semibold">{SCOPE_LABELS[s].label}</span> <span className="text-muted-foreground">— {SCOPE_LABELS[s].hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <Pill className="mt-3" variant="primary" onClick={() => void make()} disabled={busy || scopes.length === 0}>
              {busy ? "Making…" : "Make key"}
            </Pill>
          </div>
        )}
      </div>

      <aside className={cn(TILE, "p-5 md:p-6 lg:col-span-5")}>
        <p className={EYEBROW}>Buttons that work</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
          In Companion, use the Generic HTTP module; in a script, any HTTP client. Send the key as{" "}
          <code className="font-mono text-[11.5px] text-foreground/85">Authorization: Bearer xck_…</code> and the body as JSON.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {EXAMPLES.map((e) => (
            <li key={e.label} className="rounded-[12px] bg-white/[0.045] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">{e.label}</p>
                <CopyButton text={curlFor(base, e)} label="curl" />
              </div>
              <p className="mt-1.5 truncate font-mono text-[11.5px] text-muted-foreground">
                {e.method} {e.path}
              </p>
              {e.body && <p className="mt-0.5 truncate font-mono text-[11.5px] text-foreground/75">{e.body}</p>}
              {e.note && <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{e.note}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          Actions are the show rules&apos; — lower_third, banner, card, layout, countdown, hide, sound. Next puts up a segment&apos;s cues, its sponsor
          card included, from the host&apos;s own sponsors.
        </p>

        <div className="mt-5 border-t border-white/[0.06] pt-5">
          <p className={EYEBROW}>Claude and other assistants</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            An MCP server puts the same buttons in Claude Code, Claude Desktop or any MCP client. It signs in with a key, so it can only do what the key
            can.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-full bg-black/30 px-3.5 py-2 font-mono text-[11.5px] text-foreground/85">{mcpAddFor(base)}</code>
            <CopyButton text={mcpAddFor(base)} />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            Build it once with <code className="font-mono text-[11.5px] text-foreground/85">npm run build -w @xtreme/control-mcp</code>; the package&apos;s README
            has the Claude Desktop config.
          </p>
        </div>
      </aside>
    </div>
  );
}
