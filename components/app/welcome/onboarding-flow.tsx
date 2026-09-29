"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ONBOARDING_CATEGORIES } from "@xtreme/contracts";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { categoryArt } from "@/lib/category-art";
import { useTheme } from "@/lib/theme";
import { markTourSeen } from "@/lib/tour/state";
import { TourArt, type TourScene } from "@/components/app/tour/tour-art";
import { UserAvatar } from "@/components/ui/user-avatar";
import { XtreamLoader } from "@/components/ui/xtream-loader";
import type { BattleView } from "@/lib/battles";
import { CaretLeft, Check } from "@/components/icons";
import { cn } from "@/lib/utils";
import s from "./onboarding.module.css";

/**
 * The first-run flow (owner, 2026-09-29; plan and prototype in the
 * "Xtream Onboarding" artifact). A welcome, four one-decision steps and a
 * finished Home, with one drawing morphing through all of them:
 *
 *   name (your @) → what you're into → who to follow → how you'll use it
 *
 * Every step saves as it goes (POST /user/me/onboarding with `step`), so
 * leaving halfway resumes after the last one done; Skip is always there.
 * Finishing lands the welcome points and stands in for the "new look" tour.
 */

export const WELCOME_SKIP_KEY = "xtreme-welcome-seen";

type StepId = "hello" | "name" | "likes" | "creators" | "you" | "ready";
const STEPS: { id: StepId; scene: TourScene; caption: string }[] = [
  { id: "hello", scene: "play", caption: "Welcome" },
  { id: "name", scene: "rings", caption: "You" },
  { id: "likes", scene: "layers", caption: "Your picks" },
  { id: "creators", scene: "stage", caption: "Creators" },
  { id: "you", scene: "phone-live", caption: "How you'll use it" },
  { id: "ready", scene: "gift", caption: "Ready" },
];
/** The steps that ask something (the dots); hello and ready are bookends. */
const ASKS: StepId[] = ["name", "likes", "creators", "you"];

const LANGS: [string, string][] = [
  ["en", "English"],
  ["pcm", "Pidgin"],
  ["yo", "Yorùbá"],
  ["ig", "Igbo"],
  ["ha", "Hausa"],
  ["fr", "Français"],
];
function guessLanguages(): string[] {
  if (typeof navigator === "undefined") return ["en"];
  const code = navigator.language.split("-")[0]!.toLowerCase();
  return LANGS.some(([c]) => c === code) && code !== "en" ? ["en", code] : ["en"];
}

type Intent = "watch" | "create" | "both";
interface Creator {
  username: string;
  displayName: string;
  avatar: string;
  followers: number;
  verified: boolean;
  category: string;
  isLive: boolean;
  viewers: number;
}
type NameCheck = { state: "idle" | "checking" | "free" | "yours" | "taken" | "invalid"; message?: string };

const short = (c: string) => c.replace(" (Soccer)", "");
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

export function OnboardingFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, refreshUser } = useAuth();
  const theme = useTheme();
  const next = safeNext(params.get("next"));
  /** Opened on purpose from Settings ("Tune your feed"): the only way back in once it's done. */
  const tuning = params.get("tune") === "1";

  const saved = user?.onboarding;
  const [step, setStep] = useState<number>(() => resumeAt(saved?.step ?? null, isDone(saved)));
  // Finished or skipped already, and not here to tune the feed: it never shows again. Decided
  // once, on arrival — finishing it here sets completedAt too, and that must not bounce the
  // Ready screen.
  const [bounce, setBounce] = useState(() => Boolean(user) && !tuning && isDone(saved));
  const [dir, setDir] = useState<1 | -1>(1);
  const [picked, setPicked] = useState<string[]>(() => saved?.categories ?? []);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [handle, setHandle] = useState(user?.username ?? "");
  const [check, setCheck] = useState<NameCheck>({ state: "yours" });
  const [live, setLive] = useState<Record<string, number>>({});
  const [creators, setCreators] = useState<Creator[] | null>(null);
  const [follows, setFollows] = useState<string[]>([]);
  const [intent, setIntent] = useState<Intent | null>(saved?.intent ?? null);
  const [langs, setLangs] = useState<string[]>(() => saved?.languages?.length ? saved.languages : guessLanguages());
  const [alerts, setAlerts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  /** A battle live right now, to recommend at the end (practice ones are never listed). */
  const [battle, setBattle] = useState<BattleView | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** On the way out: "We're setting up your space" while Home gets ready. */
  const [leaving, setLeaving] = useState<string[] | null>(null);

  // The profile arrives after the first render on a cold load.
  const [seeded, setSeeded] = useState(Boolean(user));
  if (!seeded && user) {
    setSeeded(true);
    setDisplayName(user.displayName ?? "");
    setHandle(user.username ?? "");
    if (user.onboarding?.categories?.length) setPicked(user.onboarding.categories);
    setStep(resumeAt(user.onboarding?.step ?? null, isDone(user.onboarding)));
    if (!tuning && isDone(user.onboarding)) setBounce(true);
  }
  useEffect(() => {
    if (bounce) router.replace(next);
  }, [bounce, next, router]);

  useEffect(() => {
    apiFetch<{ success: boolean; data: { categories: { category: string; live: number }[] } }>("/api/streams/categories")
      .then((r) => setLive(Object.fromEntries(r.data.categories.map((c) => [c.category, c.live]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  // The busiest battle on right now, in their picks if there is one.
  useEffect(() => {
    if (STEPS[step]!.id !== "you") return;
    apiFetch<{ success: boolean; data: { battles: BattleView[] } }>("/api/battles/live")
      .then((r) => {
        const all = r.data.battles ?? [];
        setBattle(all[0] ?? null);
      })
      .catch(() => {});
  }, [step]);

  // The @ as you type: free, yours, taken or not allowed.
  const handleKey = handle.trim().toLowerCase();
  useEffect(() => {
    if (!handleKey) return;
    if (handleKey === user?.username) {
      setCheck({ state: "yours" });
      return;
    }
    setCheck({ state: "checking" });
    const t = setTimeout(() => {
      apiFetch<{ success: boolean; data: { available: boolean; reason: "taken" | "invalid" | "yours" | null; message?: string } }>(
        `/api/users/username-available?username=${encodeURIComponent(handleKey)}`,
      )
        .then((r) =>
          setCheck(
            r.data.available
              ? { state: r.data.reason === "yours" ? "yours" : "free" }
              : { state: r.data.reason === "invalid" ? "invalid" : "taken", message: r.data.message },
          ),
        )
        .catch(() => setCheck({ state: "idle" }));
    }, 350);
    return () => clearTimeout(t);
  }, [handleKey, user?.username]);

  // Creators, once the picks are in.
  const pickKey = picked.join(",");
  useEffect(() => {
    if (STEPS[step]!.id !== "creators") return;
    setCreators(null);
    apiFetch<{ success: boolean; data: { creators: Creator[] } }>(`/api/onboarding/creators?limit=8&categories=${encodeURIComponent(pickKey)}`)
      .then((r) => setCreators(r.data.creators))
      .catch(() => setCreators([]));
  }, [step, pickKey]);

  const id = STEPS[step]!.id;
  const go = (to: number) => {
    setError(null);
    setDir(to > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, to)));
  };
  const indexOf = (sid: StepId) => STEPS.findIndex((x) => x.id === sid);

  /** Saves a step's answers on the way through; never blocks the next step. */
  const saveStep = (sid: "name" | "likes" | "creators" | "you", extra: Record<string, unknown> = {}) => {
    void apiFetch("/api/user/me/onboarding", { method: "POST", body: JSON.stringify({ categories: picked, step: sid, ...extra }) }).catch(() => {});
  };

  /**
   * Out of the flow, never straight into a half-loaded page: the Xtream mark
   * and a few lines about what's being set up, while the account refreshes
   * and the next page is fetched (at least long enough to read a line).
   */
  const leave = (to = next, lines?: string[]) => {
    try {
      localStorage.setItem(WELCOME_SKIP_KEY, "1");
    } catch {
      // Storage off: the account's record still says so.
    }
    const picks = picked.slice(0, 2).map(short);
    setLeaving(
      lines ?? [
        "We're setting up your space",
        picks.length ? `Lining up ${picks.join(" and ")}` : "Lining up what's big right now",
        follows.length ? `Tuning in to the ${follows.length} you follow` : "Checking who's live right now",
        "Almost there",
      ],
    );
    router.prefetch(to);
    const ready = Promise.all([refreshUser().catch(() => {}), new Promise((r) => setTimeout(r, 2600))]);
    void ready.then(() => router.replace(to));
  };

  const skip = async () => {
    void apiFetch("/api/user/me/onboarding", { method: "POST", body: JSON.stringify({ categories: picked, skipped: true }) }).catch(() => {});
    leave(next, ["Taking you home", "Home starts with what's big right now"]);
  };

  const submitName = async () => {
    const nameChanged = displayName.trim() && displayName.trim() !== user?.displayName;
    const handleChanged = handleKey && handleKey !== user?.username;
    if (handleChanged && check.state !== "free") return;
    setBusy(true);
    try {
      if (nameChanged || handleChanged) {
        await apiFetch("/api/user/me", {
          method: "PATCH",
          body: JSON.stringify({ ...(nameChanged ? { displayName: displayName.trim() } : {}), ...(handleChanged ? { username: handleKey } : {}) }),
        });
        void refreshUser();
      }
      saveStep("name");
      go(indexOf("likes"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setCheck({ state: "taken" });
      else setError("That didn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleFollow = async (c: Creator) => {
    const on = follows.includes(c.username);
    setFollows((f) => (on ? f.filter((x) => x !== c.username) : [...f, c.username]));
    try {
      await apiFetch(`/api/user/${encodeURIComponent(c.username)}/follow`, { method: on ? "DELETE" : "POST" });
    } catch {
      setFollows((f) => (on ? [...f, c.username] : f.filter((x) => x !== c.username)));
    }
  };
  const followAll = async (list: Creator[]) => {
    const todo = list.filter((c) => !follows.includes(c.username));
    setFollows((f) => [...f, ...todo.map((c) => c.username)]);
    const failed: string[] = [];
    for (const c of todo) {
      try {
        await apiFetch(`/api/user/${encodeURIComponent(c.username)}/follow`, { method: "POST" });
      } catch {
        failed.push(c.username);
      }
    }
    if (failed.length) setFollows((f) => f.filter((x) => !failed.includes(x)));
  };

  const finish = async () => {
    setBusy(true);
    try {
      const r = await apiFetch<{ success: boolean; data?: { welcomePoints: number | null } }>("/api/user/me/onboarding", {
        method: "POST",
        body: JSON.stringify({ categories: picked, languages: langs, intent: intent ?? "watch", alerts }),
      });
      setPoints(r.data?.welcomePoints ?? null);
      // This flow is the new person's tour of the place; the "new look" one is for everyone else.
      if (user) markTourSeen("new-look", user.id);
      if (alerts && typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => {});
      }
      go(indexOf("ready"));
    } catch {
      setError("That didn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------------------------------------- the steps */

  let head: ReactNode = null;
  let body: ReactNode = null;
  let primary: { label: string; onClick: () => void; disabled?: boolean };

  if (id === "hello") {
    const first = (user?.displayName || "").split(" ")[0];
    head = (
      <>
        <p className={s.eyebrow}>Welcome to Xtream</p>
        <h1 className={s.title}>{first ? `Hey ${first}, let's make it yours` : "Let's make it yours"}</h1>
        <p className={s.line}>A few quick taps and Home fills with the rooms you&rsquo;ll actually want. About 30 seconds.</p>
      </>
    );
    body = (
      <ol className={s.timeline} aria-label="What's ahead">
        {[
          ["Your name and @", "How people find and mention you"],
          ["What you're into", "So Home leads with it"],
          ["Who to follow", "So you hear the moment they go live"],
          ["How you'll use it", "Watch, go live and battle, or a bit of both"],
        ].map(([t, l], i) => (
          <li key={t} style={{ "--i": i } as CSSProperties}>
            <span className={s.node}>{i + 1}</span>
            <span className={s.stop}>
              <b>{t}</b>
              <span>{l}</span>
            </span>
          </li>
        ))}
        <li className={s.end} style={{ "--i": 4 } as CSSProperties}>
          <span className={s.node}>
            <Check size={14} weight="bold" />
          </span>
          <span className={s.stop}>
            <b>Your Home, ready</b>
            <span>About 30 seconds from now</span>
          </span>
        </li>
      </ol>
    );
    primary = { label: "Let's go", onClick: () => go(1) };
  } else if (id === "name") {
    const status =
      check.state === "checking"
        ? { text: "Checking…", tone: "" }
        : check.state === "free"
          ? { text: "It's yours if you want it", tone: s.ok }
          : check.state === "yours"
            ? { text: "That's you", tone: s.ok }
            : check.state === "taken"
              ? { text: "Taken. Try another", tone: s.bad }
              : check.state === "invalid"
                ? { text: check.message ?? "3 to 30 letters, numbers or underscores", tone: s.bad }
                : { text: "", tone: "" };
    const base = handleKey.replace(/[^a-z0-9_]/g, "").slice(0, 24) || "me";
    const ideas = check.state === "taken" ? [`${base}_tv`, `${base}_live`, `${base}${new Date().getFullYear() % 100}`] : [];
    head = (
      <>
        <h1 className={s.title}>What should people call you?</h1>
        <p className={s.line}>Your name shows on your channel and in chat. Your @ is how people find and mention you.</p>
      </>
    );
    body = (
      <div className="flex flex-col gap-4">
        <label className={s.field}>
          <span className={s.label}>Name</span>
          <input id="ob-name" value={displayName} maxLength={80} autoComplete="name" onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
        </label>
        <label className={s.field}>
          <span className={s.label}>Username</span>
          <span className={s.at}>
            <span aria-hidden>@</span>
            <input
              id="ob-handle"
              value={handle}
              maxLength={30}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
              placeholder="yourname"
              aria-describedby="ob-handle-status"
            />
            {(check.state === "free" || check.state === "yours") && <Check size={16} weight="bold" className={s.ok} aria-hidden />}
          </span>
          <span id="ob-handle-status" className={cn(s.status, status.tone)} aria-live="polite">
            {status.text}
          </span>
        </label>
        {ideas.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ideas.map((i) => (
              <button key={i} type="button" className={s.chip} onClick={() => setHandle(i)}>
                @{i}
              </button>
            ))}
          </div>
        )}
      </div>
    );
    const handleOk = !handleKey || check.state === "free" || check.state === "yours";
    primary = { label: busy ? "Saving…" : "Continue", onClick: () => void submitName(), disabled: busy || !displayName.trim() || !handleOk };
  } else if (id === "likes") {
    head = (
      <>
        <h1 className={s.title}>What are you into?</h1>
        <p className={s.line}>Pick three or more. Home leads with what you choose, and you can change it any time.</p>
      </>
    );
    body = (
      <div className={s.covers}>
        {ONBOARDING_CATEGORIES.map((c) => {
          const on = picked.includes(c);
          const order = picked.indexOf(c) + 1;
          const n = live[c] ?? 0;
          return (
            <button
              key={c}
              type="button"
              className={cn(s.cover, on && s.coverOn)}
              aria-pressed={on}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c) : [...p, c]))}
            >
              <span className={s.coverImg}>
                {/* eslint-disable-next-line @next/next/no-img-element -- our own generated cover */}
                <img src={categoryArt(c, { w: 240, h: 240 }, theme)} alt="" draggable={false} />
                <span className={s.check} aria-hidden>
                  {on ? order : ""}
                </span>
              </span>
              <span className={s.coverName}>{c}</span>
              <span className={s.coverLive}>
                {n > 0 ? (
                  <>
                    <i /> {n} live
                  </>
                ) : (
                  "Nobody live right now"
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
    primary = {
      label: picked.length >= 3 ? `Continue · ${picked.length} picked` : picked.length === 0 ? "Pick a few to continue" : `Pick ${3 - picked.length} more, or continue`,
      onClick: () => {
        saveStep("likes");
        go(indexOf("creators"));
      },
      disabled: picked.length === 0,
    };
  } else if (id === "creators") {
    const list = creators ?? [];
    const all = list.length > 0 && list.every((c) => follows.includes(c.username));
    head = (
      <>
        <h1 className={s.title}>Follow a few creators</h1>
        <p className={s.line}>Live now and loved in your picks. You&rsquo;ll hear the moment they go live.</p>
      </>
    );
    body = (
      <>
        <div className={s.listHead}>
          <span>Picked for you</span>
          {list.length > 0 && (
            <button type="button" className={s.linkish} onClick={() => (all ? undefined : void followAll(list))} disabled={all}>
              {all ? "Following all" : `Follow all ${list.length}`}
            </button>
          )}
        </div>
        {creators === null ? (
          <ul className={s.creators} aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className={s.ghost} />
            ))}
          </ul>
        ) : list.length === 0 ? (
          <p className={s.line}>Nobody to suggest yet. Follow people as you find them.</p>
        ) : (
          <ul className={s.creators}>
            {list.map((c) => {
              const on = follows.includes(c.username);
              return (
                <li key={c.username}>
                  <UserAvatar src={c.avatar} name={c.displayName} size={44} ring={c.isLive ? "live" : undefined} />
                  <div className={s.who}>
                    <b>{c.displayName}</b>
                    <span>
                      {c.isLive ? (
                        <>
                          <em className={s.liveDot} /> Live · {compact(c.viewers)} watching
                        </>
                      ) : (
                        <>{compact(c.followers)} allies</>
                      )}
                      {c.category && (
                        <>
                          <span className={s.sep}>·</span>
                          {short(c.category)}
                        </>
                      )}
                    </span>
                  </div>
                  <button type="button" className={cn(s.follow, on && s.following)} aria-pressed={on} onClick={() => void toggleFollow(c)}>
                    {on ? "Following" : "Follow"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
    primary = {
      label: follows.length ? `Continue · following ${follows.length}` : "Continue",
      onClick: () => {
        saveStep("creators");
        go(indexOf("you"));
      },
    };
  } else if (id === "you") {
    const options: { id: Intent; title: string; line: string }[] = [
      { id: "watch", title: "Mostly watch", line: "Rooms, gifts and chats" },
      { id: "create", title: "Go live", line: "Your own channel, gifts and battles with other hosts" },
      { id: "both", title: "A bit of both", line: "Watch now, go live when you're ready" },
    ];
    head = (
      <>
        <h1 className={s.title}>How will you use Xtream?</h1>
        <p className={s.line}>We&rsquo;ll set things up around it. Nothing is locked in.</p>
      </>
    );
    body = (
      <>
        <div className={s.intents} role="radiogroup" aria-label="How you'll use Xtream">
          {options.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={intent === o.id} className={cn(s.intent, intent === o.id && s.intentOn)} onClick={() => setIntent(o.id)}>
              <span className={cn(s.glyph, s[`g_${o.id}`])} aria-hidden />
              <b>{o.title}</b>
              <span>{o.line}</span>
            </button>
          ))}
        </div>
        <p className={s.sub}>Languages you watch in</p>
        <div className="flex flex-wrap gap-2">
          {LANGS.map(([code, name]) => {
            const on = langs.includes(code);
            return (
              <button key={code} type="button" className={cn(s.chip, on && s.chipOn)} aria-pressed={on} onClick={() => setLangs((l) => (on ? l.filter((x) => x !== code) : [...l, code]))}>
                {name}
              </button>
            );
          })}
        </div>
        <label className={s.switch}>
          <span>
            <b>Tell me when they go live</b>
            <span>{follows.length ? `The ${follows.length} you follow` : "Creators you follow"}, and big rooms in your picks</span>
          </span>
          <input id="ob-alerts" type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} />
          <i aria-hidden />
        </label>
      </>
    );
    primary = { label: busy ? "Saving…" : "Finish", onClick: () => void finish(), disabled: busy || intent === null };
  } else {
    const lead = picked.slice(0, 3).map(short);
    const leads = lead.length === 1 ? lead[0] : `${lead.slice(0, -1).join(", ")} and ${lead[lead.length - 1]}`;
    head = (
      <>
        <p className={s.eyebrow}>All set</p>
        <h1 className={s.title}>Your Xtream is ready</h1>
        <p className={s.line}>
          {lead.length ? `Home now leads with ${leads}.` : "Home starts with what's popular, and learns from what you watch."}
          {follows.length ? ` You're following ${follows.length}.` : ""}
        </p>
      </>
    );
    body = (
      <>
        {points !== null && (
          <div className={s.gift}>
            <span className={s.pts}>+{points}</span>
            <div>
              <b>Welcome points</b>
              <span>Watching, chatting and calling it earn more. 1,000 points is $1.</span>
            </div>
          </div>
        )}
        <p className={s.sub}>A peek at your Home</p>
        <div className={s.peek}>
          {(picked.length ? picked : ["Just Chatting", "Crypto Markets"]).slice(0, 4).map((p) => (
            <div key={p}>
              {/* eslint-disable-next-line @next/next/no-img-element -- our own generated cover */}
              <img src={categoryArt(p, { w: 320, h: 180 }, theme)} alt="" />
              <span>Because you like {short(p)}</span>
            </div>
          ))}
        </div>
        {battle && (
          <>
            <p className={s.sub}>Battle live now</p>
            <button type="button" className={s.battle} onClick={() => leave(`/stream/${battle.host.streamId}`)}>
              <span className={s.faces}>
                <UserAvatar src={battle.host.avatar} name={battle.host.displayName} size={40} ring="live" />
                <span className={s.vs}>vs</span>
                <UserAvatar src={battle.challenger.avatar} name={battle.challenger.displayName} size={40} ring="live" />
              </span>
              <span className={s.battleText}>
                <b>
                  {battle.host.displayName} vs {battle.challenger.displayName}
                </b>
                <span>Two hosts, one clock. Gifts are the score.</span>
              </span>
              <span className={s.watch}>Watch</span>
            </button>
          </>
        )}
        {(intent === "create" || intent === "both") && (
          <div className={s.tryRow}>
            <button type="button" className={s.secondary} onClick={() => leave("/studio?practice=1", ["Setting up your studio", "A practice run nobody else sees"])}>
              <span className={cn(s.glyph, s.g_create, s.glyphSm)} aria-hidden /> Try a practice run
            </button>
            <button type="button" className={s.secondary} onClick={() => leave("/studio?practice=1&battle=1", ["Setting up your studio", "Your sparring partner is warming up"])}>
              <span className={cn(s.glyph, s.g_battle, s.glyphSm)} aria-hidden /> Try a practice battle
            </button>
          </div>
        )}
      </>
    );
    primary = { label: "Take me home", onClick: () => leave() };
  }

  if (bounce) {
    return (
      <div className={s.ob}>
        <XtreamLoader messages={["Taking you home"]} />
      </div>
    );
  }

  const askIndex = ASKS.indexOf(id);
  return (
    <div className={s.ob}>
      {leaving && <XtreamLoader messages={leaving} className="z-10" />}
      <div className={s.shell}>
      <div className={s.art}>
        <div className={s.artBox}>
          <TourArt scene={STEPS[step]!.scene} className="size-full overflow-visible" />
        </div>
        <p className={s.caption} key={id}>
          {STEPS[step]!.caption}
        </p>
      </div>
      <div className={s.main}>
        <div className={s.top}>
          {askIndex >= 0 ? (
            <>
              <button type="button" className={s.back} onClick={() => go(step - 1)} aria-label="Back">
                <CaretLeft size={18} weight="bold" />
              </button>
              <div className={s.progress} aria-label={`Step ${askIndex + 1} of ${ASKS.length}`}>
                {ASKS.map((a, i) => (
                  <span key={a} className={cn(i < askIndex && s.done, i === askIndex && s.on)} />
                ))}
              </div>
              <button type="button" className={s.skip} onClick={() => void skip()}>
                Skip
              </button>
            </>
          ) : null}
        </div>
        {/* The step's title and line stay put; only what's under them scrolls. */}
        <div className={cn(s.head, dir === 1 ? s.inFwd : s.inBack)} key={`h-${step}`}>
          {head}
        </div>
        <div className={s.body} ref={bodyRef}>
          <div className={dir === 1 ? s.inFwd : s.inBack} key={`b-${step}`}>
            {body}
          </div>
        </div>
        <div className={s.foot}>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.actions}>
            {id === "hello" && (
              <button type="button" className={s.quiet} onClick={() => void skip()}>
                Skip for now
              </button>
            )}
            <button type="button" className={s.primary} onClick={primary.onClick} disabled={primary.disabled}>
              {primary.label}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

/** Finished or skipped: the flow has had its turn. */
function isDone(o: { completedAt?: string | null; skippedAt?: string | null } | undefined) {
  return Boolean(o?.completedAt || o?.skippedAt);
}

/** Where a half-done flow picks up: the step after the last one saved. */
function resumeAt(last: string | null, completed: boolean) {
  if (completed) return 2; // Coming back to tune the feed: straight to the picks.
  const order: (string | null)[] = [null, "name", "likes", "creators", "you"];
  const i = order.indexOf(last);
  return i <= 0 ? 0 : Math.min(i + 1, 4);
}

/** Only ever a page of ours. */
function safeNext(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/welcome")) return "/explore";
  return raw;
}
