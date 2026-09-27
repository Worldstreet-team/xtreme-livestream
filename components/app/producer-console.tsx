"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChatText,
  Check,
  HandWaving,
  LayoutIcon,
  Playlist,
  SkipForward,
  SpeakerHigh,
  SpeakerSlash,
  UsersThree,
  Warning,
  X,
} from "@/components/icons";
import { CapsuleTabs, type CapsuleTab } from "@/components/ui/capsule-tabs";
import { LiveBadge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Empty } from "@/components/app/empty";
import { LiveChat } from "@/components/app/live-chat";
import { SceneRenderer, type SceneCell } from "@/components/app/scene-renderer";
import { AwayTile, StageTile } from "@/components/app/stage-tile";
import { LayoutAndCards } from "@/components/app/scene-controls";
import { SceneGraphicsPanel } from "@/components/app/scene-graphics-panel";
import { FeaturedPanel } from "@/components/app/featured-panel";
import { RunOfShow } from "@/components/app/run-of-show";
import { InterpreterToggle, StageLineControl, StandingLine, readStageLine, readStanding, type StageLineRule, type StageStanding } from "@/components/app/stage-line";
import { LivePreview, PreviewVideo, hostTrackOf, useRoomPreview } from "@/components/app/live-preview";
import { apiFetch } from "@/lib/api-client";
import { isBattleActive, sideOf, type BattleView } from "@/lib/battles";
import { newerGoal, newerHeat, readGoal, readHeat } from "@/lib/goals";
import { AngleSwitch } from "@/components/app/second-camera-panel";
import { useConsole, useConsoleRoom, type ConsoleData, type ConsoleStream } from "@/lib/producer";
import { applyCues, formatClock, readPosition, readSegments, type RundownPosition, type RundownSegment } from "@/lib/rundown";
import { CARDS, DEFAULT_SCENE, guestsShown, layerOf, newerScene, readBrand, readFeatureQueue, readScene, sceneFromMetadata, withLayer, type Scene } from "@/lib/scene";
import { serverNow, serverOffset } from "@/lib/server-clock";
import { MAX_PRICE_SYMBOLS } from "@xtreme/contracts";
import { readTickers, type Trending } from "@/lib/market";
import { TickerChips } from "@/components/app/ticker-chips";
import { MarketSuggestions } from "@/components/app/market-suggestions";
import { useMarketSuggestions } from "@/lib/market-suggestions";
import { cueSponsorsOf } from "@/lib/sponsors";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
/** The cards as the bar under the picture names them — three to a phone's width. */
const CARD_SHORT: Record<(typeof CARDS)[number]["id"], string> = { "starting-soon": "Starting soon", brb: "Be right back", ending: "Thanks" };
/** The API's own limits (guests.ts): three guests beside the host, four waiting backstage. */
const MAX_STAGE_GUESTS = 3;
const MAX_BACKSTAGE = 4;

type Tab = "scenes" | "show" | "stage" | "chat";
type StageUser = { userId: string; username: string; avatar: string; standing?: StageStanding | null };
type ScenePatch = Partial<Pick<Scene, "layout" | "card" | "cardNote" | "layers" | "chart" | "spotlight" | "interpreter" | "angle">>;

/**
 * Producer mode (Phase 3): the console at /produce/<channel>. The host on a
 * second device — a laptop beside the phone they stream from — or a
 * producer they've named runs the show from here: the program as viewers
 * see it, the scenes and graphics, the run of show, the stage and the chat.
 * Nothing here publishes; every change goes through the routes the studio
 * uses, and the studio follows along (its prompter too).
 */
export function ProducerConsole({ username }: { username: string }) {
  const { state, reload } = useConsole(username);
  /** The room closed under us: the stream is over (or about to say so). */
  const [ended, setEnded] = useState(false);
  /** This console was opened on another device under the same identity; that one has the room now. */
  const [elsewhere, setElsewhere] = useState(false);
  // A room that let go for any other reason is tried again after a breath, never in a tight loop.
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retry.current) clearTimeout(retry.current);
    },
    []
  );
  const onClosed = useCallback(
    (why: "ended" | "dropped" | "elsewhere") => {
      if (retry.current) clearTimeout(retry.current);
      if (why === "elsewhere") {
        // Two consoles under one identity would kick each other out forever: this one stands down.
        setElsewhere(true);
        return;
      }
      if (why === "ended") setEnded(true);
      retry.current = setTimeout(reload, why === "ended" ? 0 : 3000);
    },
    [reload]
  );

  if (state.status === "loading") return <ConsoleSkeleton />;
  if (state.status === "missing") {
    return (
      <Empty
        icon={<UsersThree size={22} />}
        title={`There's no channel called @${username}`}
        body="Check the link — it's /produce/ and the host's username."
        goLive={false}
        action={{ label: "Browse live channels", href: "/browse" }}
      />
    );
  }
  if (state.status === "denied") {
    return (
      <Empty
        icon={<UsersThree size={22} />}
        title="This console is for the host's crew"
        body={`${state.message}. The host names producers in Settings → Chat & safety.`}
        goLive={false}
        action={{ label: "Go to their channel", href: `/c/${username}` }}
      />
    );
  }
  if (state.status === "error") {
    return <Empty icon={<Warning size={22} />} title="Couldn't reach the channel" body={state.message} goLive={false} />;
  }

  const { data } = state;
  if (elsewhere) {
    return (
      <Empty
        icon={<UsersThree size={22} />}
        title="This console is open somewhere else"
        body="Another device is running it under your name — a phone in the other room, or another tab. Only one can at a time."
        goLive={false}
        action={{
          label: "Use it here instead",
          onClick: () => {
            setElsewhere(false);
            reload();
          },
        }}
      />
    );
  }
  if (!data.stream || !data.token || !data.url) return <OffAir data={data} ended={ended} />;
  return <LiveConsole key={data.stream.id} data={data} stream={data.stream} token={data.token} url={data.url} onClosed={onClosed} />;
}

/* ------------------------------------------------------------------ */
/* Live                                                                */
/* ------------------------------------------------------------------ */

function LiveConsole({
  data,
  stream,
  token,
  url,
  onClosed,
}: {
  data: ConsoleData;
  stream: ConsoleStream;
  token: string;
  url: string;
  onClosed: (why: "ended" | "dropped" | "elsewhere") => void;
}) {
  const { host } = data;
  const [scene, setScene] = useState<Scene>(() => readScene(stream.scene) ?? DEFAULT_SCENE);
  const [brand, setBrand] = useState(() => readBrand(host.brand, host.id));
  const [goal, setGoal] = useState(() => readGoal(stream.goal));
  const [heat, setHeat] = useState(() => readHeat(stream.heat));
  const [battle, setBattle] = useState<BattleView | null>(null);
  const [feedAway, setFeedAway] = useState(false);
  const [listen, setListen] = useState(false);
  const [tab, setTab] = useState<Tab>("scenes");
  const [cardNote, setCardNote] = useState(() => readScene(stream.scene)?.cardNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [featureQueue, setFeatureQueue] = useState(() => readFeatureQueue([]));
  const [requests, setRequests] = useState<StageUser[]>(() =>
    stream.guests
      .filter((g) => g.status === "requested")
      .map((g) => ({ userId: g.userId, username: g.username, avatar: g.avatar, standing: readStanding(g.standing) }))
  );
  const [onStage, setOnStage] = useState<StageUser[]>(() =>
    stream.guests.filter((g) => g.status === "live").map((g) => ({ userId: g.userId, username: g.username, avatar: g.avatar }))
  );
  /** Accepted, but not on yet: in the room checking their devices, seen only by the crew. */
  const [backstage, setBackstage] = useState<StageUser[]>(() =>
    stream.guests.filter((g) => g.status === "backstage").map((g) => ({ userId: g.userId, username: g.username, avatar: g.avatar }))
  );
  /** What chat's talking about ($cashtags), for a chart in one tap (market layer). */
  const [tickers, setTickers] = useState<Trending[]>([]);
  // The market as director: the same suggestions the host's studio gets.
  const marketSuggestions = useMarketSuggestions(stream.id);
  const [stageLine, setStageLine] = useState(() => readStageLine(host.stageLine));
  const [stageBusy, setStageBusy] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [segments, setSegments] = useState<RundownSegment[]>(data.segments);
  const [position, setPosition] = useState<RundownPosition | null>(null);
  /** Bumped when the host edits the rundown mid-show: fetch it again. */
  const [rundownRev, setRundownRev] = useState(0);
  const cueSponsors = useMemo(() => cueSponsorsOf(data.sponsors), [data.sponsors]);

  const onData = (evt: Record<string, unknown>) => {
    switch (evt.__evt) {
      case "scene": {
        const next = readScene(evt.scene);
        setScene((cur) => newerScene(cur, next) ?? cur);
        return;
      }
      case "brand":
        if (evt.brand) setBrand(readBrand(evt.brand, host.id));
        return;
      case "feed":
        setFeedAway(evt.state === "reconnecting");
        return;
      case "battle":
        if (evt.battle && typeof evt.battle === "object") setBattle(evt.battle as BattleView);
        return;
      case "goal": {
        const next = readGoal(evt.goal);
        if (next) setGoal((g) => newerGoal(g, next));
        return;
      }
      case "heat": {
        const next = readHeat(evt.heat);
        if (next) setHeat((h) => newerHeat(h, next));
        return;
      }
      case "rundown": {
        const next = readPosition(evt.position);
        if (next) setPosition(next);
        return;
      }
      case "rundown_changed":
        setRundownRev((n) => n + 1);
        return;
      case "feature_queue":
        setFeatureQueue(readFeatureQueue(evt.queue));
        return;
      case "stage_line":
        setStageLine(readStageLine(evt));
        return;
      case "guest_request": {
        if (typeof evt.userId !== "string") return;
        const row = { userId: evt.userId, username: String(evt.username ?? "viewer"), avatar: String(evt.avatar ?? ""), standing: readStanding(evt.standing) };
        setRequests((prev) => (prev.some((r) => r.userId === row.userId) ? prev : [...prev, row]));
        return;
      }
      case "guest_update": {
        if (typeof evt.userId !== "string") return;
        const uid = evt.userId;
        if (evt.action === "cancelled" || evt.action === "denied") {
          setRequests((prev) => prev.filter((r) => r.userId !== uid));
        } else if (evt.action === "backstage" || evt.action === "approved") {
          const known = requests.find((r) => r.userId === uid) ?? backstage.find((g) => g.userId === uid);
          const row = known ?? (evt.username ? { userId: uid, username: String(evt.username), avatar: String(evt.avatar ?? "") } : null);
          setRequests((prev) => prev.filter((r) => r.userId !== uid));
          if (evt.action === "backstage") {
            if (row) setBackstage((prev) => (prev.some((g) => g.userId === uid) ? prev : [...prev, row]));
          } else {
            setBackstage((prev) => prev.filter((g) => g.userId !== uid));
            if (row) setOnStage((prev) => (prev.some((g) => g.userId === uid) ? prev : [...prev, row]));
          }
        } else if (evt.action === "removed" || evt.action === "left") {
          setOnStage((prev) => prev.filter((g) => g.userId !== uid));
          setBackstage((prev) => prev.filter((g) => g.userId !== uid));
        }
        return;
      }
      case "tickers":
        setTickers(readTickers(evt.tickers));
        return;
      case "suggestion":
        marketSuggestions.push(evt.suggestion);
        return;
    }
  };

  const live = useConsoleRoom({
    url,
    token,
    hostId: host.id,
    listen,
    onMetadata: (metadata) => {
      const next = sceneFromMetadata(metadata);
      if (next) setScene((cur) => newerScene(cur, next) ?? cur);
    },
    onData,
    onClosed,
  });

  // Where the show is, and the host's rundown as it stands — again whenever they edit it.
  useEffect(() => {
    let alive = true;
    apiFetch<{ success: boolean; data: { position: RundownPosition; segments: unknown } }>(`/api/streams/${stream.id}/rundown`)
      .then((r) => {
        if (!alive) return;
        setPosition(r.data.position);
        setSegments(readSegments(r.data.segments));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stream.id, rundownRev]);

  // What moderators have suggested for the screen, and whether a battle's on.
  useEffect(() => {
    let alive = true;
    apiFetch<{ success: boolean; data: { queue: unknown } }>(`/api/streams/${stream.id}/feature-queue`)
      .then((r) => alive && setFeatureQueue(readFeatureQueue(r.data.queue)))
      .catch(() => {});
    apiFetch<{ success: boolean; data: { battle: BattleView | null } }>(`/api/streams/${stream.id}/battle`)
      .then((r) => alive && setBattle(r.data.battle))
      .catch(() => {});
    apiFetch<{ success: boolean; data: { tickers: unknown } }>(`/api/streams/${stream.id}/tickers`)
      .then((r) => alive && setTickers(readTickers(r.data.tickers)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stream.id]);

  /**
   * Change the scene: shown here at once, then saved and broadcast by the
   * API — the studio and every viewer follow. A refusal puts it back.
   */
  const applyScene = async (patch: ScenePatch): Promise<string | null> => {
    const before = scene;
    const next = { ...scene, ...patch, version: scene.version + 1 };
    setScene(next);
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { scene: unknown } }>(`/api/streams/${stream.id}/scene`, {
        method: "PUT",
        // The whole scene every time: what's left out goes back to its default.
        body: JSON.stringify({
          layout: next.layout,
          card: next.card,
          cardNote: next.cardNote,
          chart: next.chart ?? null,
          layers: next.layers,
          gains: next.gains ?? {},
          spotlight: next.spotlight ?? null,
          interpreter: next.interpreter ?? null,
          angle: next.angle ?? "main",
        }),
      });
      const saved = readScene(r.data.scene);
      setScene((cur) => newerScene(cur, saved) ?? cur);
      return null;
    } catch (err) {
      setScene(before);
      const message = err instanceof Error ? err.message : "Couldn't change the scene";
      setError(message);
      return message;
    }
  };
  const takeScene = (raw: unknown) => {
    const next = readScene(raw);
    setScene((cur) => newerScene(cur, next) ?? cur);
  };

  /** Put a segment on air — its clock starts on the server, its cues change the picture. */
  const goSegment = async (segment: RundownSegment | null) => {
    const r = await apiFetch<{ success: boolean; data: { position: RundownPosition } }>(`/api/streams/${stream.id}/rundown`, {
      method: "PUT",
      body: JSON.stringify({ segmentId: segment?.id ?? null }),
    });
    setPosition(r.data.position);
    const patch = segment ? applyCues(scene, segment, serverNow(), cueSponsors) : null;
    if (patch) {
      const failed = await applyScene(patch);
      if (failed) throw new Error(failed);
    }
  };

  const stageAction = async (userId: string, action: "approve" | "deny" | "remove" | "backstage") => {
    if (stageBusy) return;
    setStageBusy(userId);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${stream.id}/guests/${userId}/${action}`, { method: "POST" });
      // The room's guest_update moves the row too; doing it here keeps the list honest if that's late.
      const row = requests.find((r) => r.userId === userId) ?? backstage.find((g) => g.userId === userId);
      if (action === "approve" && row) setOnStage((prev) => (prev.some((g) => g.userId === userId) ? prev : [...prev, row]));
      if (action === "backstage" && row) setBackstage((prev) => (prev.some((g) => g.userId === userId) ? prev : [...prev, row]));
      if (action !== "remove") setRequests((prev) => prev.filter((r) => r.userId !== userId));
      if (action === "approve" || action === "remove") setBackstage((prev) => prev.filter((g) => g.userId !== userId));
      if (action === "remove") setOnStage((prev) => prev.filter((g) => g.userId !== userId));
    } catch (err) {
      setStageError(err instanceof Error ? err.message : "That didn't go through — try again.");
    } finally {
      setStageBusy(null);
    }
  };

  /** The host at their second screen changes who can ask; a producer sees it as it stands. */
  const saveStageLine = async (next: StageLineRule) => {
    const before = stageLine;
    setStageLine(next);
    setStageError(null);
    try {
      await apiFetch("/api/user/me", {
        method: "PATCH",
        body: JSON.stringify({ settings: { stageRequests: next.who, stageAccountDays: next.accountDays } }),
      });
    } catch {
      setStageLine(before);
      setStageError("Couldn't change who can ask — try again.");
    }
  };

  const putUpSuggested = async (messageId: string) => {
    try {
      const r = await apiFetch<{ success: boolean; data: { scene: unknown } }>(`/api/streams/${stream.id}/chat/${messageId}/feature`, {
        method: "POST",
        body: JSON.stringify({ seconds: host.featureSeconds || null }),
      });
      takeScene(r.data.scene);
      setFeatureQueue((q) => q.filter((x) => x.messageId !== messageId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't put that up");
    }
  };
  const dismissSuggested = async (messageId: string) => {
    setFeatureQueue((q) => q.filter((x) => x.messageId !== messageId));
    try {
      const r = await apiFetch<{ success: boolean; data: { queue: unknown } }>(`/api/streams/${stream.id}/feature-queue/${messageId}`, { method: "DELETE" });
      setFeatureQueue(readFeatureQueue(r.data.queue));
    } catch {
      // It stays turned down here; the next queue event settles it.
    }
  };
  const takeDownFeatured = async () => {
    const current = scene.featured;
    if (!current) return;
    try {
      const r = await apiFetch<{ success: boolean; data: { scene: unknown } }>(`/api/streams/${stream.id}/chat/${current.id}/feature`, { method: "DELETE" });
      takeScene(r.data.scene);
    } catch {
      setError("Couldn't take it down — it comes down at its time anyway.");
    }
  };

  /* ---- The program: the scene, drawn as viewers get it ---- */

  const hostName = host.displayName || host.username;
  const battleOn = isBattleActive(battle) ? battle : null;
  const side = battleOn ? sideOf(battleOn, stream.id) : null;
  const opponent = battleOn && side ? (side === "host" ? battleOn.challenger : battleOn.host) : null;
  const pairOpponent = battleOn?.mode === "2v2" ? opponent : null;
  const pairTracks = useRoomPreview(pairOpponent?.streamId ?? null);
  // Backstage guests are in the room, not on the stage: the picture and the panels leave them out until they're put on.
  const backstageIds = new Set(backstage.map((g) => g.userId));
  const stageGuests = live.guests.filter((g) => !backstageIds.has(g.identity));
  const guestNames = stageGuests.map((g) => ({ identity: g.identity, name: g.name }));
  const guestCell = (g: (typeof live.guests)[number]): SceneCell => ({
    key: g.identity,
    identity: g.identity,
    node: <StageTile fill track={g.track} label={g.name} />,
  });
  const opponentCell = (key: string, name: string, picture: ReactNode): SceneCell => ({
    key,
    node: (
      <div className="relative size-full bg-black">
        {picture}
        <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold">
          {name} · opponent
        </span>
      </div>
    ),
  });
  const others: SceneCell[] = (() => {
    if (!opponent || !battleOn || !side) return stageGuests.map(guestCell);
    if (pairOpponent) {
      // A 2v2 is a 2×2, as viewers see it: after the host, their host, our partner, their partner.
      const mate = (side === "host" ? battleOn.host : battleOn.challenger).partner ?? null;
      const mateGuest = mate ? stageGuests.find((g) => g.identity === mate.userId) : undefined;
      const theirMate = pairOpponent.partner ?? null;
      return [
        opponentCell("opponent", pairOpponent.displayName, <PreviewVideo track={hostTrackOf(pairTracks, pairOpponent, theirMate?.userId)} />),
        mateGuest ? guestCell(mateGuest) : { key: "mate", node: <AwayTile name={mate?.displayName ?? "Their partner"} /> },
        theirMate
          ? opponentCell("opponent-mate", theirMate.displayName, <PreviewVideo track={pairTracks.get(theirMate.userId)} />)
          : { key: "opponent-mate", node: <AwayTile name="Their partner" /> },
      ];
    }
    return [
      opponentCell(
        "opponent",
        opponent.displayName,
        <LivePreview streamId={opponent.streamId} className="absolute inset-0" poster={<div className="absolute inset-0 bg-black" />} fallbackSrc={null} />
      ),
      ...stageGuests.map(guestCell),
    ];
  })();
  // The host's phone cam in the program, as the scene has it: first among
  // the others for Both, full-frame for Phone.
  const angle = live.phoneCamera ? (scene.angle ?? "main") : "main";
  const programOthers =
    angle === "both" && live.phoneCamera ? [{ key: "phone-cam", node: <StageTile fill track={live.phoneCamera} label="Phone cam" /> }, ...others] : others;
  const sharing = guestsShown(angle === "both" ? "auto" : scene.layout, programOthers.length, Boolean(battleOn)) > 0;
  const mainTrack = angle === "phone" && live.phoneCamera ? live.phoneCamera : (live.hostScreen ?? live.hostCamera);

  const program = (
    <div className="relative aspect-video w-full overflow-hidden rounded-[16px] bg-black desk:rounded-[18px]">
      <SceneRenderer
        scene={scene}
        portrait={false}
        forceAuto={Boolean(battleOn) || angle === "both"}
        host={{ name: hostName, avatar: host.avatar }}
        mainLabel={angle === "phone" ? "Phone cam" : hostName}
        main={<TrackVideo track={mainTrack} fit={sharing ? "cover" : "contain"} />}
        pip={live.hostScreen && live.hostCamera ? <StageTile fill track={live.hostCamera} label={hostName} /> : undefined}
        pipClassName="top-3 right-3"
        guests={programOthers}
        brand={brand}
        goal={goal}
        heat={heat}
      />
      {/* What the console knows that viewers don't: how it's joined, and whether the feed's there. */}
      <div className="pointer-events-none absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5">
        <span className="rounded-full bg-black/55 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.08em] text-white/85">PROGRAM</span>
        {feedAway && <span className="rounded-full bg-warning px-2 py-1 text-[11px] font-bold text-[#1a1203]">Host&apos;s feed dropped — holding</span>}
      </div>
      {!live.connected ? (
        <ProgramNote spinner>Joining the room…</ProgramNote>
      ) : !mainTrack && !feedAway ? (
        <ProgramNote>Waiting for {hostName}&apos;s picture</ProgramNote>
      ) : null}
    </div>
  );

  /* ---- Panels ---- */

  const tabs: CapsuleTab<Tab>[] = [
    { id: "scenes", label: "Scenes", icon: LayoutIcon, badge: featureQueue.length },
    { id: "show", label: "Show", icon: Playlist },
    { id: "stage", label: "Stage", icon: HandWaving, badge: requests.length },
    { id: "chat", label: "Chat", icon: ChatText },
  ];

  const priceStrip = layerOf(scene.layers, "prices")?.symbols ?? [];
  const scenesPanel = (
    <div className="flex flex-col gap-6 px-4 pt-4 pb-6">
      {error && <p className="rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">{error}</p>}
      <TickerChips
        tickers={tickers}
        strip={priceStrip}
        onChart={(symbol) => void applyScene({ layout: "chart-face", chart: { symbol, interval: scene.chart?.interval ?? "5m" } })}
        onStrip={(symbol) =>
          void applyScene({
            layers: withLayer(scene.layers, "prices", { kind: "prices", symbols: [...priceStrip.filter((x) => x !== symbol), symbol].slice(-MAX_PRICE_SYMBOLS) }),
          })
        }
      />
      {/* No "Ask chat" here: opening a question is the host's. */}
      <MarketSuggestions
        suggestions={marketSuggestions.suggestions}
        charted={scene.layout === "chart-face" ? (scene.chart?.symbol ?? null) : null}
        onChart={(symbol, interval) => void applyScene({ layout: "chart-face", chart: { symbol, interval } })}
        onBanner={(text) => void applyScene({ layers: withLayer(scene.layers, "banner", { kind: "banner", text }) })}
        onDismiss={marketSuggestions.dismiss}
      />
      <LayoutAndCards
        crew
        scene={scene}
        battle={Boolean(battleOn)}
        guests={guestNames.filter((g) => g.identity !== scene.interpreter)}
        cardNote={cardNote}
        onCardNote={setCardNote}
        onScene={(patch) => void applyScene(patch)}
      />
      <FeaturedPanel
        queue={featureQueue}
        onPutUp={(id) => void putUpSuggested(id)}
        onDismiss={(id) => void dismissSuggested(id)}
        featured={scene.featured ?? null}
        seconds={host.featureSeconds}
        giftsFrom={host.featureGiftsFromMinor}
        carded={Boolean(scene.card)}
        onTakeDown={() => void takeDownFeatured()}
      />
      <SceneGraphicsPanel
        layers={scene.layers}
        brand={brand}
        brandKit={false}
        // A producer can make the host's call too — never on a practice run.
        streamId={stream.practice ? null : stream.id}
        hostName={hostName}
        streamTitle={stream.title}
        people={onStage.map((g) => ({ name: live.guests.find((t) => t.identity === g.userId)?.name || g.username, username: g.username }))}
        carded={Boolean(scene.card)}
        battle={Boolean(battleOn)}
        sponsors={data.sponsors}
        onLayers={(layers) => void applyScene({ layers })}
        onBrand={async () => {
          throw new Error("The brand kit is the host's to change.");
        }}
      />
    </div>
  );

  const stagePanel = (
    <div className="flex flex-col gap-6 px-4 pt-4 pb-6">
      {stageError && <p className="rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">{stageError}</p>}
      {data.role === "host" ? (
        <StageLineControl line={stageLine} onChange={(next) => void saveStageLine(next)} />
      ) : (
        <StageLineControl line={stageLine} />
      )}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className={LABEL}>Asking to join</h3>
          <span className="text-[11px] text-muted-foreground/60 tabular-nums">
            {onStage.length}/{MAX_STAGE_GUESTS} seats taken
          </span>
        </div>
        {requests.length === 0 ? (
          <p className="text-[13px] leading-snug text-muted-foreground/70">When viewers tap &ldquo;Join stream&rdquo;, they show up here to bring on.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {requests.map((r) => (
              <div key={r.userId} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.045] px-3 py-2.5">
                <UserAvatar src={r.avatar} name={r.username} size={32} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground/90">{r.username}</p>
                  <StandingLine standing={r.standing} />
                </div>
                <button
                  type="button"
                  onClick={() => void stageAction(r.userId, "backstage")}
                  disabled={stageBusy !== null || backstage.length >= MAX_BACKSTAGE}
                  title={backstage.length >= MAX_BACKSTAGE ? "Backstage is full" : "Let them in to check their camera and mic first — viewers won't see them yet"}
                  className="press h-8 shrink-0 rounded-full bg-white/[0.07] px-2.5 text-[12.5px] font-medium text-foreground/85 transition-colors hover:bg-white/[0.12] disabled:opacity-50"
                >
                  Backstage
                </button>
                <button
                  type="button"
                  onClick={() => void stageAction(r.userId, "approve")}
                  disabled={stageBusy !== null || onStage.length >= MAX_STAGE_GUESTS}
                  title={onStage.length >= MAX_STAGE_GUESTS ? "The stage is full" : "Bring them on"}
                  className="press flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-[#0b0708] disabled:opacity-50"
                >
                  {stageBusy === r.userId ? <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" /> : <Check size={13} weight="bold" />}
                  Bring on
                </button>
                <button
                  type="button"
                  onClick={() => void stageAction(r.userId, "deny")}
                  disabled={stageBusy !== null}
                  aria-label={`Decline ${r.username}`}
                  title="Decline"
                  className="press flex size-8 items-center justify-center rounded-full bg-white/[0.07] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      {backstage.length > 0 && (
        <section>
          <h3 className={cn(LABEL, "mb-2")}>Backstage</h3>
          <div className="flex flex-col gap-1.5">
            {backstage.map((g) => (
              <div key={g.userId} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.045] px-3 py-2.5">
                {/* Their picture, small: are they framed, is the light right. */}
                <span className="relative aspect-video w-14 shrink-0 overflow-hidden rounded-[8px] bg-black">
                  <StageTile fill track={live.guests.find((t) => t.identity === g.userId)?.track} label="" />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">{g.username}</p>
                <button
                  type="button"
                  onClick={() => void stageAction(g.userId, "approve")}
                  disabled={stageBusy !== null || onStage.length >= MAX_STAGE_GUESTS}
                  title={onStage.length >= MAX_STAGE_GUESTS ? "The stage is full" : "Put them on stage"}
                  className="press flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-[#0b0708] disabled:opacity-50"
                >
                  {stageBusy === g.userId ? <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" /> : <Check size={13} weight="bold" />}
                  Put on
                </button>
                <button
                  type="button"
                  onClick={() => void stageAction(g.userId, "remove")}
                  disabled={stageBusy !== null}
                  aria-label={`Send ${g.username} back to the room`}
                  title="Send them back to the room"
                  className="press flex size-8 items-center justify-center rounded-full bg-white/[0.07] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground/70">Camera and mic on, seen and heard by the crew only, until they&apos;re put on.</p>
        </section>
      )}
      <section>
        <h3 className={cn(LABEL, "mb-2")}>On stage now</h3>
        {onStage.length === 0 ? (
          <p className="text-[13px] leading-snug text-muted-foreground/70">Just {hostName}. Bring someone on and they join with their camera.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {onStage.map((g) => (
              <div key={g.userId} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.045] px-3 py-2.5">
                <UserAvatar src={g.avatar} name={g.username} size={32} className="size-8" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
                  {g.username}
                  {scene.spotlight === g.userId && <span className="ml-2 text-[11.5px] font-medium text-ember-hi">beside the host</span>}
                </p>
                <InterpreterToggle on={scene.interpreter === g.userId} onToggle={(on) => void applyScene({ interpreter: on ? g.userId : null })} />
                <button
                  type="button"
                  onClick={() => void stageAction(g.userId, "remove")}
                  disabled={stageBusy !== null}
                  className="press h-8 rounded-full bg-white/[0.07] px-3 text-[12.5px] font-medium text-foreground/85 transition-colors hover:bg-white/[0.12] disabled:opacity-50"
                >
                  Take off
                </button>
              </div>
            ))}
          </div>
        )}

        {/* The host's phone cam is in: what the program shows of it is the console's to change too. */}
        {live.phoneCamera && (
          <AngleSwitch className="mt-5 border-t border-white/[0.06] pt-4" angle={scene.angle ?? "main"} onAngle={(a) => void applyScene({ angle: a })} enabled />
        )}
      </section>
      <p className="text-[12px] leading-relaxed text-muted-foreground/70">
        Faders and co-lives stay in {hostName}&apos;s studio — this is who&apos;s on, and who&apos;s next.
      </p>
    </div>
  );

  const panelBody = (
    <>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", tab !== "scenes" && "hidden")}>{scenesPanel}</div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6", tab !== "show" && "hidden")}>
        <RunOfShow
          segments={segments}
          status="saved"
          onChange={() => {}}
          live
          position={position}
          onGo={goSegment}
          sponsors={cueSponsors}
          editable={false}
        />
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", tab !== "stage" && "hidden")}>{stagePanel}</div>
      {/* Chat stays mounted under the other tabs, so it never misses a line. */}
      <div className={cn("min-h-0 flex-1", tab !== "chat" && "hidden")}>
        <LiveChat
          crew
          streamId={stream.id}
          room={live.room}
          isLive
          hostUsername={host.username}
          initialPinned={stream.pinned}
          featured={scene.featured ?? null}
          featureSeconds={host.featureSeconds}
          onScene={takeScene}
          onFeatureQueue={(q) => setFeatureQueue(readFeatureQueue(q))}
        />
      </div>
    </>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-background md:h-[calc(100dvh-4rem)] desk:grid desk:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] desk:gap-4 desk:p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      {/* The program side: who you're producing, the picture, what's next. */}
      <section className="flex shrink-0 flex-col gap-3 px-3 pt-[max(env(safe-area-inset-top),10px)] pb-3 md:pt-3 desk:min-h-0 desk:px-0 desk:pt-0 desk:pb-0">
        <ConsoleHeader data={data} live={stream} listen={listen} onListen={() => setListen((l) => !l)} />
        {/* Beside the desk, the picture takes what height there is (less the
            bar under it), and never more — the bar stays right under it. */}
        <div className="min-h-0 desk:flex-1 desk:[container-type:size]">
          <div className="mx-auto flex w-full max-w-[calc(46dvh*16/9)] flex-col gap-3 desk:w-[min(100cqw,calc((100cqh-7.5rem)*16/9))] desk:max-w-none xl:w-[min(100cqw,calc((100cqh-4.5rem)*16/9))]">
            {program}
            <QuickBar
              scene={scene}
              segments={segments}
              position={position}
              onGo={goSegment}
              onCard={(card) => void applyScene({ card, cardNote: cardNote.trim() })}
              onShow={() => setTab("show")}
            />
          </div>
        </div>
      </section>

      {/* The desk: scenes, the show, the stage, the chat. */}
      <aside className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[20px] bg-surface shadow-[inset_0_1px_0_rgba(255,236,230,0.06)] desk:rounded-[20px]">
        <div className="shrink-0 px-4 pt-3 pb-2">
          <CapsuleTabs label={`${hostName}'s show`} items={tabs} value={tab} onChange={setTab} />
        </div>
        {panelBody}
      </aside>
    </div>
  );
}

/** A remote camera or screen, filling its cell. */
function TrackVideo({ track, fit }: { track: ConsoleRoomTrack | undefined; fit: "cover" | "contain" }) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [el, track]);
  return <video ref={setEl} autoPlay playsInline muted className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")} />;
}
type ConsoleRoomTrack = NonNullable<ReturnType<typeof useConsoleRoom>["hostCamera"]>;

function ProgramNote({ children, spinner = false }: { children: ReactNode; spinner?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <span className="flex items-center gap-2 rounded-full bg-black/60 px-3.5 py-2 text-[12.5px] font-semibold text-white/85">
        {spinner && <span className="size-3.5 animate-spin rounded-full border-2 border-white/80 border-t-transparent" />}
        {children}
      </span>
    </div>
  );
}

/** Who you're producing, whether they're on, and the room's sound. */
function ConsoleHeader({
  data,
  live,
  listen,
  onListen,
}: {
  data: ConsoleData;
  live: ConsoleStream | null;
  listen?: boolean;
  onListen?: () => void;
}) {
  const { host, role } = data;
  const hostName = host.displayName || host.username;
  const now = useNow(Boolean(live?.startedAt));
  const uptime = live?.startedAt ? formatClock(Math.max(0, (now - new Date(live.startedAt).getTime()) / 1000)) : null;
  return (
    <header className="flex items-center gap-2.5">
      <Link
        href={`/c/${host.username}`}
        aria-label={`Back to ${hostName}'s channel`}
        className="press flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground/85 transition-colors hover:bg-white/[0.1] md:hidden"
      >
        <ArrowLeft size={17} />
      </Link>
      <UserAvatar src={host.avatar} name={hostName} size={36} className="size-9 shrink-0" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate font-wide text-[15px] font-bold tracking-[-0.02em] md:text-[16px]">{role === "host" ? "Your show" : hostName}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          <span className="font-semibold text-foreground/75">{role === "host" ? "Second screen" : "Producing"}</span>
          {" · "}
          {live ? live.title : "off air"}
        </p>
      </div>
      {live && live.practice ? (
        // A rehearsal isn't on air: ember, and it says so.
        <span className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-ember px-2.5 text-[11px] font-bold tracking-[0.06em] text-on-ember" title="A practice run — nobody can find or join this room">
          PRACTICE
          {uptime && <span className="font-mono font-semibold tabular-nums">{uptime}</span>}
        </span>
      ) : live ? (
        <LiveBadge size="sm" className="shrink-0">
          {uptime && <span className="ml-1 font-mono tabular-nums">{uptime}</span>}
        </LiveBadge>
      ) : null}
      {onListen && (
        <button
          type="button"
          onClick={onListen}
          aria-pressed={listen}
          title={listen ? "Stop listening" : "Listen to the room"}
          className={cn(
            "press flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors",
            listen ? "bg-white text-[#0b0708]" : "bg-white/[0.07] text-foreground hover:bg-white/[0.11]"
          )}
        >
          {listen ? <SpeakerHigh size={15} weight="fill" /> : <SpeakerSlash size={15} />}
          <span className="max-sm:sr-only">{listen ? "Listening" : "Listen"}</span>
        </button>
      )}
    </header>
  );
}

/**
 * Under the picture: the show's next step and the cards, a tap away
 * whichever panel is open — the moves a producer makes without looking.
 */
function QuickBar({
  scene,
  segments,
  position,
  onGo,
  onCard,
  onShow,
}: {
  scene: Scene;
  segments: RundownSegment[];
  position: RundownPosition | null;
  onGo: (segment: RundownSegment | null) => Promise<void>;
  onCard: (card: Scene["card"]) => void;
  onShow: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const now = useNow(Boolean(position?.startedAt));
  const onAirIndex = position?.segmentId ? segments.findIndex((s) => s.id === position.segmentId) : -1;
  const onAir = onAirIndex >= 0 ? segments[onAirIndex]! : null;
  const next = onAirIndex >= 0 ? (segments[onAirIndex + 1] ?? null) : (segments[0] ?? null);
  const left = onAir && position?.startedAt ? onAir.seconds - (now + serverOffset() - new Date(position.startedAt).getTime()) / 1000 : null;

  const go = async (segment: RundownSegment | null) => {
    setBusy(true);
    setFailed(null);
    try {
      await onGo(segment);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
      {segments.length > 0 && (
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-[14px] px-3.5 py-2.5",
            left !== null && left < 0 ? "bg-warning/[0.1]" : onAir ? "bg-ember/[0.1]" : "bg-white/[0.05]"
          )}
        >
          <button type="button" onClick={onShow} className="min-w-0 flex-1 text-left">
            <span className={cn(LABEL, "block")}>{onAir ? `On air · ${onAirIndex + 1} of ${segments.length}` : "Run of show"}</span>
            <span className="mt-0.5 flex items-baseline gap-2">
              <span className="min-w-0 truncate text-[14px] font-semibold">{onAir ? onAir.title : `First up: ${segments[0]!.title}`}</span>
              {left !== null && (
                <span className={cn("shrink-0 font-mono text-[13px] font-bold tabular-nums", left < 0 ? "text-warning" : "text-foreground/80")}>
                  {formatClock(left, true)}
                </span>
              )}
            </span>
            {failed && <span className="mt-0.5 block truncate text-[11.5px] text-chili-hi">{failed}</span>}
          </button>
          {(next || !onAir) && (
            <button
              type="button"
              disabled={busy || !next}
              onClick={() => void go(next)}
              className={cn(
                "press flex h-9 max-w-[55%] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold disabled:opacity-50",
                left !== null && left < 0 ? "bg-warning text-[#1a1203]" : "bg-white text-[#0b0708]"
              )}
            >
              <SkipForward size={14} weight="fill" className="shrink-0" />
              <span className="truncate">{onAir ? `Next: ${next?.title}` : "Start the show"}</span>
            </button>
          )}
        </div>
      )}
      <div className="grid shrink-0 grid-cols-3 gap-1.5" role="group" aria-label="Cards">
        {CARDS.map((c) => {
          const on = scene.card === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              aria-label={`${c.title} card`}
              onClick={() => onCard(on ? null : c.id)}
              title={on ? "On screen — tap to take it down" : c.body}
              className={cn(
                "press h-10 truncate rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                on ? "bg-ember text-on-ember" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
              )}
            >
              {CARD_SHORT[c.id]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Off air                                                             */
/* ------------------------------------------------------------------ */

function OffAir({ data, ended }: { data: ConsoleData; ended: boolean }) {
  const { host } = data;
  const hostName = host.displayName || host.username;
  const cueSponsors = useMemo(() => cueSponsorsOf(data.sponsors), [data.sponsors]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-10 md:pt-6 lg:px-6">
      <ConsoleHeader data={data} live={null} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <section className="flex flex-col items-center justify-center rounded-[20px] bg-surface px-6 py-12 text-center shadow-[inset_0_1px_0_rgba(255,236,230,0.06)] md:py-16">
          <UserAvatar src={host.avatar} name={hostName} size={72} ring="seen" />
          <p className="mt-5 font-wide text-[20px] font-bold tracking-[-0.02em] text-balance md:text-[22px]">
            {ended ? "That's the show" : `${hostName} isn't live yet`}
          </p>
          <p className="mt-1.5 max-w-[38ch] text-[13.5px] leading-relaxed text-muted-foreground text-pretty">
            {ended
              ? `${hostName}'s stream has ended. Keep this open and the console comes back the next time they go live.`
              : "Keep this open — the console opens the moment they go live, with the picture, the scenes, the stage and the chat."}
          </p>
          <p className="mt-5 flex items-center gap-2 text-[12px] text-muted-foreground/80">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-ember" />
            Checking every few seconds
          </p>
        </section>
        <section className="rounded-[20px] bg-surface p-4 shadow-[inset_0_1px_0_rgba(255,236,230,0.06)] md:p-5">
          <RunOfShow
            segments={data.segments}
            status="saved"
            onChange={() => {}}
            live={false}
            position={null}
            onGo={async () => {}}
            sponsors={cueSponsors}
            editable={false}
          />
        </section>
      </div>
    </div>
  );
}

function ConsoleSkeleton() {
  return (
    <div className="flex h-[100dvh] flex-col gap-3 p-3 md:h-[calc(100dvh-4rem)] desk:grid desk:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] desk:gap-4 desk:p-4" aria-busy="true" aria-label="Opening the console">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span className="size-9 animate-pulse rounded-full bg-white/[0.06]" />
          <span className="h-4 w-40 animate-pulse rounded-full bg-white/[0.06]" />
        </div>
        <div className="aspect-video w-full animate-pulse rounded-[18px] bg-white/[0.04]" />
      </div>
      <div className="min-h-40 flex-1 animate-pulse rounded-[20px] bg-white/[0.03]" />
    </div>
  );
}
