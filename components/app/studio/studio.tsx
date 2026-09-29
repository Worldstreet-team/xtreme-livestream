"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from "react";
import Link from "next/link";
import { registerProductionBridge, registerStudioBridge, registerVividContext, type ProductionRequest, type StudioAction } from "@/lib/vivid/page-context";
import {
  VideoCamera,
  Monitor,
  Microphone,
  MicrophoneSlash,
  Check,
  Copy,
  CurrencyDollar,
  Broadcast,
  Lightning,
  Eye,
  EyeSlash,
  UsersThree,
  MonitorArrowUp,
  ShareNetwork,
  X,
  Warning,
  Tag,
  CaretLeft,
  Stop,
  CameraRotate,
  VideoCameraSlash,
  Gift,
  CalendarPlus,
  Camera,
  ImageEdit,
  ImageSquare,
  ChatText,
  HandWaving,
  Sword,
  Sparkle,
  DotsThree,
  CellSignalLow,
  LayoutIcon,
  Ticket,
  Faders,
  Playlist,
  ClapperboardText,
  CaretRight,
  Shield,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { BrandMark } from "@/components/ui/brand-mark";
import { SwitchField } from "@/components/ui/selection-controls";
import { RoomTabs, type RoomTab } from "@/components/app/studio/room-tabs";
import { useChatOnScreen } from "@/components/app/studio/chat-on-screen";
import { VividLauncher } from "@/components/vivid/vivid-voice-control";
import { Appear, DetailsField, DetailsPill, StreamDetailsSheet } from "@/components/app/studio/quick-setup";
import { CountdownOverlay, useGoLiveCountdown } from "@/components/app/studio/go-live-countdown";
import { readLastDetails, readMarketTools, saveLastDetails, saveMarketTools } from "@/lib/go-live-prefs";
import { StreamArt } from "@/components/app/stream-art";
import { ViewerView } from "@/components/app/viewer-view";
import { openStreamReport } from "@/lib/stream-report";
import { offerThumbnailCandidate } from "@/lib/thumbnail-candidates";
import { GiftArt } from "@/components/app/gift-art";
import { cn } from "@/lib/utils";
import { BattlePanel } from "@/components/app/battle-panel";
import { SparringTile } from "@/components/app/battles/sparring-tile";
import { BattleAskStrip } from "@/components/app/studio/battle-ask-strip";
import { GamesPanel } from "@/components/app/games-panel";
import { LivePreview, PreviewVideo, hostTrackOf, useRoomPreview } from "@/components/app/live-preview";
import { MiniLive } from "@/components/app/studio/mini-live";
import { publishLiveSession, type LiveActions } from "@/lib/live-session";
import { BATTLE_EVENT, sideOf, type BattleView } from "@/lib/battles";
import { isMarketCategory, type Category } from "@/lib/categories";
import { SceneRenderer, type SceneCell } from "@/components/app/scene-renderer";
import { SceneGraphicsPanel, type BrandPatch } from "@/components/app/scene-graphics-panel";
import { FeaturedPanel } from "@/components/app/featured-panel";
import { GoalPanel } from "@/components/app/goal-panel";
import { RequestsPanel } from "@/components/app/requests-panel";
import { ObsConnect } from "@/components/app/obs-connect";
import { AudioDeskPanel, type DeskMoments } from "@/components/app/audio-desk-panel";
import { AudioDesk, PADS, readDeskSettings, saveDeskSettings, type DeskSettings, type PadId } from "@/lib/audio-desk";
import { useRequestQueue } from "@/lib/requests";
import { cueSponsorsOf, useSponsorships } from "@/lib/sponsors";
import { ConsoleLink } from "@/components/app/console-link";
import { PracticeShare } from "@/components/app/practice-share";
import { LiveAudience } from "@/components/app/stream-recap";
import { InterpreterToggle, StageLineControl, StandingLine, readStageLine, readStanding, type StageLineRule, type StageStanding } from "@/components/app/stage-line";
import { SecondCameraPanel } from "@/components/app/second-camera-panel";
import { SecondCameraTip } from "@/components/app/studio/second-camera-tip";
import { GiftEffects, type GiftEffectsHandle } from "@/components/app/gift-effects";
import { SetStinger } from "@/components/app/set-stinger";
import { SetsPanel } from "@/components/app/sets-panel";
import { PrivacyShieldPanel, PrivacyZonesEditor } from "@/components/app/privacy-shield-panel";
import { CollapsibleSection, openSection } from "@/components/app/collapsible-section";
import { applyShield, getShieldSettings, getShieldStatus, setShieldSettings, shareShieldedScreen, useShieldSettings } from "@/lib/privacy-shield";
import { useAnchorFeed, useFaceAnchors, FACE_WEAR_HZ } from "@/lib/face-anchors";
import { FACE_EFFECTS } from "@/lib/face-effects";
import { brandWithSet, setById, setUsesFace, soundForGift, soundGate } from "@/lib/sets";
import { LookSetup } from "@/components/app/look-setup";
import { SoundSetup } from "@/components/app/sound-setup";
import { applyLook, BACKGROUNDS, changesAppearance, deviceTest, isLooksSupported, LOOKS, setLookBypass, setLookImage, setLookSettings, useLookImage, useLookSettings, type LookSettings } from "@/lib/looks";
import { micCaptureOptions, micPublishOptions, noiseFilterSupported, presetLabel, saveVoiceSettings, useVoiceSettings, voiceNeedsDesk, type VoiceSettings } from "@/lib/voice";
import { isCameraIdentity, phoneOnScreen, placePhone } from "@/lib/angles";
import { applyCues, formatLength, readPosition, totalSeconds, useRundown, useRundownPosition, type CueSponsor, type RundownSegment } from "@/lib/rundown";
import { shotOf, useAutoDirector, type DirectorBlock } from "@/lib/director";
import { RunOfShow, SegmentChip } from "@/components/app/run-of-show";
import { Teleprompter } from "@/components/app/teleprompter";
import { DirectorSwitch } from "@/components/app/director-switch";
import { LayoutAndCards } from "@/components/app/scene-controls";
import { useSiraVivid } from "@/components/vivid/sira-provider";
import { tourAction } from "@/lib/tour/state";
import { usePracticeRequest } from "@/lib/tour/use-practice-request";
import { setPushToTalk, setTalkHeld, usePushToTalk } from "@/lib/vivid/ptt";
import { HealthChip, HealthSection } from "@/components/app/stream-health";
import { useEncoderHealth, useStreamHealth } from "@/lib/use-stream-health";
import { noteFollowersTold, useCoachDriver } from "@/lib/coach";
import { newerGoal, newerHeat, readGoal, readHeat, type StreamGoal, type StreamHeat } from "@/lib/goals";
import { gainFor, withLayer } from "@/lib/scene";
import { serverNow } from "@/lib/server-clock";
import {
  CARDS,
  DEFAULT_BRAND,
  DEFAULT_CHART,
  DEFAULT_SCENE,
  LAYOUTS,
  newerScene,
  ACCENTS,
  readBrand,
  readFeatureQueue,
  layerOf,
  readScene,
  sceneFromMetadata,
  type Brand,
  type Scene,
  type SuggestedLine,
} from "@/lib/scene";
import { MAX_PRICE_SYMBOLS } from "@xtreme/contracts";
import { readTickers, type Trending } from "@/lib/market";
import { TickerChips } from "@/components/app/ticker-chips";
import { MarketSuggestions } from "@/components/app/market-suggestions";
import { useMarketSuggestions, type MarketQuestionPreset } from "@/lib/market-suggestions";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api-client";
import { captureVideoFrame, compressImage } from "@/lib/image-utils";
import { LiveChat } from "@/components/app/live-chat";
import { DragSheet } from "@/components/app/drag-sheet";
import {
  AwayTile,
  StageTile,
  type AttachableVideoTrack,
} from "@/components/app/stage-tile";
import type {
  Room,
  LocalVideoTrack,
  LocalAudioTrack,
  DisconnectReason as DisconnectReasonType,
} from "livekit-client";
import { TourArt, type TourScene } from "@/components/app/tour/tour-art";
import { useOrphanWatch } from "@/components/app/studio/orphan-watch";

type SourceType = "camera" | "screen" | "obs";
/** The shape of the broadcast — chosen before going live, like a real camera. */
type Orientation = "portrait" | "landscape";
type Facing = "user" | "environment";
/** What the live panel is showing. Chat floats over the picture on phones. */
type Panel = "chat" | "stage" | "requests" | "scenes" | "viewers" | "stats" | "battle" | "games" | "more" | "audio" | "show";

const ORIENTATION_KEY = "xtreme-studio-orientation";
const WORLDSPACE_KEY = "xtreme-studio-worldspace";

/** Mirrors MAX_STAGE_GUESTS in @xtreme/contracts — the API enforces it. */
const MAX_STAGE_GUESTS = 3;
/** The API's own limit on who can wait backstage at once (guests.ts). */
const MAX_BACKSTAGE = 4;
/** What a camera that won't start needs from you: a yes, a camera, or the one another app is holding. */
type CamIssue = "waiting" | "denied" | "missing" | "busy";
const SETUP_LABEL = "caps font-mono text-[10.5px] text-muted-foreground";

interface StageUser {
  userId: string;
  username: string;
  avatar: string;
  /** Where they stood with the channel when they asked (the request line). */
  standing?: StageStanding | null;
}

/** 720p either way round — the same pixels, turned to match the shape. */
/**
 * What the camera captures: 720p, or 540p when the creator saves data —
 * about half the upload, steadier on a weak connection (Phase 1).
 */
/** The shot a scene frames — what a hand on the controls changes, as opposed to its graphics. */
const framing = (s: Scene) => `${s.layout}|${s.card ?? ""}|${s.spotlight ?? ""}`;

/**
 * A phone or tablet: its camera turns with it, so a landscape-shaped
 * request comes back upright when it's held upright. (iPadOS says it's a
 * Mac; its touch points give it away.)
 */
function cameraTurnsWithDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * The camera picture to ask for. Cameras only capture landscape shapes, and
 * a phone browser answers a tall request (720×1280) by cutting a narrow
 * strip from the middle of the sensor — a face filling the screen, where
 * Instagram shows the room. So a phone always asks for the landscape shape
 * and lets the phone stand it upright: a portrait stream still comes out
 * tall, with the camera's whole view. A desktop webcam doesn't turn, so a
 * portrait stream there is a crop of its landscape picture, as before.
 */
function captureResolution(o: Orientation, saveData = false) {
  const [long, short] = saveData ? [960, 540] : [1280, 720];
  const tall = o === "portrait" && !cameraTurnsWithDevice();
  return tall ? { width: short, height: long, frameRate: 30 } : { width: long, height: short, frameRate: 30 };
}

/**
 * The studio. It lives in the app shell (studio-host.tsx), so once you're
 * live it stays mounted wherever you go: `minimized`, its console is out of
 * sight and the broadcast rides in a corner (MiniLive) and in the rail.
 */
export function Studio({ minimized = false }: { minimized?: boolean }) {
  const { user } = useAuth();
  // Both optional, both remembered: last time's title and category come
  // back prefilled, so going again is one tap. Never crypto by default.
  const [title, setTitle] = useState(() => readLastDetails()?.title ?? "");
  const [category, setCategory] = useState<Category>(() => readLastDetails()?.category || "Just Chatting");
  /** The title as the stream carries it — the API's default name when it went out blank. */
  const [airTitle, setAirTitle] = useState<string | null>(null);
  /** What viewers read: the stream's own title once it's out, the typed one before. */
  const onAirTitle = airTitle || title.trim();
  /** The live details sheet (the pill on the picture opens it). */
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** Every other setup option, folded behind More — a sheet on phones, a panel in the console. */
  const [moreOpen, setMoreOpen] = useState(false);
  /** Charts, prices and market calls up front for any category — the host asked for them. */
  const [marketTools, setMarketTools] = useState(readMarketTools);
  /** Why the camera preview isn't up, when it isn't. */
  const [camIssue, setCamIssue] = useState<CamIssue | null>(null);
  /** The browser has been told no to the microphone. */
  const [micBlocked, setMicBlocked] = useState(false);
  const [tags, setTags] = useState("");
  /** The chip composer's in-progress tag; Enter or a comma commits it. */
  const [tagInput, setTagInput] = useState("");
  // Deep-linkable source: socials' Go Live sheet opens /studio?source=screen
  // for screen-share sessions. Read from location (not useSearchParams) to
  // avoid the Suspense boundary requirement in a client page.
  const [source, setSource] = useState<SourceType>(() => {
    if (typeof window === "undefined") return "camera";
    const q = new URLSearchParams(window.location.search).get("source");
    if (q === "screen") return "screen";
    if (q === "obs") return "obs";
    return "camera";
  });
  // Portrait by default on a phone, landscape on anything wider — and
  // remembered, since a streamer's shape is a habit, not a per-stream choice.
  const [orientation, setOrientation] = useState<Orientation>(() => {
    if (typeof window === "undefined") return "landscape";
    try {
      const saved = window.localStorage.getItem(ORIENTATION_KEY);
      if (saved === "portrait" || saved === "landscape") return saved;
    } catch {
      // No storage: fall through to the screen.
    }
    return window.matchMedia("(max-width: 767px)").matches ? "portrait" : "landscape";
  });
  const [facing, setFacing] = useState<Facing>("user");
  /** Cross-post this broadcast to the WorldSpace feed. Off unless asked. */
  const [postToWorldSpace, setPostToWorldSpace] = useState(false);
  const [panel, setPanel] = useState<Panel>("chat");
  const [phone, setPhone] = useState(false);
  /** Tablets: the stage on top, the console under it (owner: "the studio in the tab view looks squashed"). */
  const [stacked, setStacked] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const [liveRoom, setLiveRoom] = useState<Room | null>(null);
  const [connectedViewers, setConnectedViewers] = useState<
    Array<{ identity: string; name: string; joinedAt: Date }>
  >([]);
  const [screenShareActive, setScreenShareActive] = useState(false);

  // ---- OBS / RTMP ----
  /** Ingress credentials returned when the stream was created with source "obs". */
  const [ingressInfo, setIngressInfo] = useState<{
    url: string;
    streamKey: string;
  } | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [copiedField, setCopiedField] = useState<"url" | "key" | null>(null);
  /** True once the encoder's video is actually arriving. */
  const [obsFeedActive, setObsFeedActive] = useState(false);
  /** The encoder disconnected mid-broadcast; the stream is holding for it. */
  const [feedDropped, setFeedDropped] = useState(false);
  const [graceMs, setGraceMs] = useState(300_000);
  /**
   * The account's permanent encoder credentials, shown before going live so
   * OBS/vMix can be set up once and never touched again.
   */
  const [streamKey, setStreamKey] = useState<{ url: string; streamKey: string } | null>(null);
  // WHIP (OBS 30+, lower delay) has its own server and bearer token beside RTMP's.
  const [ingestProtocol, setIngestProtocol] = useState<"rtmp" | "whip">("rtmp");
  const [whipKey, setWhipKey] = useState<{ url: string; streamKey: string } | null>(null);
  const [rotatingKey, setRotatingKey] = useState(false);

  // ---- Staying on air through drops ----
  /**
   * "reconnecting": LiveKit is healing the connection itself — a few
   * seconds, usually. "rejoining": the connection died, and the studio is
   * fetching a fresh token and republishing while the stream holds (the API
   * keeps it live through the grace window; viewers see "Be right back").
   */
  const [conn, setConn] = useState<"live" | "reconnecting" | "rejoining">("live");
  /** A screen share can't restart without a click — browsers insist on one. */
  const [needsReshare, setNeedsReshare] = useState(false);

  // ---- Scenes ----
  /** The program's scene as the room sees it: layout and card. */
  const [scene, setScene] = useState<Scene>(DEFAULT_SCENE);
  /** A line under the card, the host's own words. */
  const [cardNote, setCardNote] = useState("");
  /** Go live on "Starting soon" rather than straight into the camera. */
  const [openOnCard, setOpenOnCard] = useState(false);
  /** A practice run: a private room with simulated chat and gifts — nothing announced, listed or paid. */
  const [practice, setPractice] = useState(false);
  // "Try one in a practice run", asked from a real broadcast's Battle tab: a
  // practice run starts off air, so it's set up for when this stream ends.
  const [practiceNext, setPracticeNext] = useState(false);
  const practiceNextRef = useRef(practiceNext);
  practiceNextRef.current = practiceNext;
  // "Start a battle", from the Go live chooser (/studio?battle=1, or its
  // event when the studio's already open): a line above Go live, then the
  // Battle tab — once — as the broadcast starts, practice run or real.
  const [battleAsk, setBattleAsk] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("battle") === "1");
  const battleAskRef = useRef(battleAsk);
  battleAskRef.current = battleAsk;
  useEffect(() => {
    const on = () => setBattleAsk(true);
    window.addEventListener(BATTLE_EVENT, on);
    return () => window.removeEventListener(BATTLE_EVENT, on);
  }, []);
  // The walkthrough's "Practice run" (/studio?practice=1): switch it on — never mid-broadcast.
  usePracticeRequest(() => {
    if (!isLive) setPractice(true);
  });
  // Send 540p with voice-tuned sound, for creators on a weak uplink.
  const [saveData, setSaveData] = useState(false);
  /** The screen being shared alongside the camera — the preview's main picture while it is. */
  const [localScreen, setLocalScreen] = useState<LocalVideoTrack | null>(null);
  /** The brand kit the graphics wear, saved to the channel. */
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);
  // Comments on screen: the channel's saved choices until changed here.
  const [featureSecondsPick, setFeatureSecondsPick] = useState<number | null>(null);
  /** Who can ask to join, as just picked here; the account's setting until then. */
  const [stageLinePick, setStageLinePick] = useState<StageLineRule | null>(null);
  const [giftsFromPick, setGiftsFromPick] = useState<number | null>(null);
  /** Lines moderators suggested for the screen, waiting on me. */
  const [featureQueue, setFeatureQueue] = useState<SuggestedLine[]>([]);
  // Stream health: what's being sent — the shared screen, else the camera —
  // read every 2 s while live from the browser; from an encoder, what
  // LiveKit's ingress is receiving, asked every 5 s.
  const measuredTrack = useCallback(() => localScreen ?? (camEnabled ? videoTrackRef.current : null), [localScreen, camEnabled]);
  const browserHealth = useStreamHealth(measuredTrack, {
    active: isLive && source !== "obs" && (camEnabled || Boolean(localScreen)),
    streamId,
  });
  const encoderHealth = useEncoderHealth({ active: isLive && source === "obs", streamId });
  const health = source === "obs" ? encoderHealth : browserHealth;
  // The goal bar and heat meter: each broadcast starts without them.
  const [goal, setGoal] = useState<StreamGoal | null>(null);
  const [heat, setHeat] = useState<StreamHeat | null>(null);
  const [goalsFor, setGoalsFor] = useState(streamId);
  if (goalsFor !== streamId) {
    setGoalsFor(streamId);
    setGoal(null);
    setHeat(null);
  }
  // Paid requests: the menu is the account's, the queue this broadcast's.
  const requestQueue = useRequestQueue(isLive ? streamId : null, liveRoom);
  // Sponsors for the Scenes panel: your own deals and the campaigns you're in.
  const sponsorships = useSponsorships(Boolean(user?.id));
  const reloadSponsorships = sponsorships.reload;
  // Run of show: the rundown (saved as it's edited), where the show is, and the prompter.
  const rundown = useRundown(Boolean(user?.id));
  const show = useRundownPosition(isLive ? streamId : null, isLive);
  // The room's event handler is set up once; it reaches the latest `take` through this.
  const rundownTakeRef = useRef(show.take);
  useEffect(() => {
    rundownTakeRef.current = show.take;
  }, [show.take]);
  const [prompterOn, setPrompterOn] = useState(false);
  const [focusSegment, setFocusSegment] = useState<string | null>(null);
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [showPlanner, setShowPlanner] = useState(false);
  /** What Vivid reads about the show on air (kept current below, read by the studio's Vivid context). */
  const vividShowRef = useRef<Record<string, unknown>>({});
  // Joined a campaign in another tab? Opening Scenes picks it up.
  useEffect(() => {
    if (panel !== "scenes") return;
    const t = setTimeout(() => void reloadSponsorships(), 0);
    return () => clearTimeout(t);
  }, [panel, reloadSponsorships]);
  // The audio desk: the mic's way out while it's on (lib/audio-desk.ts).
  // Its levels and the moments it plays for are this device's.
  const deskRef = useRef<AudioDesk | null>(null);
  const deskCtxRef = useRef<AudioContext | null>(null);
  const deskOnRef = useRef(false);
  const [deskOn, setDeskOn] = useState(false);
  const [deskStarting, setDeskStarting] = useState(false);
  const [deskSettings, setDeskSettings] = useState<DeskSettings>(readDeskSettings);
  const [deskMoments, setDeskMoments] = useState<DeskMoments>({ giftFromMinor: 500, battleWin: true });
  const deskMomentsRef = useRef(deskMoments);
  deskMomentsRef.current = deskMoments;
  /** Battles the airhorn has already played for. */
  const hornedRef = useRef<Set<string>>(new Set());
  const meRef = useRef<string | undefined>(undefined);
  meRef.current = user?.id;
  /** The guest faders as the scene has them — for audio that arrives later. */
  const gainsRef = useRef<Record<string, number>>({});
  const gainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const featureSeconds = featureSecondsPick ?? user?.settings?.featureSeconds ?? 20;
  const stageLine = stageLinePick ?? readStageLine({ who: user?.settings?.stageRequests, accountDays: user?.settings?.stageAccountDays });
  const giftsFrom = giftsFromPick ?? user?.settings?.featureGiftsFromMinor ?? 0;
  const rejoinRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempt: number } | null>(null);
  /** The live session's facts, for room events and timers that outlive a render. */
  const liveRef = useRef({ streamId: null as string | null, source: "camera" as SourceType, title: "", micEnabled: true, camEnabled: true });
  // Wired to the real handlers further down, once they're declared.
  const onRoomGoneRef = useRef<(reason: DisconnectReasonType | undefined, reasons: typeof DisconnectReasonType) => void>(() => {});
  /** Set by a takedown event, so the room closing next is explained. */
  const takenDownRef = useRef(false);
  const attemptRejoinRef = useRef<() => Promise<void>>(async () => {});
  /** When a resumed stream really started, so its clock doesn't restart at 0:00. */
  const resumedStartRef = useRef<Date | null>(null);

  // ---- Session stats ----
  const [peakViewers, setPeakViewers] = useState(0);
  const [sessionTipsMinor, setSessionTipsMinor] = useState(0);

  // ---- Stage guests ----
  const [stageRequests, setStageRequests] = useState<StageUser[]>([]);
  // The battle this broadcast is in, fed by the battle panel; the preview
  // splits to show the opponent the way viewers see it.
  const [battle, setBattle] = useState<BattleView | null>(null);
  const [liveGuests, setLiveGuests] = useState<StageUser[]>([]);
  /** Accepted, but not on yet: in the room checking their devices, seen only by the crew (producer mode). */
  const [backstageGuests, setBackstageGuests] = useState<StageUser[]>([]);
  // The room's handler is set up once; it reaches the lists as they stand through these.
  const stageRequestsRef = useRef(stageRequests);
  stageRequestsRef.current = stageRequests;
  const backstageRef = useRef(backstageGuests);
  backstageRef.current = backstageGuests;
  /** What chat's talking about ($cashtags), for a chart in one tap (market layer). */
  const [tickers, setTickers] = useState<Trending[]>([]);
  // The market as director: moments the markets the show cares about just
  // had, for one-tap actions; and a market question one of them filled in.
  const marketSuggestions = useMarketSuggestions(isLive ? streamId : null);
  const pushSuggestion = marketSuggestions.push;
  const [marketPreset, setMarketPreset] = useState<MarketQuestionPreset | null>(null);
  /** userId currently being approved/denied/removed, for per-row spinners. */
  const [stageBusyId, setStageBusyId] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  /** Guests' video tracks, rendered as tiles over the preview. */
  const [guestTiles, setGuestTiles] = useState<
    Array<{ identity: string; name: string }>
  >([]);
  const guestTracksRef = useRef<Map<string, AttachableVideoTrack>>(new Map());
  const guestAudioElsRef = useRef<Map<object, HTMLAudioElement>>(new Map());
  // A 2v2's other pair, a tile each, over one connection to their room.
  const pairOpponent =
    battle && battle.mode === "2v2" && streamId ? (sideOf(battle, streamId) === "host" ? battle.challenger : battle.host) : null;
  const pairTracks = useRoomPreview(pairOpponent?.streamId ?? null);

  // The auto-director: the layout follows whoever's talking (lib/director.ts).
  // Off until the host turns it on; remembered on this device.
  const [directorOn, setDirectorOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setDirectorOn(localStorage.getItem("xtream:director") === "on");
      } catch {
        // No storage: it starts off.
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const hostIdentities = useMemo(() => (user?.id ? [user.id, `obs-${user.id}`] : []), [user?.id]);
  // The auto-director cuts between the people on stage — never to the interpreter, who stays in their corner.
  const interpreterId = scene.interpreter ?? null;
  // Backstage guests are in the room, not on the stage: the picture, the
  // director and the panels all leave them out until they're put on.
  const backstageIds = useMemo(() => new Set(backstageGuests.map((g) => g.userId)), [backstageGuests]);
  const stageTiles = useMemo(() => guestTiles.filter((t) => !backstageIds.has(t.identity)), [guestTiles, backstageIds]);
  // The phone cam (cam-<my id>), while it's sending: an angle for the
  // program, never a guest. Where it sits is scene.phoneSlot.
  const phoneTrackRef = useRef<AttachableVideoTrack | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  /** Bumped by the second-camera tip: the live panel comes up with a code on it. */
  const [phoneAsk, setPhoneAsk] = useState(0);
  // The published camera, as state: the face tracker follows it (the ref alone wouldn't tell it).
  const [liveCam, setLiveCam] = useState<LocalVideoTrack | null>(null);
  // The privacy shield on a screen share: the share's track while there is
  // one, the shield's settings (followed live), and whether the host is
  // marking zones over the picture.
  const [shieldTrack, setShieldTrack] = useState<LocalVideoTrack | null>(null);
  const [editingZones, setEditingZones] = useState(false);
  const shield = useShieldSettings();
  useEffect(() => {
    if (shieldTrack) void applyShield(shieldTrack, shield);
  }, [shield, shieldTrack]);
  // Sound & look, kept per browser: the noise filter, Music mode and a voice
  // preset go through the audio desk; blur, a background and a colour look
  // ride the camera track as its processor.
  const voice = useVoiceSettings();
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const look = useLookSettings();
  const lookImage = useLookImage();
  const lookRef = useRef({ look, imageUrl: lookImage?.url ?? null });
  lookRef.current = { look, imageUrl: lookImage?.url ?? null };
  // The brand as viewers see it: the Set the stream wears over the creator's own kit.
  const shownBrand = useMemo(() => brandWithSet(brand), [brand]);
  const brandRef = useRef(shownBrand);
  brandRef.current = shownBrand;
  // Both answers come from the browser, so they wait for the client.
  const [looksSupported, setLooksSupported] = useState(false);
  const [noiseFilterOk, setNoiseFilterOk] = useState(true);
  useEffect(() => {
    setLooksSupported(isLooksSupported());
    setNoiseFilterOk(noiseFilterSupported());
  }, []);
  const [deviceOk, setDeviceOk] = useState<boolean | null>(null);
  const [lookNote, setLookNote] = useState<string | null>(null);
  const guestIdentities = useMemo(() => stageTiles.filter((t) => t.identity !== interpreterId).map((t) => t.identity), [stageTiles, interpreterId]);
  const directorBlocked: DirectorBlock =
    guestIdentities.length === 0
      ? "alone"
      : scene.card
        ? "card"
        : battle
          ? "battle"
          : scene.layout === "screen-face" || scene.layout === "chart-face"
            ? "content"
            : null;
  const director = useAutoDirector({
    on: directorOn && isLive,
    room: liveRoom,
    host: hostIdentities,
    guests: guestIdentities,
    current: shotOf(scene),
    blocked: directorBlocked,
    // Its own cuts, marked as its own, so they don't pause it.
    onCut: (shot) => void applyScene({ layout: shot.layout, spotlight: shot.spotlight }, "director"),
  });
  /** Who framed the shot that paused the director: the host here, or a producer at their console. */
  const [framedBy, setFramedBy] = useState<"you" | "elsewhere">("you");
  // The room's handlers are set up once; they reach the latest scene and the director through these.
  const sceneNowRef = useRef(scene);
  const framedElsewhereRef = useRef(() => {});
  useEffect(() => {
    sceneNowRef.current = scene;
    framedElsewhereRef.current = () => {
      setFramedBy("elsewhere");
      director.pause();
    };
  });
  // Vivid on air (Phase 3, Vivid as producer): while live, Vivid hears the
  // host only while they hold the talk key — the room is who they're talking
  // to. And while Vivid speaks, viewers are told it's an AI voice, in case
  // it's heard on air (desktop audio in OBS, a speaker near the mic).
  const vivid = useSiraVivid();
  const vividOnAir = isLive && Boolean(vivid?.isConnected);
  const ptt = usePushToTalk();
  useEffect(() => {
    setPushToTalk(vividOnAir);
    return () => setPushToTalk(false);
  }, [vividOnAir]);
  useEffect(() => {
    if (!vividOnAir) return;
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
    };
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "v" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e)) setTalkHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "v") setTalkHeld(false);
    };
    const letGo = () => setTalkHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", letGo);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", letGo);
      setTalkHeld(false);
    };
  }, [vividOnAir]);
  const vividSpeaking = isLive && vivid?.state === "speaking";
  useEffect(() => {
    if (!liveRoom || !isLive) return;
    const say = (on: boolean) =>
      void liveRoom.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify({ __evt: "ai_voice", on })), { reliable: true })
        .catch(() => {});
    say(vividSpeaking);
    if (!vividSpeaking) return;
    // Kept fresh for anyone who joins mid-sentence; viewers let it lapse on their own.
    const t = setInterval(() => say(true), 10_000);
    return () => clearInterval(t);
  }, [vividSpeaking, liveRoom, isLive]);
  const talkHold = (props: { phone?: boolean }) => (
    // Held to talk, so a long-press is the talk, never a tip.
    <Tip label="Hold to talk to Vivid" hint="Hold V" touch={false} side={props.phone ? "left" : "top"}>
      <button
        type="button"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setTalkHeld(true);
        }}
        onPointerUp={() => setTalkHeld(false)}
        onPointerCancel={() => setTalkHeld(false)}
        onLostPointerCapture={() => setTalkHeld(false)}
        onContextMenu={(e) => e.preventDefault()}
        aria-pressed={ptt.held}
        aria-label="Hold to talk to Vivid"
        data-tour="studio-vivid"
        className={cn(
          "press flex touch-none items-center justify-center gap-2 rounded-full font-semibold transition-colors select-none",
          props.phone ? "size-11" : "h-11 px-4 text-[13px]",
          ptt.held ? "bg-white text-[#0b0708]" : props.phone ? "obj text-white" : "text-white hover:bg-white/[0.12]"
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", ptt.held ? "animate-pulse bg-ember" : "bg-white/45")} />
        {!props.phone && (ptt.held ? "Vivid's listening" : "Hold for Vivid")}
      </button>
    </Tip>
  );

  // The gift handler lives in the room's event callback; it reaches the director through this.
  const directorReactRef = useRef<() => void>(() => {});
  useEffect(() => {
    directorReactRef.current = directorOn ? director.react : () => {};
  }, [directorOn, director.react]);
  const setDirector = (on: boolean) => {
    setDirectorOn(on);
    if (on) director.resume();
    try {
      localStorage.setItem("xtream:director", on ? "on" : "off");
    } catch {
      // It's on for this visit.
    }
  };

  // ---- Co-live ----
  /** An open invite from another live host, shown in the Stage tab. */
  const [coLiveInvite, setCoLiveInvite] = useState<{
    fromStreamId: string;
    fromUsername: string;
    fromDisplayName?: string;
    fromAvatar?: string;
    fromTitle?: string;
  } | null>(null);
  const [coLiveBusy, setCoLiveBusy] = useState(false);
  /** Streams I've already invited this session. */
  const [coLiveInvited, setCoLiveInvited] = useState<Set<string>>(new Set());
  /** Other hosts live right now — co-live candidates. */
  const [otherLive, setOtherLive] = useState<
    Array<{
      _id: string;
      title: string;
      viewers: number;
      streamerId?: { displayName?: string; username?: string; avatar?: string };
    }>
  >([]);

  // ---- Tip alerts ----
  const [tipAlerts, setTipAlerts] = useState<
    Array<{ id: string; username: string; amountLabel: string; emoji: string }>
  >([]);
  const chimeCtxRef = useRef<AudioContext | null>(null);

  // End Stream confirmation dialog. (Going live asks nothing: it counts 3·2·1 instead.)
  const [confirmDialog, setConfirmDialog] = useState<"end" | null>(null);

  // Custom thumbnail (base64 data URI) chosen by the host
  const [customThumbnail, setCustomThumbnail] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // Host share feedback
  const [shareCopied, setShareCopied] = useState(false);

  // Auto-hide overlay controls while live
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // LiveKit refs
  const roomRef = useRef<Room | null>(null);
  const videoTrackRef = useRef<LocalVideoTrack | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const startTimeRef = useRef<Date | null>(null);
  const elapsedInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Preview camera locally before going live
  const [previewTrack, setPreviewTrack] = useState<LocalVideoTrack | null>(
    null
  );

  const startPreview = useCallback(async () => {
    try {
      // Stop any existing preview
      if (previewTrack) {
        previewTrack.stop();
      }

      if (source === "camera") {
        setCamIssue((was) => was ?? "waiting");
        const { createLocalVideoTrack } = await import("livekit-client");
        const track = await createLocalVideoTrack({
          resolution: captureResolution(orientation, saveData),
          facingMode: facing,
        });
        setPreviewTrack(track);
        setCamIssue(null);
        if (videoElRef.current) {
          track.attach(videoElRef.current);
        }
      }
      // Screen share can't be previewed without a prompt, skip it
    } catch (err) {
      // No camera: say why, plainly, so the fix is obvious (the stage and
      // the Go live button both offer it).
      setPreviewTrack(null);
      const name = err instanceof Error ? err.name : "";
      setCamIssue(
        name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError"
          ? "missing"
          : name === "NotReadableError" || name === "TrackStartError" || name === "AbortError"
            ? "busy"
            : "denied"
      );
    }
  }, [source, orientation, facing]); // eslint-disable-line react-hooks/exhaustive-deps

  // The microphone is asked for with the camera, on the way in — not after
  // the 3·2·1, when a browser prompt would land mid-countdown. A mic that's
  // been refused holds Go live back, with the way to fix it.
  const checkMic = useCallback(async (ask: boolean) => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    let state: PermissionState | null = null;
    try {
      const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      state = status?.state ?? null;
      // Allowed later from the address bar: Go live lets go at once.
      if (status) status.onchange = () => setMicBlocked(status.state === "denied");
    } catch {
      // No Permissions API for the mic (older Safari): go-live asks, as before.
    }
    if (state === "granted") {
      setMicBlocked(false);
      return;
    }
    if (state === "denied" && !ask) {
      setMicBlocked(true);
      return;
    }
    if (state === null && !ask) return;
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      setMicBlocked(false);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      // A missing mic is go-live's to report; a refused one is fixable here.
      setMicBlocked(name === "NotAllowedError" || name === "SecurityError");
    }
  }, []);

  // Start preview on mount and whenever the source, shape or camera
  // changes (only if not live) — a new shape is a new capture.
  useEffect(() => {
    // Minimized, the studio is only carrying a broadcast — no preview camera.
    if (!isLive && source === "camera" && !minimizedRef.current) {
      startPreview();
    }
    return () => {
      if (previewTrack) {
        previewTrack.stop();
      }
    };
  }, [source, orientation, facing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the camera's up, the mic's question comes straight after it — once a visit.
  const micAskedRef = useRef(false);
  useEffect(() => {
    if (!previewTrack || isLive || micAskedRef.current) return;
    const t = setTimeout(() => {
      micAskedRef.current = true;
      void checkMic(true);
    }, 0);
    return () => clearTimeout(t);
  }, [previewTrack, isLive, checkMic]);

  /** The camera the look rides right now: the preview before going live, the published track after. Never a shared screen or an encoder's feed. */
  const lookTrack = () => (source !== "camera" || localScreen ? null : isLive ? videoTrackRef.current : previewTrack);
  /** Put the chosen look on a camera track; a background that can't start leaves the look on and says why. */
  const applyLookTo = (track: LocalVideoTrack | null) => {
    // A track a drop already ended (a rejoin with the camera off) takes no look; the next camera will.
    if (!track || !looksSupported || track.mediaStreamTrack?.readyState === "ended") return;
    const { look: settings, imageUrl } = lookRef.current;
    const b = brandRef.current;
    void applyLook(track, settings, { imageUrl, brand: { fill: ACCENTS[b.accent].fill, logoUrl: b.logoUrl } }).then((r) => {
      if (!r.ok) {
        setLookNote(r.reason);
        // A background that couldn't start is a setting to remember; a track
        // or GPU that failed underneath isn't — the host's choice stands.
        if (r.applied.look === settings.look) setLookSettings(r.applied);
      }
    });
  };
  // The look follows its settings, the brand, and whichever camera track is current.
  useEffect(() => {
    applyLookTo(lookTrack());
  }, [look.background, look.look, look.smooth, look.face, lookImage?.url, brand.accent, brand.logoUrl, looksSupported, previewTrack, isLive, source, localScreen]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeVoice = (next: VoiceSettings) => {
    saveVoiceSettings(next);
    // On air, the desk follows at once (the filter, the preset); Music mode's capture waits for the next stream.
    deskRef.current?.setVoice(next);
  };
  /** A blur is tried on this device first, once: too slow, and it stays off with a word. */
  const changeLook = async (next: LookSettings) => {
    setLookNote(null);
    if (next.background.startsWith("blur") && deviceOk === null) {
      const track = lookTrack();
      if (track) {
        const t = await deviceTest(track);
        setDeviceOk(t.ok);
        if (!t.ok) {
          setLookSettings({ ...next, background: "none" });
          return;
        }
      }
    }
    setLookSettings(next);
  };

  // Smoothing changes how the host looks, so viewers are told ("Effects on"
  // on the watch page). Kept true to the camera while live; a new stream
  // starts without it, so only a change is worth a request.
  const appearanceFx = source === "camera" && !localScreen && looksSupported && changesAppearance(look);
  const fxSent = useRef<{ id: string; on: boolean } | null>(null);
  useEffect(() => {
    if (!isLive || !streamId) {
      fxSent.current = null;
      return;
    }
    const sent = fxSent.current;
    if (sent?.id === streamId && sent.on === appearanceFx) return;
    fxSent.current = { id: streamId, on: appearanceFx };
    if (!sent && !appearanceFx) return;
    void apiFetch(`/api/streams/${streamId}`, { method: "PATCH", body: JSON.stringify({ appearanceFx }) }).catch(() => {
      // Try again on the next change rather than leave viewers told the wrong thing.
      fxSent.current = null;
    });
  }, [isLive, streamId, appearanceFx]);

  // The Set the stream wears (gift-reactive Sets): its gift effects around
  // the host's face — on every viewer's screen from the anchors the face
  // tracker sends, and on this preview — its gift sounds, its stinger.
  const activeSet = setById(brand.set ?? null);
  const activeSetRef = useRef(activeSet);
  activeSetRef.current = activeSet;
  const faceFeed = useAnchorFeed();
  const effectsRef = useRef<GiftEffectsHandle | null>(null);
  const setSoundGate = useMemo(() => soundGate(), []);
  // "Try it" in the Sets panel follows the face for a while too, so the crown lands on a head.
  const [trying, setTrying] = useState(false);
  const tryingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (tryingTimer.current) clearTimeout(tryingTimer.current);
  }, []);
  const tryEffect = (effect: Parameters<GiftEffectsHandle["play"]>[0]) => {
    setTrying(true);
    if (tryingTimer.current) clearTimeout(tryingTimer.current);
    tryingTimer.current = setTimeout(() => setTrying(false), 20_000);
    effectsRef.current?.play(effect);
  };
  // The camera is the main picture: not a shared screen, and not cut to the phone cam.
  const cameraIsMain = source === "camera" && !localScreen && !(phoneConnected && placePhone(scene.phoneSlot ?? "off", scene.layout).cell);
  const faceCam = cameraIsMain ? (isLive ? liveCam : previewTrack) : null;
  // Viewers need the face at full rate only while an effect is on screen:
  // a trickle between gifts (so the next effect starts near the face), and
  // none at all when the set draws nothing on it ("Try it" is the host's own).
  const faceBoostUntil = useRef(0);
  const faceState = useFaceAnchors({
    track: faceCam,
    room: isLive ? liveRoom : null,
    feed: faceFeed,
    // Skin smoothing and a worn face effect need the face too: the look paints
    // its skin mask and places the effect from it (lib/looks.ts) — the effect
    // at twice the rate, since it's drawn into every frame.
    enabled: Boolean(faceCam) && (setUsesFace(activeSet) || trying || look.smooth > 0 || look.face !== "none"),
    maxHz: look.face !== "none" ? FACE_WEAR_HZ : undefined,
    publishHz: () => (!setUsesFace(activeSetRef.current) ? 0 : Date.now() < faceBoostUntil.current ? 12 : 1),
  });

  /** The Sets (gift-reactive Sets): used from the setup screen before going live, and the Scenes panel after. */
  const setsPanel = (
    <SetsPanel
      active={brand.set ?? null}
      onBrand={setBrand}
      look={look.look}
      onLook={(next) => void changeLook({ ...look, look: next })}
      // A set's layout needs a stream to lay out; before going live, the look and the effects are what it brings.
      onLayout={(layout) => {
        if (isLive) void applyScene(layout === "chart-face" && !scene.chart ? { layout, chart: DEFAULT_CHART } : { layout });
      }}
      // Its sounds are read from the set itself when a gift lands (the desk plays them).
      onSounds={() => {}}
      onTry={tryEffect}
      face={faceState}
      soundsReady={deskOn}
      headless
    />
  );
  // What each folded section is set to, in a few words.
  const setsSummary = activeSet?.name ?? "No set";
  const shieldSummary = [shield.enabled ? "Checks on" : "Checks off", shield.zones.length ? `${shield.zones.length} covered ${shield.zones.length === 1 ? "area" : "areas"}` : null].filter(Boolean).join(" · ");
  const secondCameraSummary = phoneConnected ? (phoneOnScreen(scene.phoneSlot ?? "off", scene.layout) ? "Phone on air" : "Phone connected") : "Add a phone as a second angle";

  // Remember the shape; know the screen.
  useEffect(() => {
    try {
      window.localStorage.setItem(ORIENTATION_KEY, orientation);
    } catch {
      // Fine.
    }
  }, [orientation]);
  useEffect(() => {
    try {
      setPostToWorldSpace(window.localStorage.getItem(WORLDSPACE_KEY) === "1");
    } catch {
      // Storage blocked: stays off, which is the safe default.
    }
  }, []);
  // Going live from a booking (/studio?scheduled=<id>, from Schedule): its
  // title, category and choices come across, and starting it turns that
  // booking — its card, its link, everyone's reminder — into this broadcast.
  const [booking, setBooking] = useState<{ id: string; title: string; at: string; notifyFollowers: boolean } | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("scheduled");
    if (!id) return;
    let alive = true;
    apiFetch<{
      success: boolean;
      data: { stream: { _id: string; title: string; category: Category; tags?: string[]; status: string; startedAt?: string; scheduledStartAt?: string; notifyFollowers?: boolean; postToWorldSpace?: boolean } };
    }>(`/api/streams/${id}`)
      .then((r) => {
        const s = r.data.stream;
        if (!alive || s.status !== "upcoming") return;
        setBooking({ id: String(s._id), title: s.title, at: s.scheduledStartAt ?? s.startedAt ?? "", notifyFollowers: s.notifyFollowers !== false });
        setTitle(s.title);
        setCategory(s.category);
        if (s.tags?.length) setTags(s.tags.join(", "));
        // The booking's choice, not the remembered one — and not remembered.
        setPostToWorldSpace(Boolean(s.postToWorldSpace));
      })
      .catch(() => {
        // Gone or not ours: the studio just starts a fresh stream.
      });
    return () => {
      alive = false;
    };
  }, []);
  const toggleWorldSpace = (on: boolean) => {
    setPostToWorldSpace(on);
    try {
      window.localStorage.setItem(WORLDSPACE_KEY, on ? "1" : "0");
    } catch {
      // The choice just won't persist.
    }
  };
  useEffect(() => {
    // A phone on its side is still a phone: too short for a console.
    const mq = window.matchMedia("(max-width: 767px), (max-height: 500px)");
    const tab = window.matchMedia("(min-width: 768px) and (max-width: 1023px) and (min-height: 501px)");
    const apply = () => {
      setPhone(mq.matches);
      setStacked(tab.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    tab.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      tab.removeEventListener("change", apply);
    };
  }, []);

  // Live on a tablet or desktop, the console owns the screen: the app's rail
  // and top bar step aside (the rule is in globals.css, keyed on this) —
  // until you minimize it to browse, when the app comes back.
  useEffect(() => {
    if (!isLive || minimized) return;
    document.documentElement.dataset.studioLive = "1";
    return () => {
      delete document.documentElement.dataset.studioLive;
    };
  }, [isLive, minimized]);

  // Minimizing mid-question: the question goes; the broadcast carries on.
  useEffect(() => {
    if (minimized) setConfirmDialog(null);
  }, [minimized]);

  // Elapsed timer
  useEffect(() => {
    if (isLive) {
      startTimeRef.current = resumedStartRef.current ?? new Date();
      resumedStartRef.current = null;
      elapsedInterval.current = setInterval(() => {
        if (!startTimeRef.current) return;
        const diff = Math.floor(
          (Date.now() - startTimeRef.current.getTime()) / 1000
        );
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        setElapsed(
          h > 0
            ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(
                2,
                "0"
              )}`
            : `${m}:${String(s).padStart(2, "0")}`
        );
      }, 1000);
    } else {
      if (elapsedInterval.current) clearInterval(elapsedInterval.current);
      setElapsed("0:00");
    }
    return () => {
      if (elapsedInterval.current) clearInterval(elapsedInterval.current);
    };
  }, [isLive]);

  const copyIngressField = async (field: "url" | "key", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Clipboard unavailable — the value is selectable text anyway.
    }
  };

  // Peak is a session stat the dashboard shows; the server tracks its own.
  useEffect(() => {
    setPeakViewers((p) => Math.max(p, viewerCount));
  }, [viewerCount]);

  /** Two-note chime when a tip lands — the streamer reacts on air, which is
   *  what makes the next tip happen. WebAudio, so no asset to load. */
  const playTipChime = useCallback(() => {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      if (!chimeCtxRef.current) chimeCtxRef.current = new Ctor();
      const ctx = chimeCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      [880, 1318.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const at = now + i * 0.09;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.16, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.55);
      });
    } catch {
      // No audio context — the toast still shows.
    }
  }, []);

  /**
   * Studio-side room events: stage requests/transitions and tip alerts.
   * Chat rows are handled inside LiveChat's own listener on the same room.
   */
  const handleStudioData = useCallback(
    (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as {
          __evt?: string;
          action?: string;
          userId?: string;
          username?: string;
          avatar?: string;
          type?: string;
          tipAmount?: string;
          emoji?: string;
          id?: string;
          state?: string;
          graceMs?: number;
        };
        // A producer moved the show on from their console: the prompter follows.
        if (data.__evt === "rundown") {
          const next = readPosition((data as { position?: unknown }).position);
          if (next) rundownTakeRef.current(next);
          return;
        }
        // A show rule fired a sound (rules.ts on the API): the audio desk
        // plays it into the broadcast — only while the desk is on.
        if (data.__evt === "rule_fire") {
          const sounds = (data as { sounds?: unknown }).sounds;
          if (deskOnRef.current && Array.isArray(sounds)) {
            for (const pad of sounds) {
              if (PADS.some((p) => p.id === pad)) void deskRef.current?.playPad(pad as PadId);
            }
          }
          return;
        }
        // A battle won: the airhorn, once, if the desk is on and it's wanted.
        if (data.__evt === "battle") {
          const b = (data as { battle?: BattleView }).battle;
          if (b?.status === "ended" && b.winnerId && b.winnerId === meRef.current && deskOnRef.current && deskMomentsRef.current.battleWin && !hornedRef.current.has(b.id)) {
            hornedRef.current.add(b.id);
            void deskRef.current?.playPad("airhorn");
          }
          return;
        }
        // A platform admin took the stream down after a report; the room
        // closes next, and the host is told why.
        if (data.__evt === "takedown") {
          takenDownRef.current = true;
          return;
        }
        // A gift, a like or an ally moved the goal; a gift warmed the meter.
        if (data.__evt === "goal") {
          const next = readGoal((data as { goal?: unknown }).goal);
          if (next) setGoal((g) => newerGoal(g, next));
          return;
        }
        if (data.__evt === "heat") {
          const next = readHeat((data as { heat?: unknown }).heat);
          if (next) setHeat((h) => newerHeat(h, next));
          return;
        }
        // The encoder dropped or came back — the API decides, we display.
        if (data.__evt === "feed") {
          setFeedDropped(data.state === "reconnecting");
          if (typeof data.graceMs === "number") setGraceMs(data.graceMs);
          return;
        }
        if (data.__evt === "colive_invite") {
          const evt = data as {
            fromStreamId?: string;
            fromUsername?: string;
            fromDisplayName?: string;
            fromAvatar?: string;
            fromTitle?: string;
          };
          if (evt.fromStreamId && evt.fromUsername) {
            setCoLiveInvite({
              fromStreamId: evt.fromStreamId,
              fromUsername: evt.fromUsername,
              fromDisplayName: evt.fromDisplayName,
              fromAvatar: evt.fromAvatar,
              fromTitle: evt.fromTitle,
            });
            playTipChime();
          }
          return;
        }
        if (data.__evt === "colive_decline") {
          const evt = data as { byUsername?: string };
          setStageError(
            `${evt.byUsername ?? "They"} declined the co-live invite.`
          );
          return;
        }
        if (data.__evt === "guest_request" && data.userId) {
          const row: StageUser = {
            userId: data.userId,
            username: data.username ?? "viewer",
            avatar: data.avatar ?? "",
            standing: readStanding((data as { standing?: unknown }).standing),
          };
          setStageRequests((prev) =>
            prev.some((r) => r.userId === row.userId) ? prev : [...prev, row]
          );
          return;
        }
        if (data.__evt === "guest_update" && data.userId) {
          const uid = data.userId;
          const drop = (list: StageUser[]) => list.filter((g) => g.userId !== uid);
          const add = (list: StageUser[], row: StageUser | null) => (!row || list.some((g) => g.userId === uid) ? list : [...list, row]);
          // Whoever they are: the row we already had, or the event's own name.
          const known = () =>
            stageRequestsRef.current.find((r) => r.userId === uid) ??
            backstageRef.current.find((g) => g.userId === uid) ??
            (data.username ? { userId: uid, username: data.username, avatar: data.avatar ?? "" } : null);
          if (data.action === "cancelled" || data.action === "denied") {
            setStageRequests(drop);
          } else if (data.action === "backstage") {
            const row = known();
            setStageRequests(drop);
            setBackstageGuests((b) => add(b, row));
          } else if (data.action === "approved") {
            const row = known();
            setStageRequests(drop);
            setBackstageGuests(drop);
            setLiveGuests((live) => add(live, row));
          } else if (data.action === "removed" || data.action === "left") {
            setLiveGuests(drop);
            setBackstageGuests(drop);
          }
          return;
        }
        // What chat's talking about, for the Scenes panel's chips (market layer).
        if (data.__evt === "tickers") {
          setTickers(readTickers((data as { tickers?: unknown }).tickers));
          return;
        }
        // A market the show cares about just moved: a suggestion for the Scenes panel.
        if (data.__evt === "suggestion") {
          pushSuggestion((data as { suggestion?: unknown }).suggestion);
          return;
        }
        if (!data.__evt && data.type === "tip" && data.username) {
          const amountStr = data.tipAmount ?? "0";
          const label = amountStr.endsWith(".00")
            ? `$${amountStr.slice(0, -3)}`
            : `$${amountStr}`;
          const id = String(data.id ?? `tip-${Date.now()}-${Math.random()}`);
          const cents = Math.round(parseFloat(amountStr) * 100) || 0;
          setSessionTipsMinor((t) => t + cents);
          // The Set's effect for this gift, round the host's face on this preview
          // (viewers draw their own) — and the face goes to viewers at full rate while it plays.
          if (effectsRef.current?.gift({ emoji: data.emoji }, { id })) faceBoostUntil.current = Date.now() + 10_000;
          // Its sound, when the set has one for this gift (at most one a gap, for everyone);
          // else, for a big gift, the desk's ka-ching.
          const setPad = soundForGift(activeSetRef.current, { emoji: data.emoji });
          const from = deskMomentsRef.current.giftFromMinor;
          if (setPad) {
            if (deskOnRef.current && setSoundGate(setPad)) void deskRef.current?.playPad(setPad);
          } else if (deskOnRef.current && from > 0 && cents >= from) void deskRef.current?.playPad("kaching");
          // …and, with the auto-director on, the host alone for their reaction.
          if (cents >= 2000) directorReactRef.current();
          playTipChime();
          setTipAlerts((prev) => [
            ...prev.slice(-2),
            {
              id,
              username: data.username!,
              amountLabel: label,
              emoji: data.emoji || "💰",
            },
          ]);
          setTimeout(
            () => setTipAlerts((prev) => prev.filter((t) => t.id !== id)),
            6000
          );
        }
      } catch {
        // Not an event payload
      }
    },
    [playTipChime, pushSuggestion, setSoundGate]
  );
  const handleStudioDataRef = useRef(handleStudioData);
  handleStudioDataRef.current = handleStudioData;

  // ---- Stage actions (host) ----

  const approveGuest = async (userId: string) => {
    if (!streamId || stageBusyId) return;
    setStageBusyId(userId);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${streamId}/guests/${userId}/approve`, {
        method: "POST",
      });
      // The guest_update event moves the row too; doing it here as well keeps
      // the UI honest if our own event delivery hiccups.
      const row = stageRequestsRef.current.find((r) => r.userId === userId) ?? backstageRef.current.find((g) => g.userId === userId);
      setStageRequests((prev) => prev.filter((r) => r.userId !== userId));
      setBackstageGuests((prev) => prev.filter((g) => g.userId !== userId));
      if (row) setLiveGuests((live) => (live.some((g) => g.userId === userId) ? live : [...live, row]));
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't approve that request."
      );
    } finally {
      setStageBusyId(null);
    }
  };

  const denyGuest = async (userId: string) => {
    if (!streamId || stageBusyId) return;
    setStageBusyId(userId);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${streamId}/guests/${userId}/deny`, {
        method: "POST",
      });
      setStageRequests((prev) => prev.filter((r) => r.userId !== userId));
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't decline that request."
      );
    } finally {
      setStageBusyId(null);
    }
  };

  /** Accept someone into the room without putting them on: they check their devices where only the crew sees them. */
  const backstageGuest = async (userId: string) => {
    if (!streamId || stageBusyId) return;
    setStageBusyId(userId);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${streamId}/guests/${userId}/backstage`, { method: "POST" });
      const row = stageRequestsRef.current.find((r) => r.userId === userId);
      setStageRequests((prev) => prev.filter((r) => r.userId !== userId));
      if (row) setBackstageGuests((b) => (b.some((g) => g.userId === userId) ? b : [...b, row]));
    } catch (err) {
      setStageError(err instanceof Error ? err.message : "Couldn't bring them backstage.");
    } finally {
      setStageBusyId(null);
    }
  };

  const removeGuest = async (userId: string) => {
    if (!streamId || stageBusyId) return;
    setStageBusyId(userId);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${streamId}/guests/${userId}/remove`, {
        method: "POST",
      });
      setLiveGuests((prev) => prev.filter((g) => g.userId !== userId));
      setBackstageGuests((prev) => prev.filter((g) => g.userId !== userId));
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't remove that guest."
      );
    } finally {
      setStageBusyId(null);
    }
  };

  /** Who can ask to join: saved to the channel, and the room hears it at once. */
  const saveStageLine = (next: StageLineRule) => {
    const before = stageLine;
    setStageLinePick(next);
    setStageError(null);
    apiFetch("/api/user/me", {
      method: "PATCH",
      body: JSON.stringify({ settings: { stageRequests: next.who, stageAccountDays: next.accountDays } }),
    }).catch(() => {
      setStageLinePick(before);
      setStageError("Couldn't change who can ask — try again.");
    });
  };

  // Who's asking and who's on, as the stream has it — a reload or a resume
  // keeps the line and the stage list, not only what arrives after.
  useEffect(() => {
    if (!streamId || !isLive) return;
    let alive = true;
    type Row = { userId: string; username: string; avatar: string; standing?: unknown };
    apiFetch<{ success: boolean; data: { live: Row[]; requests: Row[]; backstage?: Row[] } }>(`/api/streams/${streamId}/guests`)
      .then((r) => {
        if (!alive) return;
        const row = (g: Row): StageUser => ({ userId: g.userId, username: g.username, avatar: g.avatar, standing: readStanding(g.standing) });
        const merge = (prev: StageUser[], rows: Row[]) => [...prev, ...rows.filter((g) => !prev.some((p) => p.userId === g.userId)).map(row)];
        setStageRequests((prev) => merge(prev, r.data.requests));
        setLiveGuests((prev) => merge(prev, r.data.live));
        setBackstageGuests((prev) => merge(prev, r.data.backstage ?? []));
      })
      .catch(() => {});
    // …and what chat's been talking about (market layer).
    apiFetch<{ success: boolean; data: { tickers: unknown } }>(`/api/streams/${streamId}/tickers`)
      .then((r) => alive && setTickers(readTickers(r.data.tickers)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [streamId, isLive]);

  // ---- Co-live actions ----

  const inviteCoLive = async (targetStreamId: string) => {
    if (coLiveBusy) return;
    setCoLiveBusy(true);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${targetStreamId}/colive/invite`, {
        method: "POST",
      });
      setCoLiveInvited((prev) => new Set(prev).add(targetStreamId));
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't send the invite."
      );
    } finally {
      setCoLiveBusy(false);
    }
  };

  const acceptCoLive = async () => {
    if (!coLiveInvite || !streamId || coLiveBusy) return;
    setCoLiveBusy(true);
    setStageError(null);
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { primaryStreamId: string };
      }>(`/api/streams/${streamId}/colive/accept`, {
        method: "POST",
        body: JSON.stringify({ fromStreamId: coLiveInvite.fromStreamId }),
      });
      // My stream is over server-side; hand the room over cleanly and walk
      // onto their stage. ?stage=1 makes the stream page claim publish
      // rights and start the camera instead of tidying the slot away.
      roomRef.current?.disconnect();
      roomRef.current = null;
      window.location.assign(
        `/stream/${res.data.primaryStreamId}?stage=1`
      );
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't merge the lives."
      );
      setCoLiveBusy(false);
    }
  };

  const declineCoLive = async () => {
    if (!coLiveInvite || !streamId) return;
    const invite = coLiveInvite;
    setCoLiveInvite(null);
    try {
      await apiFetch(`/api/streams/${streamId}/colive/decline`, {
        method: "POST",
        body: JSON.stringify({ fromStreamId: invite.fromStreamId }),
      });
    } catch {
      // Their invite simply times out.
    }
  };

  // Who else is live right now — the co-live candidate list.
  useEffect(() => {
    if (!isLive) {
      setOtherLive([]);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { streams: typeof otherLive };
        }>(`/api/streams?live=true&limit=10&sort=viewers`);
        if (!cancelled) {
          setOtherLive(res.data.streams.filter((s) => s._id !== streamId));
        }
      } catch {
        // Section just stays empty.
      }
    }
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isLive, streamId]);

  /**
   * Join the stream's room and put this tab's feed into it: the camera or
   * screen and the mic, or — for OBS — nothing, since the encoder is the
   * publisher and this tab only watches. Used to go live, to resume after a
   * reload, and by the rejoin loop after a drop (`rejoin`).
   */
  /**
   * Share the screen with the privacy shield on it from the first frame:
   * the track is made, shielded, then published — publishing first would
   * send a moment of the raw screen. Where the shield can't run, the screen
   * goes out as it is. With LiveKit's own guards kept: a screen that's
   * already shared comes back as it is, a second press while the picker's
   * open waits for the first, and a share stopped from the browser's bar
   * mid-way is never published (lib/privacy-shield.ts).
   */
  const shareScreen = (room: Room) => shareShieldedScreen(room);

  const joinRoom = async (livekitUrl: string, livekitToken: string, src: SourceType, rejoin = false) => {
    const { Room: LKRoom, RoomEvent, Track, VideoPresets, AudioPresets, DisconnectReason } = await import("livekit-client");
    const room = new LKRoom({
      // Pause simulcast layers no subscriber is consuming.
      dynacast: true,
      videoCaptureDefaults: {
        resolution: captureResolution(orientation, saveData),
        facingMode: facing,
      },
      publishDefaults: {
        videoCodec: "vp8",
        // Explicit ladder under the 720p capture so adaptive viewers
        // (phones, small tiles, bad networks) get a right-sized layer
        // instead of the full feed or nothing.
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        // Saving data: sound tuned for a voice, at a lower bitrate.
        ...(saveData ? { audioPreset: AudioPresets.speech } : {}),
      },
    });

    // The RTMP encoder joins as obs-<my id> — it's the feed, not a viewer.
    const countViewers = () => {
      let n = 0;
      room.remoteParticipants.forEach((p) => {
        // Neither the RTMP encoder nor the host's own monitor tab counts.
        if (!p.identity.startsWith("obs-") && !p.identity.startsWith("mon-") && !p.identity.startsWith("prod-") && !isCameraIdentity(p.identity))
          n += 1;
      });
      return n;
    };
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      setViewerCount(countViewers());
      if (
        participant.identity.startsWith("obs-") ||
        participant.identity.startsWith("mon-") ||
        // A producer's console joins hidden, but never counts as a viewer either way.
        participant.identity.startsWith("prod-") ||
        // The phone cam is a feed, not an arrival.
        isCameraIdentity(participant.identity)
      )
        return;
      setConnectedViewers((prev) => [
        ...prev,
        {
          identity: participant.identity,
          name: participant.name || participant.identity,
          joinedAt: new Date(),
        },
      ]);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      setViewerCount(countViewers());
      if (isCameraIdentity(participant.identity)) {
        phoneTrackRef.current = null;
        setPhoneConnected(false);
      }
      setConnectedViewers((prev) =>
        prev.filter((v) => v.identity !== participant.identity)
      );
    });

    // Stage guests publish into this room once approved. Their video
    // becomes a tile over the preview; their audio plays out loud so the
    // host can hold an actual conversation.
    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (!track) return;
      // The encoder's video IS the program feed — into the main preview,
      // never a guest tile. Its audio stays unattached: monitoring your
      // own mix through the dashboard is a feedback loop.
      if (participant.identity === `obs-${user?.id}`) {
        if (track.kind === Track.Kind.Video && videoElRef.current) {
          track.attach(videoElRef.current);
          setObsFeedActive(true);
        }
        return;
      }
      // The phone cam: kept for the program, never a guest tile, never heard.
      if (isCameraIdentity(participant.identity)) {
        if (track.kind === Track.Kind.Video) {
          phoneTrackRef.current = track as unknown as AttachableVideoTrack;
          setPhoneConnected(true);
        }
        return;
      }
      if (track.kind === Track.Kind.Video) {
        guestTracksRef.current.set(
          participant.identity,
          track as unknown as AttachableVideoTrack
        );
        // A fresh array even when the guest is already listed: the tile
        // reads its track from the ref during render, so a republished
        // track (camera toggle, reconnect) only reaches it on re-render.
        setGuestTiles((prev) =>
          prev.some((t) => t.identity === participant.identity)
            ? [...prev]
            : [
                ...prev,
                {
                  identity: participant.identity,
                  name: participant.name || "Guest",
                },
              ]
        );
      }
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLAudioElement;
        // At the level the desk's guest fader has them.
        el.dataset.identity = participant.identity;
        el.volume = gainFor(gainsRef.current, participant.identity);
        document.body.appendChild(el);
        guestAudioElsRef.current.set(track, el);
        el.play().catch(() => {});
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      if (!track) return;
      if (participant.identity === `obs-${user?.id}`) {
        if (track.kind === Track.Kind.Video) setObsFeedActive(false);
        return;
      }
      if (isCameraIdentity(participant.identity)) {
        track.detach().forEach((el) => el.remove());
        if (track.kind === Track.Kind.Video) {
          phoneTrackRef.current = null;
          setPhoneConnected(false);
        }
        return;
      }
      track.detach().forEach((el) => el.remove());
      guestAudioElsRef.current.delete(track);
      if (track.kind === Track.Kind.Video) {
        guestTracksRef.current.delete(participant.identity);
        setGuestTiles((prev) =>
          prev.filter((t) => t.identity !== participant.identity)
        );
      }
    });

    // A camera published later — back on after a drop had it off — is the
    // camera the preview and the look ride from now on.
    room.on(RoomEvent.LocalTrackPublished, (pub) => {
      const t = pub.track;
      if (!t || t.kind !== Track.Kind.Video) return;
      // A screen share: the shield's already on it (shareScreen) — this keeps
      // the panel and the zones on the share, whichever way it started.
      if (pub.source === Track.Source.ScreenShare) {
        setShieldTrack(t as LocalVideoTrack);
        void applyShield(t as LocalVideoTrack, getShieldSettings());
        return;
      }
      if (pub.source !== Track.Source.Camera) return;
      videoTrackRef.current = t as LocalVideoTrack;
      setLiveCam(t as LocalVideoTrack);
      if (videoElRef.current) t.attach(videoElRef.current);
      applyLookTo(videoTrackRef.current);
    });

    // Stage requests, stage transitions, and tip alerts.
    // Only the API's events count — sent by the server, with no participant.
    // A packet from anyone in the room is ignored, whatever it claims to be.
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: { identity: string }) => {
      if (participant) return;
      handleStudioDataRef.current(payload);
    });

    // Connection health. LiveKit heals short drops by itself; a room that
    // does disconnect goes to onRoomGone, which decides whether to rejoin.
    // Events from a room this tab already replaced or left are old news.
    room.on(RoomEvent.Reconnecting, () => {
      if (roomRef.current === room) setConn("reconnecting");
    });
    room.on(RoomEvent.Reconnected, () => {
      if (roomRef.current === room) setConn("live");
    });
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReasonType) => {
      if (roomRef.current !== room) return;
      onRoomGoneRef.current(reason, DisconnectReason);
    });

    // The scene rides on the room's metadata — the same one viewers read.
    room.on(RoomEvent.RoomMetadataChanged, (metadata: string) => {
      if (roomRef.current !== room) return;
      const next = sceneFromMetadata(metadata);
      if (!next) return;
      // Framed from a producer's console rather than here: the auto-director
      // steps back for a minute, as it does for the host's own hand.
      const cur = sceneNowRef.current;
      if (next.version > cur.version && framing(next) !== framing(cur)) framedElsewhereRef.current();
      setScene((c) => (next.version >= c.version ? next : c));
    });
    // Sharing stopped from the browser's own bar: the preview goes back to the camera.
    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) {
        setScreenShareActive(false);
        setLocalScreen(null);
        setShieldTrack(null);
        setEditingZones(false);
      }
    });

    await room.connect(livekitUrl, livekitToken);
    roomRef.current = room;
    setLiveRoom(room);
    {
      const joined = sceneFromMetadata(room.metadata);
      if (joined) setScene(joined);
    }

    // Publish camera/screen + audio — unless OBS is the source, in which
    // case the encoder publishes and this tab only watches. A rejoin puts
    // things back the way the host left them: a muted mic stays muted.
    if (src !== "obs") {
      const { micEnabled: micOn, camEnabled: camOn } = liveRef.current;
      if (src === "camera") {
        if (!rejoin || camOn) await room.localParticipant.setCameraEnabled(true);
      } else {
        try {
          await shareScreen(room);
        } catch (err) {
          // Going live, a refused share is a failed start. Rejoining, it's
          // the browser wanting a click first — the stage asks for one.
          if (!rejoin) throw err;
          setNeedsReshare(true);
        }
      }
      // The mic as the voice settings want it: Music mode takes it raw, and in stereo.
      if (!rejoin || micOn) {
        await room.localParticipant.setMicrophoneEnabled(true, micCaptureOptions(voiceRef.current), micPublishOptions(voiceRef.current, saveData));
      }

      // Attach local video to preview element
      const videoPubs = room.localParticipant.videoTrackPublications;
      videoPubs.forEach((pub) => {
        if (pub.track && videoElRef.current) {
          pub.track.attach(videoElRef.current);
          videoTrackRef.current = pub.track as LocalVideoTrack;
          if (pub.source === Track.Source.Camera) setLiveCam(pub.track as LocalVideoTrack);
        }
      });
      // The look rides the published camera, not the preview it replaced.
      if (src === "camera") applyLookTo(videoTrackRef.current);

      const audioPubs = room.localParticipant.audioTrackPublications;
      audioPubs.forEach((pub) => {
        if (pub.track) {
          audioTrackRef.current = pub.track as LocalAudioTrack;
        }
      });
      // A rejoin publishes a new mic track: the desk goes back in its path —
      // and the voice settings put it there in the first place.
      if (deskOnRef.current || voiceNeedsDesk(voiceRef.current, { noiseFilter: noiseFilterOk })) void startDesk();
    }
    return room;
  };

  /**
   * Start broadcasting — or, with `resume`, pick up a stream that is already
   * live: an OBS stream whose studio tab closed (the encoder never stopped),
   * or a camera/screen stream holding after a drop, a reload, or on another
   * device. A resume skips creating a stream.
   */
  const goLive = async (resume?: {
    id: string;
    livekitToken: string;
    livekitUrl: string;
    source?: SourceType;
    ingress?: { url: string; streamKey: string };
  }): Promise<boolean> => {
    // No title needed: a blank one goes out and the API names the stream.
    const src: SourceType = resume ? (resume.source ?? "obs") : source;
    setIsConnecting(true);
    setError(null);
    // The desk's audio context has to start from a click: this is the click,
    // before the joins that follow outlive the browser's grace for one.
    if (src !== "obs" && !deskCtxRef.current && voiceNeedsDesk(voiceRef.current, { noiseFilter: noiseFilterOk })) {
      try {
        const ctx = new AudioContext({ latencyHint: "interactive" });
        await ctx.resume();
        deskCtxRef.current = ctx;
      } catch {
        // No desk, then: the mic goes out as it is.
      }
    }

    let createdStreamId: string | null = null;

    try {
      let livekitToken: string;
      let livekitUrl: string;
      if (resume) {
        ({ livekitToken, livekitUrl } = resume);
        setStreamId(resume.id);
        if (resume.ingress) setIngressInfo(resume.ingress);
      } else {
        // Step 1: Call our API to create stream + get LiveKit token
        const tagList = tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

        // Custom uploaded thumbnail wins; otherwise auto-capture from preview
        let thumbnail: string | undefined = customThumbnail ?? undefined;
        if (!thumbnail && videoElRef.current) {
          thumbnail = captureVideoFrame(videoElRef.current, 640, 0.75) ?? undefined;
        }

        const res = await apiFetch<{
          success: boolean;
          data: {
            stream: { id: string; livekitRoomName: string; title?: string };
            livekitToken: string;
            livekitUrl: string;
            ingress?: { url: string; streamKey: string };
            /** How many followers the go-live bell went to (the coach says so). */
            followersTold?: number | null;
          };
        }>("/api/streams", {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            category,
            tags: tagList,
            thumbnail,
            source: src,
            // A practice run stays on Xtream, and out of sight.
            practice,
            postToWorldSpace: postToWorldSpace && !practice,
            ...(openOnCard ? { scene: { layout: "auto", card: "starting-soon", cardNote: cardNote.trim() } } : {}),
            ...(booking ? { scheduledStreamId: booking.id, notifyFollowers: booking.notifyFollowers } : {}),
          }),
        });

        ({ livekitToken, livekitUrl } = res.data);
        createdStreamId = res.data.stream.id;
        noteFollowersTold(createdStreamId, res.data.followersTold);
        setStreamId(createdStreamId);
        setAirTitle(res.data.stream.title ?? null);
        if (res.data.ingress) setIngressInfo(res.data.ingress);
        // Next time starts from here, in this browser.
        saveLastDetails({ title, category });
      }

      // Step 2: Stop preview track
      if (previewTrack) {
        previewTrack.stop();
        setPreviewTrack(null);
      }

      // Step 3: into the room, feed published.
      await joinRoom(livekitUrl, livekitToken, src);

      // A fresh broadcast starts on the scene it asked for; a resume reads
      // the room's own (joinRoom picked it up from the metadata).
      if (!resume) {
        setScene(
          openOnCard
            ? { ...DEFAULT_SCENE, card: "starting-soon", cardNote: cardNote.trim(), version: 1 }
            : DEFAULT_SCENE
        );
      }
      setConn("live");
      setIsLive(true);
      // Asked for a battle: straight to it, this once.
      setPanel(battleAskRef.current ? "battle" : "chat");
      setBattleAsk(false);
      // The first time on air (a practice run counts), the walkthrough shows the live console.
      if (!resume) tourAction("first-live");
      return true;
    } catch (err) {
      // Cleanup: if a stream was created here but connection/publish failed,
      // end it. A failed resume leaves the live stream alone — it's still
      // holding (or an encoder is still feeding it).
      if (createdStreamId && !resume) {
        try {
          await apiFetch(`/api/streams/${createdStreamId}/end`, {
            method: "POST",
          });
        } catch {
          // best-effort cleanup
        }
        setStreamId(null);
      }

      // Out of roomRef first, so its Disconnected event reads as ours.
      const stale = roomRef.current;
      roomRef.current = null;
      stale?.disconnect();

      const msg =
        err instanceof Error ? err.message : "Failed to start stream";
      setError(
        msg.toLowerCase().includes("permission") ||
          msg.toLowerCase().includes("notallowed") ||
          msg.toLowerCase().includes("denied")
          ? "Camera/microphone permission denied. Please allow access in your browser settings and try again."
          : msg
      );

      // Restart preview
      startPreview();
      return false;
    } finally {
      setIsConnecting(false);
    }
  };

  const stopRejoin = () => {
    if (rejoinRef.current?.timer) clearTimeout(rejoinRef.current.timer);
    rejoinRef.current = null;
  };

  const endStream = async () => {
    stopRejoin();
    try {
      if (streamId) {
        await apiFetch(`/api/streams/${streamId}/end`, { method: "POST" });
      }
    } catch {
      // Best-effort
    }

    // Out of roomRef first, so its Disconnected event reads as ours.
    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect();

    // The post-live report (stream-report.tsx) opens the moment End lands; it holds the thumbnail picker now.
    if (streamId) openStreamReport({ streamId, from: "studio" });
    resetAfterLive();
  };

  /** Back to setup after a broadcast, however it ended. */
  const resetAfterLive = () => {
    stopRejoin();
    // The next stream is real unless they say otherwise again — or asked,
    // from the Battle tab, to try a practice battle next.
    setPractice(practiceNextRef.current);
    // …and that practice run goes to its Battle tab when it starts.
    if (practiceNextRef.current) setBattleAsk(true);
    setPracticeNext(false);
    setAirTitle(null);
    setDetailsOpen(false);
    // The mic track went with the room, and the desk with it.
    deskRef.current = null;
    deskOnRef.current = false;
    setDeskOn(false);
    setConn("live");
    setNeedsReshare(false);
    setScene(DEFAULT_SCENE);
    setLocalScreen(null);
    videoTrackRef.current = null;
    audioTrackRef.current = null;
    setIsLive(false);
    setStreamId(null);
    setViewerCount(0);
    setLiveRoom(null);
    setConnectedViewers([]);
    setPanel("chat");
    setScreenShareActive(false);
    // Stage state is per-session; the room's death took the guests with it.
    setStageRequests([]);
    setLiveGuests([]);
    setGuestTiles([]);
    phoneTrackRef.current = null;
    setPhoneConnected(false);
    setLiveCam(null);
    setTipAlerts([]);
    setStageError(null);
    setIngressInfo(null);
    setObsFeedActive(false);
    setFeedDropped(false);
    setKeyVisible(false);
    setPeakViewers(0);
    setSessionTipsMinor(0);
    guestTracksRef.current.clear();
    guestAudioElsRef.current.forEach((el) => el.remove());
    guestAudioElsRef.current.clear();

    // Back to the camera preview — unless the studio is minimized, when it
    // closes instead and the camera goes off.
    if (!minimizedRef.current) startPreview();
  };

  const toggleMic = async () => {
    if (isLive && roomRef.current) {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!micEnabled);
    }
    setMicEnabled(!micEnabled);
  };

  const toggleCam = async () => {
    if (isLive && roomRef.current && source === "camera") {
      await roomRef.current.localParticipant.setCameraEnabled(!camEnabled);
    }
    setCamEnabled(!camEnabled);
  };

  // Flip between the front and back cameras. Live, the published track
  // restarts in place so viewers see a cut, not a drop.
  const flipCamera = async () => {
    const next: Facing = facing === "user" ? "environment" : "user";
    setFacing(next);
    if (isLive && videoTrackRef.current) {
      try {
        await videoTrackRef.current.restartTrack({ facingMode: next });
      } catch {
        // A laptop with one camera: nothing to flip to.
      }
    }
  };

  // Toggle screen share while live
  const toggleScreenShare = async () => {
    if (!isLive || !roomRef.current) return;
    try {
      if (screenShareActive) {
        await roomRef.current.localParticipant.setScreenShareEnabled(false);
        setScreenShareActive(false);
        setLocalScreen(null);
      } else {
        const pub = await shareScreen(roomRef.current);
        setScreenShareActive(true);
        // Beside a camera, the screen takes the preview's main picture —
        // what viewers see — with the camera in the corner.
        if (source === "camera" && pub?.track) setLocalScreen(pub.track as LocalVideoTrack);
      }
    } catch {
      // User cancelled screen share picker — that's fine
    }
  };

  // ── Vivid bridge ──────────────────────────────────────────────────────────
  // Vivid's studioControl tool presses these controls on the user's behalf.
  // The handlers above are recreated every render, so the bridge reads the
  // latest ones through a ref; the registration itself happens once.
  // Go live's 3·2·1: the tap starts it, the next tap calls it off, and it
  // goes live when it runs out (camera only — see pressGoLive).
  const countdown = useGoLiveCountdown(() => void goLive());
  const cancelCountdown = countdown.cancel;
  const vividRef = useRef({ goLive, endStream, toggleMic, toggleCam, toggleScreenShare, cancelCountdown, isLive, micEnabled, camEnabled, screenShareActive, source, title, category, streamId, viewerCount, elapsed, isConnecting, confirmDialog });
  useEffect(() => {
    vividRef.current = { goLive, endStream, toggleMic, toggleCam, toggleScreenShare, cancelCountdown, isLive, micEnabled, camEnabled, screenShareActive, source, title, category, streamId, viewerCount, elapsed, isConnecting, confirmDialog };
  });
  useEffect(() => {
    const unregisterBridge = registerStudioBridge(async (action: StudioAction) => {
      const v = vividRef.current;
      switch (action) {
        case "mute_mic":
        case "unmute_mic": {
          const wantOn = action === "unmute_mic";
          if (v.micEnabled === wantOn) return { success: true, micEnabled: v.micEnabled, note: "already there" };
          await v.toggleMic();
          return { success: true, micEnabled: wantOn };
        }
        case "camera_on":
        case "camera_off": {
          if (v.source !== "camera") return { error: "The camera toggle only applies to the camera source." };
          const wantOn = action === "camera_on";
          if (v.camEnabled === wantOn) return { success: true, cameraEnabled: v.camEnabled, note: "already there" };
          await v.toggleCam();
          return { success: true, cameraEnabled: wantOn };
        }
        case "start_screen_share":
        case "stop_screen_share": {
          if (!v.isLive) return { error: "Screen share is only available while live." };
          // A screen shared beside the camera: when the screen is the stream (or an encoder is), there's no second one.
          if (v.source !== "camera") return { error: v.source === "screen" ? "Your screen is already the stream's picture." : "Screen share isn't available with an encoder." };
          const wantOn = action === "start_screen_share";
          if (v.screenShareActive === wantOn) return { success: true, screenShareActive: wantOn, note: "already there" };
          await v.toggleScreenShare();
          return { success: true, screenShareActive: wantOn, note: wantOn ? "The browser asks the user to pick a window." : undefined };
        }
        case "go_live": {
          if (v.isLive) return { error: "Already live." };
          if (v.isConnecting) return { error: "Already starting." };
          // A title is optional: with none, the stream is named after them.
          setConfirmDialog(null);
          v.cancelCountdown();
          const started = await v.goLive();
          return started ? { success: true, title: v.title.trim() || null, category: v.category } : { error: "The stream didn't start — the studio says why." };
        }
        case "end_stream": {
          if (!v.isLive) return { error: "Not live." };
          setConfirmDialog(null);
          await v.endStream();
          return { success: true, ended: true };
        }
      }
    });
    const unregisterContext = registerVividContext("studio", () => {
      const v = vividRef.current;
      return {
        isLive: v.isLive,
        starting: v.isConnecting,
        source: v.source,
        // Optional: blank, the stream goes out named after them.
        title: v.title.trim() || null,
        category: v.category,
        micOn: v.micEnabled,
        cameraOn: v.camEnabled,
        screenSharing: v.screenShareActive,
        ...(v.isLive ? { viewers: v.viewerCount, liveFor: v.elapsed, streamId: v.streamId } : {}),
        ...vividShowRef.current,
        openDialog: v.confirmDialog === "end" ? "end stream confirmation" : null,
      };
    });
    return () => {
      unregisterBridge();
      unregisterContext();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const guestAudioEls = guestAudioElsRef.current;
    const rejoin = rejoinRef;
    return () => {
      if (rejoin.current?.timer) clearTimeout(rejoin.current.timer);
      rejoin.current = null;
      // Out of roomRef first, so its Disconnected event reads as ours.
      const room = roomRef.current;
      roomRef.current = null;
      room?.disconnect();
      // Guests' audio elements live on document.body, outside this tree.
      guestAudioEls.forEach((el) => el.remove());
      guestAudioEls.clear();
    };
  }, []);

  /**
   * A stream of yours that is live while this studio isn't on it: the tab
   * reloaded or crashed (the stream holds through the grace window, viewers
   * seeing "Be right back"), it's running on another device, or an encoder
   * is still feeding it. The banner offers to pick it up here — or end it.
   */
  const [orphan, setOrphan] = useState<{
    id: string;
    title: string;
    source: string;
    /** Set while the stream is holding for its feed to come back. */
    feedDroppedAt?: string | null;
  } | null>(null);
  const [endingOrphan, setEndingOrphan] = useState(false);
  const [resuming, setResuming] = useState(false);
  /** The stream the card was about went off the air (heard on its room): its title, shown a beat before the card goes. */
  const [orphanEnded, setOrphanEnded] = useState<string | null>(null);
  /** Bumped to ask the API again when the room can't tell us (see useOrphanWatch). */
  const [orphanCheck, setOrphanCheck] = useState(0);

  // The card stays true by itself: it listens on the stream's room.
  useOrphanWatch(orphan && !resuming && !endingOrphan && !isLive ? orphan.id : null, {
    ended: () => {
      setOrphanEnded(orphan?.title ?? "Your stream");
      setOrphan(null);
    },
    feed: (state, grace) => {
      if (typeof grace === "number") setGraceMs(grace);
      setOrphan((o) => (o ? { ...o, feedDroppedAt: state === "reconnecting" ? new Date().toISOString() : null } : o));
    },
    recheck: () => setOrphanCheck((n) => n + 1),
  });
  useEffect(() => {
    if (!orphanEnded) return;
    const t = setTimeout(() => setOrphanEnded(null), 6000);
    return () => clearTimeout(t);
  }, [orphanEnded]);

  useEffect(() => {
    if (!user || isLive) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            stream: { id: string; title: string; source?: string; feedDroppedAt?: string | null } | null;
            graceMs?: number;
          };
        }>("/api/streams/active/mine");
        if (!cancelled) {
          const s = res.data.stream;
          setOrphan(s ? { id: s.id, title: s.title, source: s.source ?? "camera", feedDroppedAt: s.feedDroppedAt ?? null } : null);
          if (typeof res.data.graceMs === "number") setGraceMs(res.data.graceMs);
        }
      } catch {
        // Non-critical — the Go Live path ends any stale stream anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isLive, orphanCheck]);

  // The account's permanent encoder key, ready before the stream exists so
  // OBS/vMix can be configured once. Fetched only when the encoder path is
  // chosen — it mints the ingress on first use.
  useEffect(() => {
    if (!user || isLive || source !== "obs" || streamKey) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { url: string; streamKey: string } }>("/api/users/me/stream-key")
      .then((r) => !cancelled && setStreamKey({ url: r.data.url, streamKey: r.data.streamKey }))
      .catch(() => {
        // The key appears at go-live instead; the stage copy says so.
      });
    return () => {
      cancelled = true;
    };
  }, [user, isLive, source, streamKey]);

  // The WHIP key, when that's the way the encoder sends.
  useEffect(() => {
    if (!user || source !== "obs" || ingestProtocol !== "whip" || whipKey) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { url: string; streamKey: string } }>("/api/users/me/stream-key?protocol=whip")
      .then((r) => !cancelled && setWhipKey({ url: r.data.url, streamKey: r.data.streamKey }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, source, ingestProtocol, whipKey]);

  const rotateKey = async () => {
    if (rotatingKey) return;
    if (!window.confirm("Replace your stream key? The current one stops working immediately and OBS/vMix will need the new one.")) return;
    setRotatingKey(true);
    try {
      const r = await apiFetch<{ success: boolean; data: { url: string; streamKey: string } }>(`/api/users/me/stream-key/rotate?protocol=${ingestProtocol}`, { method: "POST" });
      if (ingestProtocol === "whip") {
        setWhipKey({ url: r.data.url, streamKey: r.data.streamKey });
        setKeyVisible(true);
        return;
      }
      setStreamKey({ url: r.data.url, streamKey: r.data.streamKey });
      setKeyVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't replace the key");
    } finally {
      setRotatingKey(false);
    }
  };

  /**
   * Pick the stream up here: back into the room of an OBS stream this tab
   * left running, or the camera/screen back on air — after a reload, or
   * moved over from another device (which steps off as this one joins).
   */
  const resumeStream = async () => {
    if (!orphan || resuming) return;
    setResuming(true);
    setError(null);
    try {
      const r = await apiFetch<{
        success: boolean;
        data: {
          stream: { id: string; title: string; category: Category; startedAt?: string; source?: string; feedDroppedAt: string | null };
          livekitToken: string;
          livekitUrl: string;
          graceMs?: number;
          ingress?: { url: string; streamKey: string };
        };
      }>(`/api/streams/${orphan.id}/resume`, { method: "POST" });
      const src = (r.data.stream.source ?? orphan.source) as SourceType;
      setTitle(r.data.stream.title);
      setAirTitle(r.data.stream.title);
      setCategory(r.data.stream.category);
      setSource(src);
      if (typeof r.data.graceMs === "number") setGraceMs(r.data.graceMs);
      setFeedDropped(src === "obs" && !!r.data.stream.feedDroppedAt);
      if (r.data.stream.startedAt) resumedStartRef.current = new Date(r.data.stream.startedAt);
      const resumed = await goLive({
        id: r.data.stream.id,
        livekitToken: r.data.livekitToken,
        livekitUrl: r.data.livekitUrl,
        source: src,
        ...(r.data.ingress ? { ingress: r.data.ingress } : {}),
      });
      if (resumed) setOrphan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't pick the stream back up");
    } finally {
      setResuming(false);
    }
  };

  // "Resume" in the rail (or the phone's on-hold pill) arrives as
  // /studio?resume=1: pick the stream straight back up rather than asking again.
  const [wantsResume] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("resume") === "1"
  );
  const autoResumedRef = useRef(false);
  useEffect(() => {
    if (!wantsResume || !orphan || autoResumedRef.current) return;
    autoResumedRef.current = true;
    window.history.replaceState(window.history.state, "", "/studio");
    void resumeStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the stream to resume is known
  }, [wantsResume, orphan]);

  const endOrphan = async () => {
    if (!orphan) return;
    setEndingOrphan(true);
    try {
      await apiFetch(`/api/streams/${orphan.id}/end`, { method: "POST" });
      setOrphan(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not end the previous stream"
      );
    } finally {
      setEndingOrphan(false);
    }
  };

  // ---- Staying on air through drops ----

  /**
   * The room disconnected. Why decides what happens next: the same account
   * joined from another device, so the stream moved there — step back to
   * setup, where the banner offers to take it back; the server closed the
   * room — it's over; anything else is the network — hold on and rejoin.
   * (Leaving on purpose never gets here: End stream and unmount take the
   * room out of roomRef before disconnecting it.)
   */
  const onRoomGone = (reason: DisconnectReasonType | undefined, reasons: typeof DisconnectReasonType) => {
    roomRef.current = null;
    setLiveRoom(null);
    // Whatever the room carried went with it; a rejoin subscribes afresh.
    guestTracksRef.current.clear();
    guestAudioElsRef.current.forEach((el) => el.remove());
    guestAudioElsRef.current.clear();
    setGuestTiles([]);
    if (reason === reasons.CLIENT_INITIATED) return;
    const { streamId: id, source: src, title: streamTitle } = liveRef.current;
    if (!id) return;
    if (reason === reasons.DUPLICATE_IDENTITY) {
      resetAfterLive();
      setOrphan({ id, title: streamTitle, source: src, feedDroppedAt: null });
      return;
    }
    if (
      reason === reasons.ROOM_DELETED ||
      reason === reasons.ROOM_CLOSED ||
      reason === reasons.PARTICIPANT_REMOVED
    ) {
      resetAfterLive();
      setError(
        takenDownRef.current
          ? "Your stream was taken down after a report was reviewed. It broke the community rules."
          : "Your stream was taken off the air."
      );
      takenDownRef.current = false;
      return;
    }
    if (rejoinRef.current) return;
    rejoinRef.current = { timer: null, attempt: 0 };
    setConn("rejoining");
    void attemptRejoinRef.current();
  };

  /**
   * One try at getting back on air: a fresh token from the API, then into a
   * new room with the feed republished. The API decides whether there's
   * still a stream to go back to — past the grace window it answers 404 —
   * so the loop runs until it's back, told it's over, or the host ends it.
   */
  const attemptRejoin = async () => {
    const state = rejoinRef.current;
    const { streamId: id, source: src } = liveRef.current;
    if (!state || !id) return;
    state.timer = null;
    state.attempt += 1;
    try {
      const r = await apiFetch<{
        success: boolean;
        data: { livekitToken: string; livekitUrl: string; graceMs?: number };
      }>(`/api/streams/${id}/resume`, { method: "POST" });
      if (rejoinRef.current !== state) return;
      if (typeof r.data.graceMs === "number") setGraceMs(r.data.graceMs);
      await joinRoom(r.data.livekitUrl, r.data.livekitToken, src, true);
      if (rejoinRef.current !== state) return;
      rejoinRef.current = null;
      setConn("live");
    } catch (err) {
      if (rejoinRef.current !== state) return;
      // A half-made room from this try goes before the next one starts.
      const stale = roomRef.current;
      roomRef.current = null;
      stale?.disconnect();
      if (err instanceof ApiError && err.status === 404) {
        resetAfterLive();
        setError("You were offline longer than the stream could wait, so it ended. Go live again whenever you're ready.");
        return;
      }
      // Still offline, or LiveKit said no: again soon, backing off to 10 s.
      state.timer = setTimeout(
        () => void attemptRejoinRef.current(),
        Math.min(10_000, 1_000 * 2 ** Math.min(state.attempt, 4))
      );
    }
  };

  useEffect(() => {
    liveRef.current = { streamId, source, title: onAirTitle, micEnabled, camEnabled };
    onRoomGoneRef.current = onRoomGone;
    attemptRejoinRef.current = attemptRejoin;
  });

  /** Skip the rest of the backoff: try getting back on air now. */
  const reconnectNow = () => {
    const state = rejoinRef.current;
    if (!state?.timer) return;
    clearTimeout(state.timer);
    state.timer = null;
    void attemptRejoinRef.current();
  };

  // ---- Minimized: the broadcast, for the app outside the studio ----

  const minimizedRef = useRef(minimized);
  /** The latest handlers, for the actions the rail and the mini player call. */
  const handlersRef = useRef({ toggleMic, toggleCam, reconnectNow, endStream });
  useEffect(() => {
    minimizedRef.current = minimized;
    handlersRef.current = { toggleMic, toggleCam, reconnectNow, endStream };
  });
  const [liveActions] = useState<LiveActions>(() => ({
    toggleMic: () => void handlersRef.current.toggleMic(),
    toggleCam: () => void handlersRef.current.toggleCam(),
    reconnect: () => handlersRef.current.reconnectNow(),
    end: () => handlersRef.current.endStream(),
  }));
  // What's on air here, for the rail's live card and the mini player
  // (lib/live-session.ts) — and it's what keeps this studio mounted while
  // you browse. Null once it's over.
  // A studio only ever clears a broadcast it put there.
  const publishedRef = useRef(false);
  useEffect(() => {
    const live = Boolean(isLive && streamId);
    if (!live && !publishedRef.current) return;
    publishedRef.current = live;
    publishLiveSession(
      live
        ? {
            state: conn,
            streamId: streamId!,
            title: onAirTitle,
            startedAt: (startTimeRef.current ?? new Date()).getTime(),
            viewers: viewerCount,
            micOn: micEnabled,
            camOn: camEnabled,
            source,
          }
        : null,
      live ? liveActions : null
    );
  }, [isLive, streamId, conn, onAirTitle, viewerCount, micEnabled, camEnabled, source, liveActions]);
  useEffect(
    () => () => {
      if (publishedRef.current) publishLiveSession(null, null);
    },
    []
  );

  // Where the stage's picture is, so minimizing grows the mini player out
  // of it — and where the mini player sat, so opening the studio grows the
  // picture back out of that.
  const pictureRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pictureRectRef = useRef<DOMRect | null>(null);
  const miniRectRef = useRef<DOMRect | null>(null);
  const wasMinimizedRef = useRef(minimized);
  useLayoutEffect(() => {
    const was = wasMinimizedRef.current;
    wasMinimizedRef.current = minimized;
    const picture = pictureRef.current;
    if (minimized || !picture) return;
    const to = picture.getBoundingClientRect();
    // Only a picture at rest is a place to grow the mini player from.
    if (picture.getAnimations().length === 0) pictureRectRef.current = to;
    const from = miniRectRef.current;
    if (!was || !from || !to.width || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const s = from.width / to.width;
    picture.animate(
      [
        { transformOrigin: "top left", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})` },
        { transformOrigin: "top left", transform: "none" },
      ],
      { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
    rootRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
  });

  // Back online: don't sit out the rest of the backoff.
  useEffect(() => {
    const online = () => {
      const state = rejoinRef.current;
      if (!state?.timer) return;
      clearTimeout(state.timer);
      state.timer = null;
      void attemptRejoinRef.current();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);

  /** Rejoining can't restart a screen share on its own — this click can. */
  const reshareScreen = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await shareScreen(room);
      room.localParticipant.videoTrackPublications.forEach((pub) => {
        if (pub.track && videoElRef.current) {
          pub.track.attach(videoElRef.current);
          videoTrackRef.current = pub.track as LocalVideoTrack;
        }
      });
      setNeedsReshare(false);
    } catch {
      // Picker dismissed: the button stays for another try.
    }
  };

  // Show overlay controls, then hide them after 3s of inactivity (live only)
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    if (isLive) {
      showControls();
    } else {
      setControlsVisible(true);
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    }
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [isLive, showControls]);

  // Live thumbnails: the card on Explore (and the post relayed to socials)
  // should show what the stream looks like NOW. Explore re-polls every 15s
  // and thumbnail URLs are versioned, so the pipeline is: capture a frame
  // from the program feed, PATCH it up, the endpoint bumps thumbnailVersion.
  //
  // Two cadences: an eager loop right after going live that retries every
  // couple of seconds until the feed actually has frames (screen share and
  // OBS have NOTHING at go-live — the camera path was the only source that
  // got an instant thumbnail), then a steady refresh every minute.
  useEffect(() => {
    if (!isLive || !streamId) return;

    const capture = () => {
      const el = videoElRef.current;
      if (!el || el.videoWidth === 0) return false;
      // A disabled camera means the element is showing a frozen last frame —
      // keep the previous thumbnail rather than upload that.
      if (source === "camera" && !camEnabled) return false;
      // Nor the privacy shield's slate ("Screen share starting", "Screen
      // hidden"): the eager loop tries again in two seconds.
      if (getShieldStatus().slate) return false;
      const thumb = captureVideoFrame(el, 640, 0.75);
      if (!thumb) return false;
      // The same frame, scored, is offered as a "Pick a thumbnail" choice for after the stream.
      offerThumbnailCandidate(streamId, thumb, el, faceFeed.sample().face ? true : null);
      void apiFetch(`/api/streams/${streamId}`, {
        method: "PATCH",
        body: JSON.stringify({ thumbnail: thumb }),
      }).catch(() => {
        // Missed refresh — the next tick tries again.
      });
      return true;
    };

    // Eager: first real frame wins. Gives up after ~30s (an OBS stream the
    // encoder never feeds) and leaves it to the steady loop.
    let attempts = 0;
    const eager = setInterval(() => {
      attempts += 1;
      if (capture() || attempts >= 15) clearInterval(eager);
    }, 2_000);

    const steady = setInterval(capture, 60_000);
    return () => {
      clearInterval(eager);
      clearInterval(steady);
    };
  }, [isLive, streamId, source, camEnabled, faceFeed]);

  // Warn before closing/refreshing the tab while live — leaving takes the
  // camera off the air (the stream holds for the grace window, then ends).
  // Not for OBS streams: the encoder carries the feed there.
  useEffect(() => {
    if (!isLive || source === "obs") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isLive, source]);

  // Moving around the app while live is fine now: the studio stays mounted
  // in the shell and minimizes (MiniLive), so the broadcast carries on.

  // Host share: share/copy the public stream link
  const shareStream = async () => {
    if (!streamId) return;
    const url = `${window.location.origin}/stream/${streamId}`;
    const text = onAirTitle ? `I'm live on Xtream — ${onAirTitle}` : "I'm live on Xtream";
    if (navigator.share) {
      try {
        await navigator.share({ title: onAirTitle || "Live on Xtream", text, url });
        return;
      } catch {
        // Fall through to clipboard
      }
    }
    try {
      await navigator.clipboard?.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  // Thumbnail upload
  const handleThumbnailFile = async (file: File | undefined) => {
    if (!file) return;
    setThumbError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setThumbError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setThumbError("Image is too large (max 10MB).");
      return;
    }
    try {
      const dataUri = await compressImage(file, 640, 0.75);
      setCustomThumbnail(dataUri);
    } catch {
      setThumbError("Could not process that image. Try another file.");
    }
  };

  const tipsLabel =
    sessionTipsMinor % 100 === 0
      ? `$${sessionTipsMinor / 100}`
      : `$${(sessionTipsMinor / 100).toFixed(2)}`;

  // The tag list as chips, and the ways to grow or shrink it.
  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const commitTag = () => {
    const next = tagInput.replace(/,/g, "").trim().toLowerCase();
    setTagInput("");
    if (!next || tagList.includes(next) || tagList.length >= 6) return;
    setTags([...tagList, next].join(", "));
  };
  const removeTag = (tag: string) => setTags(tagList.filter((t) => t !== tag).join(", "));

  /** Grab the current preview frame as the thumbnail. */
  const captureFrame = () => {
    const el = videoElRef.current;
    if (!el) return;
    const frame = captureVideoFrame(el, 640, 0.8);
    if (frame) {
      setCustomThumbnail(frame);
      setThumbError(null);
    } else {
      setThumbError("No frame yet — wait for the camera to settle.");
    }
  };

  // The one thing that can hold Go live back: nothing to broadcast. A title,
  // a category, a thumbnail — none of it is needed (owner, 2026-09-28: "I
  // just clicked Live and I went live").
  const blocker: { why: string; fix?: string; onFix?: () => void } | null =
    source === "camera" && !previewTrack
      ? camIssue === "denied"
        ? { why: "Your camera is blocked. Allow it for this site in the address bar, then:", fix: "Turn on camera", onFix: () => void startPreview() }
        : camIssue === "missing"
          ? { why: "No camera found. Plug one in, or go live with your screen from More.", fix: "Try again", onFix: () => void startPreview() }
          : camIssue === "busy"
            ? { why: "Another app is using your camera. Close it, then:", fix: "Turn on camera", onFix: () => void startPreview() }
            : { why: "Waiting for your camera — allow it when the browser asks." }
      : source !== "obs" && micBlocked
        ? { why: "Your mic is blocked. Allow it for this site in the address bar, then:", fix: "Turn on mic", onFix: () => void checkMic(true) }
        : null;

  /**
   * Go live, from its button. A camera gets the 3·2·1 over its preview (the
   * next tap calls it off); a screen goes at once — its share picker is the
   * pause, and it needs the tap's own moment to open — and so does an
   * encoder, which is the broadcaster anyway.
   */
  const pressGoLive = () => {
    if (countdown.running) {
      countdown.cancel();
      return;
    }
    if (isConnecting || blocker) return;
    setMoreOpen(false);
    if (source !== "camera") {
      void goLive();
      return;
    }
    // The audio desk's context has to start from a tap, and this is the
    // last one before the air.
    if (!deskCtxRef.current && voiceNeedsDesk(voiceRef.current, { noiseFilter: noiseFilterOk })) {
      try {
        const ctx = new AudioContext({ latencyHint: "interactive" });
        void ctx.resume();
        deskCtxRef.current = ctx;
      } catch {
        // No desk, then: the mic goes out as it is.
      }
    }
    countdown.start();
  };

  /** A title or category changed on air: saved to the stream (the API tells the room), and remembered here. */
  const saveDetails = async (next: { title: string; category: string }) => {
    if (!streamId) return;
    const r = await apiFetch<{ success: boolean; data: { stream: { title: string; category: string } } }>(`/api/streams/${streamId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: next.title, category: next.category }),
    });
    setTitle(next.title);
    setCategory(next.category);
    setAirTitle(r.data.stream.title);
    saveLastDetails(next);
  };

  // Market tools come up front for a markets or crypto stream, or once the
  // host asks for them — and stay while any of them is on the picture.
  const marketsUp =
    marketTools ||
    isMarketCategory(category) ||
    scene.layout === "chart-face" ||
    scene.layers.some((l) => l.kind === "prices" || l.kind === "call");
  const toggleMarketTools = (on: boolean) => {
    setMarketTools(on);
    saveMarketTools(on);
  };

  // The coach (lib/coach.ts): host-only lines while live — "We're telling
  // your N followers", share, invite, add a title, data saver. Local to
  // this studio; nothing goes to the room.
  useCoachDriver({
    isLive,
    streamId,
    practice,
    visible: !minimized,
    untitled: !title.trim(),
    viewers: viewerCount,
    guests: liveGuests.length,
    canInvite: otherLive.length > 0,
    // Data saver lightens a browser camera's send; an encoder's is set in OBS.
    health: source === "camera" ? health.verdict : null,
    saveData,
    actions: {
      share: () => void shareStream(),
      invite: () => setPanel("stage"),
      addTitle: () => setDetailsOpen(true),
      saveData: () => {
        setSaveData(true);
        // Live, the camera restarts in place at 540p: a cut, not a drop.
        void videoTrackRef.current?.restartTrack({ resolution: captureResolution(orientation, true), facingMode: facing }).catch(() => {});
      },
      practiceShare: () => setPanel("more"),
    },
  });

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  const openPanel = (p: Panel) => setPanel(p);

  // The stage split follows the shape of the broadcast, not the screen:
  // portrait stacks people, landscape sits them side by side.
  const opponentStreamId =
    battle && streamId
      ? sideOf(battle, streamId) === "host"
        ? battle.challenger.streamId
        : battle.host.streamId
      : null;
  /** The other side's picture, named on it. */
  const opponentTile = (key: string, name: string, picture: React.ReactNode): SceneCell => ({
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
  // A 2v2 is a 2×2, as viewers see it: our pair down the left, theirs down
  // the right — so after us come their host, our partner, their partner.
  const pairCells = (): SceneCell[] => {
    if (!pairOpponent || !battle || !streamId) return [];
    const mate = (sideOf(battle, streamId) === "host" ? battle.host : battle.challenger).partner ?? null;
    const mateTile = mate ? stageTiles.find((t) => t.identity === mate.userId) : undefined;
    const theirMate = pairOpponent.partner ?? null;
    return [
      opponentTile("opponent", pairOpponent.displayName, <PreviewVideo track={hostTrackOf(pairTracks, pairOpponent, theirMate?.userId)} />),
      mateTile
        ? { key: mateTile.identity, node: <StageTile fill track={guestTracksRef.current.get(mateTile.identity)} label={mateTile.name} /> }
        : { key: "mate", node: <AwayTile name={mate?.displayName ?? "Your partner"} /> },
      theirMate
        ? opponentTile("opponent-mate", theirMate.displayName, <PreviewVideo track={pairTracks.get(theirMate.userId)} />)
        : { key: "opponent-mate", node: <AwayTile name="Their partner" /> },
    ];
  };
  // The others on stage, in the order the scene brings them in.
  const stageOthers: SceneCell[] = pairOpponent ? pairCells() : [
    ...(opponentStreamId && battle && streamId
      ? [
          {
            key: "opponent",
            node: (
              <div className="relative size-full bg-black">
                {/* A practice battle's sparring partner is drawn: there's no stream behind it. */}
                {battle.practice ? (
                  <SparringTile battle={battle} />
                ) : (
                  <>
                    <LivePreview streamId={opponentStreamId} className="absolute inset-0" poster={<div className="absolute inset-0 bg-black" />} fallbackSrc={null} />
                    <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold">
                      {(sideOf(battle, streamId) === "host" ? battle.challenger : battle.host).displayName} · opponent
                    </span>
                  </>
                )}
              </div>
            ),
          },
        ]
      : []),
    ...stageTiles.map((t) => ({ key: t.identity, node: <StageTile fill track={guestTracksRef.current.get(t.identity)} label={t.name} /> })),
  ];
  // The phone cam, a source the scene places (scene.phoneSlot): the
  // renderer puts it over your picture, beside it, or in the corner.
  const phoneTile = phoneConnected && phoneTrackRef.current ? <StageTile fill track={phoneTrackRef.current} label="Phone cam" /> : undefined;
  const idle = !isLive && (source !== "camera" || !previewTrack);
  const encoderWaiting = isLive && source === "obs" && !obsFeedActive;

  /** The permanent key before a stream exists, the ingress once it does. */
  const keyRows = ingestProtocol === "whip" ? whipKey : isLive && ingressInfo ? ingressInfo : streamKey;

  const encoderBlock = (
    <div className="rounded-[12px] bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={SETUP_LABEL}>
          {isLive ? "Encoder connection" : "Your encoder key"}
        </p>
        {isLive ? (
          obsFeedActive ? (
            <span className="flex items-center gap-1.5 text-xs text-green-400"><span className="size-1.5 rounded-full bg-green-400" />Receiving</span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-amber-400"><span className="size-1.5 animate-pulse rounded-full bg-amber-400" />Waiting</span>
          )
        ) : (
          <button type="button" onClick={rotateKey} disabled={rotatingKey || !keyRows} className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
            {rotatingKey ? "Replacing…" : "Replace key"}
          </button>
        )}
      </div>
      {/* RTMP for any encoder; WHIP for OBS 30+ (lower delay). */}
      <div role="tablist" aria-label="Protocol" className="mt-3 inline-flex rounded-full bg-white/[0.05] p-0.5">
        {(["rtmp", "whip"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={ingestProtocol === p}
            onClick={() => setIngestProtocol(p)}
            className={cn(
              "press h-7 rounded-full px-3 text-[11.5px] font-semibold transition-colors",
              ingestProtocol === p ? "bg-white text-[#0b0708]" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {p === "rtmp" ? "RTMP" : "WHIP · OBS 30+"}
          </button>
        ))}
      </div>
      {keyRows ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">Server</span>
            <code className="min-w-0 flex-1 truncate rounded-[8px] bg-white/[0.05] px-2.5 py-2 font-mono text-xs text-foreground/90">{keyRows.url}</code>
            <Tip label="Copy the server URL">
              <button onClick={() => copyIngressField("url", keyRows.url)} aria-label="Copy the server URL" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground transition-colors hover:text-foreground">
                {copiedField === "url" ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            </Tip>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">{ingestProtocol === "whip" ? "Token" : "Key"}</span>
            <code className="min-w-0 flex-1 truncate rounded-[8px] bg-white/[0.05] px-2.5 py-2 font-mono text-xs text-foreground/90">{keyVisible ? keyRows.streamKey : "••••••••••••••••••••••••"}</code>
            <Tip label={keyVisible ? "Hide the key" : "Show the key"}>
              <button onClick={() => setKeyVisible((v) => !v)} aria-label={keyVisible ? "Hide the key" : "Show the key"} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground transition-colors hover:text-foreground">
                {keyVisible ? <EyeSlash size={14} /> : <Eye size={14} />}
              </button>
            </Tip>
            <Tip label="Copy the stream key">
              <button onClick={() => copyIngressField("key", keyRows.streamKey)} aria-label="Copy the stream key" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground transition-colors hover:text-foreground">
                {copiedField === "key" ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            </Tip>
          </div>
        </div>
      ) : (
        <div className="mt-3 h-[76px] animate-pulse rounded-[8px] bg-white/[0.04]" />
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground/70">
        {ingestProtocol === "whip"
          ? "In OBS 30 or later (32.1+ is best — it sends lighter qualities for weak connections): Settings → Stream → Service: WHIP, then paste the server and the bearer token. "
          : "Set it once in OBS or vMix — it never changes. "}
        If the connection drops, keep the encoder running: the stream holds for {Math.round(graceMs / 60_000)} minutes and picks up on its own. On a weak network, 720p at 30fps, 1500–2500 kbps CBR, keyframe every 2 seconds.
      </p>
      {/* Or skip the copy and paste: OBS on this computer, over its WebSocket. */}
      <ObsConnect protocol={ingestProtocol} server={keyRows?.url ?? null} secret={keyRows?.streamKey ?? null} live={isLive} />
    </div>
  );

  /* ---- Pre-live: one tap from the air; everything else waits behind More ---- */
  /** The console's opening line: who's about to be on. No checklist, no progress — nothing's required. */
  const setupHeader = (
    <div className="flex items-center gap-3">
      <UserAvatar src={user?.avatar ?? ""} name={user?.displayName || user?.username || "You"} size={40} className="size-10 shrink-0" />
      <div className="min-w-0">
        <p className="truncate font-wide text-[18px] leading-tight font-bold tracking-[-0.02em]">{user?.displayName || user?.username || "Your stream"}</p>
        <p className="truncate text-[12.5px] text-muted-foreground">{practice ? "Practice run · private" : user?.username ? `@${user.username}` : "Going live"}</p>
      </div>
    </div>
  );

  /** What's behind More, in a few words. */
  const moreSummary = practice ? "Practice run is on" : source !== "camera" ? `${source === "screen" ? "Screen" : "OBS"} · sound, schedule…` : "Source, sound & look, schedule…";
  /** The source and its shape, for the Source section's folded line. */
  const sourceSummary = source === "camera" ? `Camera · ${orientation === "portrait" ? "Portrait" : "Landscape"}` : source === "screen" ? "Screen" : "OBS or any encoder";
  /** The More button: a row in the console, a pill on the picture. Holds every other setup option. */
  const moreButton = (variant: "row" | "pill") =>
    variant === "row" ? (
      <button
        type="button"
        data-tour="studio-more"
        onClick={() => setMoreOpen(true)}
        aria-expanded={moreOpen}
        className="press flex w-full items-center gap-3 rounded-[12px] bg-tint/[0.04] px-3.5 py-3 text-left transition-colors hover:bg-tint/[0.07]"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint/[0.07]">
          <DotsThree size={18} weight="bold" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">More</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">{moreSummary}</span>
        </span>
        <CaretRight size={15} className="shrink-0 text-muted-foreground" />
      </button>
    ) : (
      <button
        type="button"
        data-tour="studio-more"
        onClick={() => setMoreOpen(true)}
        aria-expanded={moreOpen}
        aria-label="More setup options"
        className="obj press relative flex h-9 shrink-0 items-center gap-1.5 rounded-full pr-3.5 pl-3 text-[13px] font-semibold text-white"
      >
        <DotsThree size={17} weight="bold" />
        More
      </button>
    );

  // One column in the side panel; two once the console is wide enough (tablets).
  // Sponsors a rundown cue can put up: your own, and the campaigns you're running.
  const cueSponsors: CueSponsor[] = cueSponsorsOf(sponsorships.data ? { own: sponsorships.data.sponsors, campaigns: sponsorships.data.campaigns } : null);
  const segments = rundown.segments ?? [];
  const onAirIndex = show.position?.segmentId ? segments.findIndex((x) => x.id === show.position?.segmentId) : -1;
  const onAirSegment = onAirIndex >= 0 ? segments[onAirIndex]! : null;
  const nextSegment = onAirIndex >= 0 ? (segments[onAirIndex + 1] ?? null) : (segments[0] ?? null);
  // What the prompter reads: the segment on air, or — before a show — the one being prepared.
  const prompterSegment = onAirSegment ?? segments.find((x) => x.id === focusSegment) ?? segments[0] ?? null;

  /**
   * Put a segment on air: its clock starts on the server, then its cues go
   * to the picture through the scene route, the same way a hand-made
   * change does. Null stops the run of show.
   */
  const goSegment = async (segment: RundownSegment | null) => {
    setSegmentBusy(true);
    try {
      await show.go(segment?.id ?? null);
      const patch = segment ? applyCues(scene, segment, serverNow(), cueSponsors) : null;
      if (patch) await applyScene(patch);
    } finally {
      setSegmentBusy(false);
    }
  };
  useEffect(() => {
    vividShowRef.current = {
      layout: scene.layout,
      card: scene.card,
      graphicsUp: scene.layers.map((l) => l.kind),
      guestsOnStage: stageTiles.map((t) => t.name),
      besideHost: stageTiles.find((t) => t.identity === scene.spotlight)?.name ?? null,
      sponsors: cueSponsors.map((x) => x.name),
      show:
        segments.length > 0
          ? {
              onAir: onAirSegment?.title ?? null,
              next: nextSegment?.title ?? null,
              segments: segments.map((x) => `${x.title} (${formatLength(x.seconds)})`),
            }
          : null,
      prompter: prompterOn,
      autoDirector: directorOn,
    };
  });

  const runOfShow = (
    <RunOfShow
      segments={rundown.segments}
      status={rundown.status}
      onChange={rundown.update}
      live={isLive}
      position={show.position}
      onGo={goSegment}
      sponsors={cueSponsors}
      prompterOn={prompterOn}
      onPrompter={() => setPrompterOn((on) => !on)}
      onFocus={setFocusSegment}
    />
  );

  /** What's going on before anything's set: a stream still live without this studio, a booking being started. */
  const setupNotices = (orphan || orphanEnded || booking) && (
    <div className="flex flex-col gap-2.5">
      {(orphan || orphanEnded) && (() => {
        // Three ways a stream can be live without this studio on it — and,
        // heard on its room, the moment it isn't any more.
        const obs = orphan?.source === "obs";
        const holding = Boolean(orphan) && !obs && Boolean(orphan?.feedDroppedAt);
        const minutes = Math.round(graceMs / 60_000);
        const title = orphan?.title ?? orphanEnded ?? "";
        const heading = !orphan ? "has ended" : obs ? "is still live" : holding ? "is on hold" : "is live on another device";
        const body = !orphan
          ? "It went off the air on the other device. You're clear to go live here."
          : obs
            ? "Your encoder is the broadcaster, so closing this tab changed nothing for viewers. Reopen the studio to get chat, guests and gifts back."
            : holding
              ? `Your ${orphan.source === "screen" ? "screen share" : "camera"} dropped off the air, and viewers are seeing “Be right back”. Pick it up within ${minutes} minutes and the stream carries on where it left off.`
              : "Continue here to move it to this device — the other one steps off the air the moment this one joins.";
        const action = obs ? "Reopen studio" : holding ? "Resume stream" : "Continue here";
        // One drawing, morphing with the state: two devices, the hold, the end.
        const art: TourScene = !orphan ? "play" : holding ? "shield" : "second-cam";
        return (
          <div className="overflow-hidden rounded-[14px] bg-surface @[620px]:col-span-2" role="status" aria-live="polite">
            <div aria-hidden className="flex h-[108px] items-center justify-center bg-control/60">
              <TourArt scene={art} className="w-[120px]" />
            </div>
            <div className="px-4 pt-3.5 pb-4">
              <p className="text-[14.5px] font-semibold text-balance">
                &ldquo;{title}&rdquo; {heading}
              </p>
              <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{body}</p>
              {orphan ? (
                <div className="mt-3.5 flex gap-2">
                  <button onClick={resumeStream} disabled={resuming || endingOrphan} className="press flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-inverse text-[13.5px] font-semibold text-on-inverse disabled:opacity-50">
                    {resuming ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Broadcast size={14} weight="fill" />}
                    {action}
                  </button>
                  <button onClick={endOrphan} disabled={endingOrphan || resuming} className="press h-10 flex-1 rounded-full bg-control text-[13.5px] font-semibold text-foreground hover:bg-control-hover disabled:opacity-50">
                    {endingOrphan ? "Ending…" : "End it"}
                  </button>
                </div>
              ) : (
                <button onClick={() => setOrphanEnded(null)} className="press mt-3.5 h-10 w-full rounded-full bg-control text-[13.5px] font-semibold text-foreground hover:bg-control-hover">
                  Got it
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {booking && (
        <div className="flex items-start gap-3 rounded-[12px] bg-ember/[0.1] px-4 py-3.5 @[620px]:col-span-2">
          <CalendarPlus size={18} className="mt-0.5 shrink-0 text-ember-hi" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">Going live from your booking</p>
            <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
              Everyone who set a reminder for &ldquo;{booking.title}&rdquo; hears the moment you start. Its link and card become this stream.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setBooking(null);
              window.history.replaceState(null, "", "/studio");
            }}
            className="shrink-0 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Start fresh
          </button>
        </div>
      )}
    </div>
  );

  /**
   * The two things the go-live screen offers, both optional, as one field: the
   * category's cover and the title. On the console the cover grid opens over
   * the console itself.
   */
  const quickFields = (variant: "picture" | "panel") => (
    <DetailsField
      id="studio-title"
      variant={variant}
      title={title}
      onTitleChange={setTitle}
      category={category}
      onCategoryChange={setCategory}
      cover={variant === "panel"}
      trailing={variant === "picture" ? moreButton("pill") : undefined}
    />
  );

  /**
   * More: every other setup option, folded so the go-live screen stays a
   * camera and a button (owner: "add a More for more things and just wrap
   * more features there so users can just go live"). The same sections as
   * before, moved here, not rewritten.
   */
  const moreSections = (
    <div className="grid grid-cols-1 gap-6 @[620px]:grid-cols-2 @[620px]:gap-x-8">
      {/* A practice run: the same studio, a private room, simulated chat and gifts. */}
      <div data-tour="studio-practice" className="rounded-[12px] bg-tint/[0.04] px-3.5 py-3 @[620px]:col-span-2">
        <SwitchField
          label="Practice run"
          description={
            practice
              ? "Private. Nobody's told, nothing's listed, and chat and gifts are simulated. Try a practice battle from Battle. Your producers can still join."
              : "Rehearse in a private room with simulated chat and gifts, and try a battle against a sparring partner, before the real thing."
          }
          checked={practice}
          onCheckedChange={setPractice}
        />
      </div>

      {/* What goes out: the camera, a screen or an encoder — and, for a camera, its shape. */}
      <CollapsibleSection
        id="setup-source"
        title="Source & shape"
        icon={VideoCamera}
        summary={sourceSummary}
        defaultOpen={source === "obs"}
        className="@[620px]:col-span-2"
      >
        <div className="flex flex-col gap-4">
          <div className="flex rounded-full bg-control p-0.5" role="group" aria-label="Source">
            {(
              [
                { id: "camera" as SourceType, label: "Camera", icon: VideoCamera },
                { id: "screen" as SourceType, label: "Screen", icon: Monitor },
                { id: "obs" as SourceType, label: "OBS", icon: Broadcast },
              ]
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  // A count running for the old source goes nowhere.
                  countdown.cancel();
                  setSource(s.id);
                }}
                aria-pressed={source === s.id}
                className={cn(
                  "press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-colors",
                  source === s.id ? "bg-inverse text-on-inverse" : "text-foreground/60 hover:text-foreground"
                )}
              >
                <s.icon size={16} />
                {s.label}
              </button>
            ))}
          </div>
          {/* The shape of the stream — only a camera has one to choose. */}
          {source === "camera" && (
            <div className="flex items-center justify-between gap-3">
              <span className={SETUP_LABEL}>Shape</span>
              <div className="flex rounded-full bg-control p-0.5">
                {(["portrait", "landscape"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOrientation(o)}
                    aria-pressed={orientation === o}
                    className={cn(
                      "press flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors",
                      orientation === o ? "bg-inverse text-on-inverse" : "text-foreground/60 hover:text-foreground"
                    )}
                  >
                    <span className={cn("block rounded-[2px] border-[1.5px] border-current", o === "portrait" ? "h-3.5 w-2.5" : "h-2.5 w-3.5")} />
                    {o === "portrait" ? "Portrait" : "Landscape"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {source === "obs" && encoderBlock}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="setup-details"
        title="Tags & thumbnail"
        icon={Tag}
        summary={[tagList.length ? `${tagList.length} ${tagList.length === 1 ? "tag" : "tags"}` : "No tags", customThumbnail ? "Your thumbnail" : "Thumbnail taken at go-live"].join(" · ")}
        className="@[620px]:col-span-2"
      >
      <div className="grid grid-cols-1 gap-6 @[620px]:grid-cols-2 @[620px]:gap-x-8">
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="studio-tags" className={SETUP_LABEL}>
            Tags
          </label>
          <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">{tagList.length}/6</span>
        </div>
        <div className="mt-2.5 flex min-h-12 flex-wrap items-center gap-1.5 rounded-control bg-white/[0.06] px-3 py-2 shadow-[inset_0_0_0_1px_rgba(255,236,230,0.1)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--color-ember)]">
          {tagList.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-[8px] bg-white/[0.1] py-1 pr-1.5 pl-2.5 text-[12.5px] font-semibold text-foreground">
              {t}
              <button type="button" onClick={() => removeTag(t)} aria-label={`Remove ${t}`} className="flex size-4 items-center justify-center text-foreground/55 hover:text-foreground">
                <X size={11} weight="bold" />
              </button>
            </span>
          ))}
          <input
            id="studio-tags"
            type="text"
            placeholder={tagList.length === 0 ? "amapiano, ranked, q&a…" : ""}
            value={tagInput}
            onChange={(e) => (e.target.value.endsWith(",") ? (setTagInput(e.target.value), commitTag()) : setTagInput(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTag();
              } else if (e.key === "Backspace" && !tagInput && tagList.length > 0) {
                removeTag(tagList[tagList.length - 1]!);
              }
            }}
            onBlur={commitTag}
            className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground/45"
          />
          <Tag size={14} className="ml-auto shrink-0 text-muted-foreground/50" />
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground/70">Enter or a comma adds one. They help people searching find you.</p>
      </div>

      {/* The thumbnail at the shape it's shown: grab a frame, upload one, or let go-live take it. */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className={SETUP_LABEL}>Thumbnail</p>
          <p className="text-[11.5px] text-muted-foreground/70">{customThumbnail ? "This is what viewers see" : "Taken at go-live if you skip it"}</p>
        </div>
        <input ref={thumbInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { handleThumbnailFile(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="group relative mt-2.5 aspect-video overflow-hidden rounded-[12px] bg-white/[0.04]">
          {customThumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URI preview
            <img src={customThumbnail} alt="Your stream thumbnail" className="absolute inset-0 size-full object-cover" />
          ) : (
            <div className="absolute inset-0 opacity-40 grayscale-[35%]">
              <StreamArt src={undefined} category={category} alt="" seed={category} />
            </div>
          )}
          {customThumbnail ? (
            <div className="absolute right-2.5 bottom-2.5 flex gap-2">
              <button type="button" onClick={() => thumbInputRef.current?.click()} className="press flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3.5 text-[13px] font-semibold text-white hover:bg-black/70">
                <ImageEdit size={15} />
                Replace
              </button>
              <button type="button" onClick={() => setCustomThumbnail(null)} aria-label="Remove thumbnail" className="press flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/70">
                <X size={14} weight="bold" />
              </button>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-4 text-center">
              <div className="flex flex-wrap justify-center gap-2">
                {source === "camera" && (
                  <button type="button" onClick={captureFrame} disabled={!previewTrack} className="press flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-[#0b0708] disabled:opacity-40">
                    <Camera size={15} />
                    Capture frame
                  </button>
                )}
                <button type="button" onClick={() => thumbInputRef.current?.click()} className="press flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3.5 text-[13px] font-semibold text-white hover:bg-black/65">
                  <ImageSquare size={15} />
                  Upload
                </button>
              </div>
            </div>
          )}
        </div>
        {thumbError && <p className="mt-2 text-[12.5px] text-chili-hi">{thumbError}</p>}
      </div>
      </div>
      </CollapsibleSection>

      {/* How it opens, how much it sends, and where else it's posted. */}
      <CollapsibleSection
        id="setup-going-live"
        title="Going live"
        icon={Broadcast}
        summary={[openOnCard ? "Opens on “Starting soon”" : "Straight to camera", source !== "obs" && saveData ? "Save data" : null, postToWorldSpace ? "Posts to WorldSpace" : "Stays on Xtream"].filter(Boolean).join(" · ")}
        className="@[620px]:col-span-2"
      >
      <div className="flex flex-col gap-6">
      {/* Open on a card: the first frame anyone sees is "Starting soon". */}
      <div>
        <SwitchField
          label="Open on “Starting soon”"
          description={openOnCard ? "Viewers see the card first. Take it down from Scenes when you're ready." : "Viewers see your picture the moment you go live."}
          checked={openOnCard}
          onCheckedChange={setOpenOnCard}
        />
      </div>

      {/* A weak uplink: send less, steadily. */}
      {source !== "obs" && (
        <div className="border-t border-hairline pt-3">
          <SwitchField
            label="Save data — 540p"
            description={
              saveData
                ? "Sends 540p with voice-tuned sound: about half the upload, steadier on a weak connection."
                : "Sends up to 720p. Turn this on if your connection struggles."
            }
            checked={saveData}
            onCheckedChange={setSaveData}
          />
        </div>
      )}

      {/* Where it goes — the same switch as Settings and Schedule. */}
      <div className="border-t border-hairline pt-3">
        <SwitchField
          label="Post to WorldSpace"
          description={postToWorldSpace ? "Shows up in the WorldSpace feed — needs an account there on this same login." : "Stays on Xtream. Your followers here are still told."}
          checked={postToWorldSpace}
          onCheckedChange={toggleWorldSpace}
        />
      </div>
      </div>
      </CollapsibleSection>

      {/* Sound & look: what shapes your voice and your picture, set before anyone hears or sees them. */}
      {source !== "obs" && (
        <CollapsibleSection
          id="setup-sound-look"
          title="Sound & look"
          icon={Faders}
          summary={[
            voice.musicMode ? "Music mode" : voice.noiseFilter ? "Noise filter" : "No filter",
            presetLabel(voice.preset),
            ...(source === "camera"
              ? [
                  BACKGROUNDS.find((b) => b.id === look.background)?.label ?? "None",
                  LOOKS.find((l) => l.id === look.look)?.label ?? "Natural",
                  look.smooth > 0 ? "Smooth skin" : "None",
                  FACE_EFFECTS.find((f) => f.id === look.face && f.id !== "none")?.label ?? "None",
                ].filter((x) => x !== "None" && x !== "Natural")
              : []),
          ].join(" · ")}
          className="border-t border-white/[0.06] pt-3 @[620px]:col-span-2"
        >
          <div className="grid grid-cols-1 gap-6 @[620px]:grid-cols-2 @[620px]:gap-x-8">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">Sound</p>
              <SoundSetup
                className="mt-2.5"
                settings={voice}
                onChange={changeVoice}
                supported={{ noiseFilter: noiseFilterOk }}
                meter={() => (deskRef.current ? deskRef.current.meters().mic : null)}
                compare={deskOn ? { start: () => deskRef.current?.setBypass(true), stop: () => deskRef.current?.setBypass(false) } : null}
                live={isLive}
              />
            </div>
            {source === "camera" && (
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">Picture</p>
                <LookSetup
                  className="mt-2.5"
                  settings={look}
                  onChange={(next) => void changeLook(next)}
                  supported={looksSupported}
                  deviceOk={deviceOk}
                  onPickImage={(f) => {
                    setLookImage(f);
                    setLookSettings({ background: "image" });
                  }}
                  imageUrl={lookImage?.url ?? null}
                  compare={lookTrack() ? { start: () => setLookBypass(lookTrack()!, true), stop: () => setLookBypass(lookTrack()!, false) } : null}
                />
                {lookNote && (
                  <p role="status" className="mt-2 text-[12px] leading-snug text-warning">
                    {lookNote}
                  </p>
                )}
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Sharing a screen: the privacy shield, set up before the share starts — open, it's the one that matters. */}
      {source === "screen" && (
        <CollapsibleSection id="setup-shield" title="Privacy shield" icon={Shield} summary={shieldSummary} defaultOpen className="border-t border-white/[0.06] pt-3 @[620px]:col-span-2">
          <PrivacyShieldPanel sharing={false} prewarm headless />
        </CollapsibleSection>
      )}

      {/* A Set: the stream's personality, chosen before anyone sees it. */}
      {source === "camera" && (
        <CollapsibleSection id="setup-sets" title="Sets" icon={Sparkle} summary={setsSummary} className="border-t border-white/[0.06] pt-3 @[620px]:col-span-2">
          {setsPanel}
        </CollapsibleSection>
      )}

      {/* A second camera pairs before going live too: the phone holds the code and sends the moment you do. */}
      {source !== "obs" && user && (
        <CollapsibleSection id="setup-second-camera" title="Second camera" icon={Camera} summary={secondCameraSummary} className="border-t border-white/[0.06] pt-3 @[620px]:col-span-2">
          <SecondCameraPanel
            hostId={user.id}
            layout={scene.layout}
            phoneSlot={scene.phoneSlot ?? "off"}
            onPlace={(patch) => void applyScene(patch)}
            sharing={Boolean(localScreen) || source === "screen"}
            hasCamera={source === "camera"}
            phoneConnected={phoneConnected}
            headless
          />
        </CollapsibleSection>
      )}

      {/* The run of show: segments, the prompter's script, and what each puts on screen. */}
      <div className="border-t border-white/[0.06] pt-4 @[620px]:col-span-2">
        {showPlanner ? (
          runOfShow
        ) : (
          <button
            type="button"
            onClick={() => setShowPlanner(true)}
            className="press flex w-full items-center gap-3 rounded-[14px] bg-white/[0.04] p-3.5 text-left transition-colors hover:bg-white/[0.06]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/[0.07]">
              <Playlist size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">Run of show</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">
                {segments.length > 0
                  ? `${segments.length} ${segments.length === 1 ? "segment" : "segments"} · ${formatLength(totalSeconds(segments))} · the prompter reads your script`
                  : "Plan segments, a script for the prompter, and what goes on screen"}
              </span>
            </span>
            <CaretRight size={16} className="shrink-0 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Later, not now: a booking with a reminder for your followers. */}
      <Link
        href="/schedule"
        className="press flex items-center gap-3 rounded-[14px] bg-tint/[0.04] p-3.5 transition-colors hover:bg-tint/[0.06] @[620px]:col-span-2"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tint/[0.07]">
          <CalendarPlus size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">Schedule for later</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">Book a time — followers can set a reminder</span>
        </span>
        <CaretRight size={16} className="shrink-0 text-muted-foreground" />
      </Link>

      {/* Charts, prices and market calls: on for markets and crypto streams, an option for everyone else. */}
      <div className="rounded-[12px] bg-tint/[0.04] px-3.5 py-3 @[620px]:col-span-2">
        <SwitchField
          label="Market tools"
          description={
            isMarketCategory(category)
              ? "On for this category: live charts, a price strip and market calls in Scenes."
              : "Live charts, a price strip and market calls in Scenes — for when your stream talks markets."
          }
          checked={marketTools || isMarketCategory(category)}
          disabled={isMarketCategory(category)}
          onCheckedChange={toggleMarketTools}
        />
      </div>
    </div>
  );

  /**
   * Go live: the one big button. A camera counts 3·2·1 over its preview and
   * a second tap calls it off; nothing holds it back but a camera or mic
   * the browser won't hand over — and then it says why, with the fix.
   */
  const goLiveAction = (variant: "console" | "picture") => {
    const counting = countdown.running;
    return (
      <div className={variant === "console" ? "p-4 pt-3" : undefined}>
        {/* Going live for a battle: the opponent comes after — or a practice round first. */}
        {battleAsk && !counting && (
          <BattleAskStrip practice={practice} onPracticeFirst={() => setPractice(true)} onDismiss={() => setBattleAsk(false)} onPicture={variant === "picture"} />
        )}
        {practice && !counting && (
          <div className="mb-2.5 flex justify-center">
            <button
              type="button"
              onClick={() => setPractice(false)}
              className="press flex h-7 items-center gap-1.5 rounded-full bg-ember px-3 text-[12px] font-bold text-on-ember"
              aria-label="Practice run is on — turn it off"
            >
              Practice run
              <X size={11} weight="bold" />
            </button>
          </div>
        )}
        <Button
          variant="live"
          size="lg"
          onClick={pressGoLive}
          disabled={!counting && (Boolean(blocker) || isConnecting)}
          aria-label={counting ? `Going live in ${countdown.count} — tap to cancel` : undefined}
          // The size's own height stands unless overridden outright (tailwind-merge keeps both).
          className={cn("w-full gap-2", variant === "picture" ? "h-14! text-[17px]" : "text-[16px]", counting && "bg-chili/85")}
        >
          {isConnecting ? (
            <>
              <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Going live…
            </>
          ) : counting ? (
            <>
              <span className="font-mono tabular-nums">{countdown.count}</span>
              <span aria-hidden className="text-white/60">·</span>
              Tap to cancel
            </>
          ) : practice ? (
            <>
              <Lightning size={18} weight="fill" />
              Start practice
            </>
          ) : (
            <>
              <Lightning size={18} weight="fill" />
              Go live
            </>
          )}
        </Button>
        <p className={cn("mt-2.5 text-center text-[12px]", variant === "picture" ? "text-white/70" : "text-muted-foreground/70")} role={blocker ? "status" : undefined}>
          {blocker && !isConnecting ? (
            <>
              {blocker.why}{" "}
              {blocker.fix && (
                <button type="button" onClick={blocker.onFix} className="font-semibold text-ember-hi underline-offset-2 hover:underline">
                  {blocker.fix}
                </button>
              )}
            </>
          ) : counting ? (
            "Get ready — you're on in a moment."
          ) : practice ? (
            "Nobody's told. End it whenever you like."
          ) : booking ? (
            "Everyone with a reminder hears it the second you start."
          ) : (
            "Your followers hear about it the second you start."
          )}
        </p>
      </div>
    );
  };

  // The chat on screen: the lane over the picture, and the compact room sheet it brings on phones.
  const chatOnScreen = useChatOnScreen<Panel>({ phone, live: isLive, source, panel, setPanel });

  /* ---- Live: the room's header — two numbers you can open, then the tools ---- */
  // The tools, each with its name under its icon (Greg couldn't tell the icon-only row apart).
  const roomTabs: RoomTab<Panel>[] = [
    { id: "chat", label: "Chat", icon: ChatText, tip: chatOnScreen.compact ? "Open the full chat" : "The chat" },
    { id: "stage", label: "Guests", icon: HandWaving, tip: "Bring guests on stage, or co-live", badge: stageRequests.length, tour: "studio-stage" },
    { id: "requests", label: "Requests", icon: Ticket, tip: "Paid requests from viewers", badge: requestQueue.pending.length },
    { id: "scenes", label: "Scenes", icon: LayoutIcon, tip: "Layouts, cards and graphics", tour: "studio-scenes" },
    { id: "battle", label: "Battle", icon: Sword, tip: practice ? "Try a practice battle" : "Battle another host" },
    { id: "games", label: "Games", icon: Sparkle, tip: "Predictions, raffles and quizzes" },
    { id: "more", label: "More", icon: DotsThree, tip: "Everything else" },
  ];
  const statChip = (key: Panel, icon: React.ReactNode, value: React.ReactNode, word: string) => {
    const on = panel === key;
    return (
      <button
        type="button"
        onClick={() => setPanel(on ? "chat" : key)}
        aria-pressed={on}
        className={cn(
          "press flex h-9 min-w-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
          on ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground hover:bg-white/[0.1]",
        )}
      >
        {icon}
        {value}
        <span className={on ? "text-[#0b0708]/55" : "text-muted-foreground"}>{word}</span>
      </button>
    );
  };
  const roomHeader = (
    <div className="shrink-0 px-4 pt-3 pb-2">
      <div className="flex items-center gap-2">
        {statChip("viewers", <Eye size={15} weight="bold" />, <span className="font-mono tabular-nums">{viewerCount}</span>, "watching")}
        {statChip("stats", <Gift size={15} weight="fill" className={panel === "stats" ? undefined : "text-value"} />, <span className={cn("font-money text-[15px] leading-none", panel !== "stats" && "text-value")}>{tipsLabel}</span>, "gifts")}
      </div>
      {/* The tools, named; the open one a white pill. With the chat on screen, none is open. */}
      <RoomTabs
        className="mt-3"
        label="Your room"
        items={roomTabs}
        value={chatOnScreen.tabValue !== null && roomTabs.some((t) => t.id === chatOnScreen.tabValue) ? chatOnScreen.tabValue : null}
        onChange={chatOnScreen.onTab}
      />
    </div>
  );

  const stagePanel = (
    <div className="space-y-6 px-4 pt-4 pb-4">
      {stageError && <p className="rounded-[10px] bg-chili/[0.12] px-3 py-2 text-xs text-chili-hi">{stageError}</p>}
      {coLiveInvite && (
        <div className="rounded-[12px] bg-ember/[0.1] p-3.5">
          <div className="flex items-center gap-2.5">
            <UserAvatar src={coLiveInvite.fromAvatar ?? ""} name={coLiveInvite.fromDisplayName ?? coLiveInvite.fromUsername} size={30} className="size-[30px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{coLiveInvite.fromDisplayName ?? coLiveInvite.fromUsername} wants to co-live</p>
              <p className="truncate text-xs text-muted-foreground">Your stream merges into &ldquo;{coLiveInvite.fromTitle ?? "their live"}&rdquo; — your viewers come with you.</p>
            </div>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button onClick={acceptCoLive} disabled={coLiveBusy} className="h-9 flex-1 rounded-full bg-white text-[13px] font-semibold text-neutral-950 transition-colors hover:bg-neutral-100 disabled:opacity-50">{coLiveBusy ? "Merging…" : "Accept & merge"}</button>
            <button onClick={declineCoLive} disabled={coLiveBusy} className="h-9 flex-1 rounded-full bg-white/[0.08] text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.12] disabled:opacity-50">Decline</button>
          </div>
        </div>
      )}

      <StageLineControl line={stageLine} onChange={saveStageLine} />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className={SETUP_LABEL}>Asking to join</h3>
          <span className="text-[11px] text-muted-foreground/60">{liveGuests.length}/{MAX_STAGE_GUESTS} slots used</span>
        </div>
        {stageRequests.length === 0 ? (
          <p className="text-[13px] text-muted-foreground/60">When viewers tap &ldquo;Join stream&rdquo;, they show up here for you to approve.</p>
        ) : (
          <div className="space-y-1.5">
            {stageRequests.map((r) => (
              <div key={r.userId} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.045] px-3 py-2.5">
                <UserAvatar src={r.avatar} name={r.username} size={32} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground/90">{r.username}</p>
                  <StandingLine standing={r.standing} />
                </div>
                <button onClick={() => backstageGuest(r.userId)} disabled={stageBusyId !== null || backstageGuests.length >= MAX_BACKSTAGE} title={backstageGuests.length >= MAX_BACKSTAGE ? "Backstage is full" : "Let them in to check their camera and mic first — viewers won't see them yet"} className="h-8 shrink-0 rounded-full bg-white/[0.07] px-2.5 text-[12.5px] font-medium text-foreground/85 transition-colors hover:bg-white/[0.12] disabled:opacity-50">Backstage</button>
                <button onClick={() => approveGuest(r.userId)} disabled={stageBusyId !== null || liveGuests.length >= MAX_STAGE_GUESTS} title={liveGuests.length >= MAX_STAGE_GUESTS ? "The stage is full" : "Bring them on"} className="flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-neutral-950 transition-colors hover:bg-neutral-100 disabled:opacity-50">
                  {stageBusyId === r.userId ? <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" /> : <Check size={13} weight="bold" />}
                  Approve
                </button>
                <Tip label="Decline their request">
                  <button onClick={() => denyGuest(r.userId)} disabled={stageBusyId !== null} aria-label={`Decline ${r.username}`} className="flex size-8 items-center justify-center rounded-full bg-white/[0.07] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"><X size={14} /></button>
                </Tip>
              </div>
            ))}
          </div>
        )}
      </div>

      {backstageGuests.length > 0 && (
        <div>
          <h3 className={cn(SETUP_LABEL, "mb-2")}>Backstage</h3>
          <div className="space-y-1.5">
            {backstageGuests.map((g) => (
              <div key={g.userId} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.045] px-3 py-2.5">
                {/* Their picture, small: are they framed, is the light right. */}
                <span className="relative aspect-video w-14 shrink-0 overflow-hidden rounded-[8px] bg-black">
                  <StageTile fill track={guestTracksRef.current.get(g.userId)} label="" />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">{g.username}</p>
                <button onClick={() => approveGuest(g.userId)} disabled={stageBusyId !== null || liveGuests.length >= MAX_STAGE_GUESTS} title={liveGuests.length >= MAX_STAGE_GUESTS ? "The stage is full" : "Put them on stage"} className="flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-neutral-950 transition-colors hover:bg-neutral-100 disabled:opacity-50">
                  {stageBusyId === g.userId ? <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" /> : <Check size={13} weight="bold" />}
                  Put on
                </button>
                <Tip label="Send them back to the room">
                  <button onClick={() => removeGuest(g.userId)} disabled={stageBusyId !== null} aria-label={`Send ${g.username} back to the room`} className="flex size-8 items-center justify-center rounded-full bg-white/[0.07] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"><X size={14} /></button>
                </Tip>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground/50">Camera and mic on, seen and heard by you and your producers only, until you put them on.</p>
        </div>
      )}

      <div>
        <h3 className={cn(SETUP_LABEL, "mb-2")}>On stage now</h3>
        {liveGuests.length === 0 ? (
          <p className="text-[13px] text-muted-foreground/60">No guests yet. Approve a request and they join with their camera.</p>
        ) : (
          <div className="space-y-1.5">
            {liveGuests.map((g) => (
              <div key={g.userId} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.045] px-3 py-2.5">
                <UserAvatar src={g.avatar} name={g.username} size={32} className="size-8" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">{g.username}</p>
                <InterpreterToggle on={scene.interpreter === g.userId} onToggle={(on) => void applyScene({ interpreter: on ? g.userId : null })} />
                <button onClick={() => removeGuest(g.userId)} disabled={stageBusyId !== null} className="h-8 rounded-full bg-white/[0.07] px-3 text-[12.5px] font-medium text-foreground/85 transition-colors hover:bg-white/[0.12] disabled:opacity-50">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* A phone as a second camera: the code to scan, and what viewers see of it. */}
      {user && (
        <CollapsibleSection id="live-second-camera" title="Second camera" icon={Camera} summary={secondCameraSummary}>
          <SecondCameraPanel
            hostId={user.id}
            layout={scene.layout}
            phoneSlot={scene.phoneSlot ?? "off"}
            onPlace={(patch) => void applyScene(patch)}
            sharing={Boolean(localScreen) || source === "screen"}
            hasCamera={source === "camera"}
            phoneConnected={phoneConnected}
            headless
            startSignal={phoneAsk}
          />
        </CollapsibleSection>
      )}

      {otherLive.length > 0 && (
        <div>
          <h3 className={cn(SETUP_LABEL, "mb-2")}>Live now — invite to co-live</h3>
          <div className="space-y-1.5">
            {otherLive.map((s) => {
              const name = s.streamerId?.displayName || s.streamerId?.username || "Streamer";
              const invited = coLiveInvited.has(s._id);
              return (
                <div key={s._id} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.045] px-3 py-2.5">
                  <span className="relative shrink-0">
                    <UserAvatar src={s.streamerId?.avatar ?? ""} name={name} size={32} className="size-8" />
                    <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-chili ring-2 ring-card" />
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-sm text-foreground/90">{name}</p>
                    <p className="truncate text-[11.5px] text-muted-foreground/70">{s.title}</p>
                  </div>
                  <button onClick={() => inviteCoLive(s._id)} disabled={coLiveBusy || invited} className={cn("h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-60", invited ? "bg-white/[0.06] text-muted-foreground" : "bg-white/[0.08] text-foreground hover:bg-white/[0.12]")}>
                    {invited ? "Invited" : "Invite"}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground/50">If they accept, their stream ends and they join your stage — their viewers are brought along.</p>
        </div>
      )}
    </div>
  );

  /**
   * Change the scene. Shown at once here, then saved and broadcast by the
   * API (room metadata + an `__evt: scene`); a refusal puts it back.
   */
  const applyScene = async (
    patch: Partial<Pick<Scene, "layout" | "card" | "cardNote" | "layers" | "chart" | "gains" | "spotlight" | "interpreter" | "phoneSlot">>,
    /** The auto-director's own cuts don't pause it; anyone else's framing does. */
    by: "host" | "director" = "host",
  ): Promise<string | null> => {
    if (!streamId) return "Go live first";
    if (by === "host" && ("layout" in patch || "card" in patch || "spotlight" in patch)) {
      setFramedBy("you");
      director.pause();
    }
    const before = scene;
    const next = { ...scene, ...patch, version: scene.version + 1 };
    setScene(next);
    try {
      const r = await apiFetch<{ success: boolean; data: { scene: Scene } }>(`/api/streams/${streamId}/scene`, {
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
          // Where the phone sits; the API keeps the older angle in step.
          phoneSlot: next.phoneSlot ?? "off",
        }),
      });
      setScene((cur) => (r.data.scene.version >= cur.version ? r.data.scene : cur));
      return null;
    } catch (err) {
      setScene(before);
      const message = err instanceof Error ? err.message : "Couldn't change the scene";
      setError(message);
      return message;
    }
  };

  /**
   * Vivid as producer: a voice request becomes exactly the tap it names —
   * the same scene writes, run-of-show steps and room calls as the panels
   * make (lib/vivid/page-context.ts). Answers in words Vivid can say.
   */
  const produce = async (req: ProductionRequest): Promise<Record<string, unknown>> => {
    const ok = (said: Record<string, unknown> = {}) => ({ success: true, ...said });
    if (req.do !== "prompter" && req.do !== "director" && (!isLive || !streamId)) {
      return { error: "Go live first — that changes what viewers see." };
    }
    const scenery = async (patch: Parameters<typeof applyScene>[0], said: Record<string, unknown>) => {
      const failed = await applyScene(patch);
      return failed ? { error: failed } : ok(said);
    };
    const byName = <T extends { name: string }>(list: T[], name: string) => {
      const q = name.trim().toLowerCase();
      return list.find((x) => x.name.toLowerCase() === q) ?? list.find((x) => x.name.toLowerCase().includes(q));
    };
    switch (req.do) {
      case "layout": {
        const layout = LAYOUTS.find((l) => l.id === req.layout);
        if (!layout) return { error: `There's no layout called ${req.layout}.`, layouts: LAYOUTS.map((l) => l.id) };
        if (battle) return { error: "A battle keeps both sides on screen until it ends." };
        return scenery(layout.id === "chart-face" && !scene.chart ? { layout: layout.id, chart: DEFAULT_CHART } : { layout: layout.id }, { layout: layout.label });
      }
      case "card": {
        if (req.card === null) return scenery({ card: null }, { card: "taken down" });
        const card = CARDS.find((c) => c.id === req.card);
        return card ? scenery({ card: card.id }, { card: card.title }) : { error: `There's no card called ${req.card}.` };
      }
      case "spotlight": {
        const guest = byName(stageTiles, req.guest);
        if (!guest) return { error: stageTiles.length ? `No one called ${req.guest} is on stage.` : "No guests are on stage.", onStage: stageTiles.map((t) => t.name) };
        const keep = scene.layout === "split" || scene.layout === "trio";
        return scenery({ spotlight: guest.identity, ...(keep ? {} : { layout: "split" as const }) }, { beside: guest.name });
      }
      case "chart": {
        const raw = req.market.trim().toUpperCase().replace(/[\s/]+/g, "-");
        const symbol = raw.includes("-") ? raw : `${raw}-USD`;
        if (!/^[A-Z0-9]{2,10}-[A-Z]{3,4}$/.test(symbol)) return { error: `I can't chart ${req.market}.` };
        return scenery({ layout: "chart-face", chart: { symbol, interval: scene.chart?.interval ?? "5m" } }, { chart: symbol });
      }
      case "lower_third":
        return scenery(
          { layers: withLayer(scene.layers, "lower-third", { kind: "lower-third", title: req.title.slice(0, 48), subtitle: (req.subtitle ?? "").slice(0, 72) }) },
          { lowerThird: req.title },
        );
      case "banner":
        return scenery({ layers: withLayer(scene.layers, "banner", { kind: "banner", text: req.text.slice(0, 100) }) }, { banner: req.text });
      case "countdown": {
        const minutes = Math.min(120, Math.max(1, Math.round(req.minutes)));
        const endsAt = new Date(serverNow() + minutes * 60_000).toISOString();
        return scenery({ layers: withLayer(scene.layers, "countdown", { kind: "countdown", label: (req.label ?? "").slice(0, 40), endsAt }) }, { countdownMinutes: minutes });
      }
      case "sponsor": {
        const s = byName(cueSponsors, req.name);
        if (!s) return { error: `There's no sponsor called ${req.name}.`, sponsors: cueSponsors.map((x) => x.name) };
        const layer = { kind: "sponsor" as const, source: s.source, sponsorId: s.id, name: s.name, line: s.line, url: s.url, code: s.code, logoUrl: s.logoUrl, restricted: s.restricted };
        return scenery({ layers: withLayer(scene.layers, "sponsor", layer) }, { sponsor: s.name, label: "Paid promotion" });
      }
      case "hide": {
        const kind = ({ lower_third: "lower-third", banner: "banner", countdown: "countdown", sponsor: "sponsor", ticker: "ticker", qr: "cta" } as const)[req.graphic];
        if (!scene.layers.some((l) => l.kind === kind)) return ok({ note: "It wasn't up." });
        return scenery({ layers: withLayer(scene.layers, kind, null) }, { hidden: req.graphic });
      }
      case "show": {
        if (segments.length === 0) return { error: "There's no run of show yet — it's written in the studio's Run of show panel." };
        const target = req.step === "start" ? segments[0]! : req.step === "next" ? nextSegment : null;
        if (req.step === "next" && !target) return { error: "That was the last segment." };
        await goSegment(target);
        return ok(target ? { onAir: target.title, next: segments[segments.indexOf(target) + 1]?.title ?? null } : { stopped: true });
      }
      case "prompter":
        setPrompterOn(req.on);
        return ok({ prompter: req.on ? "on" : "off" });
      case "director":
        setDirector(req.on);
        return ok({ director: req.on ? "on" : "off", ...(req.on && directorBlocked ? { standingBy: directorBlocked } : {}) });
      case "shield":
        await apiFetch(`/api/streams/${streamId}/shield`, { method: "POST", body: JSON.stringify({ on: req.on }) });
        return ok({ shield: req.on ? "up" : "down" });
      case "prediction": {
        const r = await apiFetch<{ success: boolean; data: { game: { question: string } } }>(`/api/streams/${streamId}/games`, {
          method: "POST",
          body: JSON.stringify({
            type: "prediction",
            question: req.question.slice(0, 140),
            outcomes: req.outcomes.map((o) => o.slice(0, 40)),
            durationSec: Math.min(600, Math.max(30, Math.round(req.seconds ?? 120))),
          }),
        });
        return ok({ question: r.data.game.question });
      }
      case "sound": {
        const pad = PADS.find((p) => p.id === req.pad);
        if (!pad) return { error: `There's no sound called ${req.pad}.` };
        if (!deskOnRef.current || !deskRef.current) return { error: "Turn the audio desk on first — Sound, in the dock." };
        await deskRef.current.playPad(pad.id);
        return ok({ played: pad.label });
      }
      case "ban": {
        const found = await apiFetch<{ success: boolean; data: { channels: { id: string; username: string }[] } }>(`/api/users/search?q=${encodeURIComponent(req.username)}&limit=5`);
        const who = found.data.channels.find((c) => c.username.toLowerCase() === req.username.toLowerCase());
        if (!who) return { error: `There's no one called ${req.username}.` };
        await apiFetch(`/api/streams/${streamId}/ban/${who.id}`, { method: "POST", body: JSON.stringify(req.minutes ? { minutes: Math.round(req.minutes) } : {}) });
        return ok({ banned: who.username, ...(req.minutes ? { minutes: Math.round(req.minutes) } : {}) });
      }
    }
  };
  const produceRef = useRef(produce);
  useEffect(() => {
    produceRef.current = produce;
  });
  useEffect(() => registerProductionBridge((req) => produceRef.current(req)), []);

  // The brand kit, for the preview and the Scenes panel.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { brand: unknown } }>("/api/users/me/brand")
      .then((r) => {
        if (!cancelled) setBrand(readBrand(r.data.brand));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  /** Save part of the brand kit: colours show at once, a logo once it's stored. */
  const saveBrand = async (patch: BrandPatch) => {
    const before = brand;
    setBrand((b) => ({
      ...b,
      ...(patch.accent ? { accent: patch.accent } : {}),
      ...(patch.lowerThird ? { lowerThird: patch.lowerThird } : {}),
      ...(patch.font ? { font: patch.font } : {}),
      ...(patch.presets ? { presets: patch.presets } : {}),
    }));
    try {
      const r = await apiFetch<{ success: boolean; data: { brand: unknown } }>("/api/users/me/brand", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setBrand(readBrand(r.data.brand));
    } catch (err) {
      setBrand(before);
      if (patch.logo && err instanceof ApiError && err.status === 400) {
        throw new Error("That image is too big even squeezed down — try a simpler one.");
      }
      throw new Error("Couldn't save that — try again.");
    }
  };

  /**
   * Put the audio desk in the mic's path. The audio context has to start
   * from a click, and if it ever stops running, the desk steps out so the
   * mic goes out as it is — a silent broadcast is the one thing it must
   * never cause.
   */
  async function startDesk() {
    const track = audioTrackRef.current;
    if (!track) {
      setError("Turn your mic on first.");
      return;
    }
    setDeskStarting(true);
    try {
      const ctx = deskCtxRef.current ?? new AudioContext({ latencyHint: "interactive" });
      deskCtxRef.current = ctx;
      await ctx.resume();
      if (ctx.state !== "running") throw new Error("audio context not running");
      ctx.onstatechange = () => {
        if (deskOnRef.current && ctx.state !== "running") void stopDesk();
      };
      track.setAudioContext(ctx);
      const desk = new AudioDesk(deskSettings, voiceRef.current);
      await track.setProcessor(desk);
      deskRef.current = desk;
      deskOnRef.current = true;
      setDeskOn(true);
    } catch {
      await track.stopProcessor().catch(() => {});
      deskRef.current = null;
      deskOnRef.current = false;
      setDeskOn(false);
      setError("The audio desk couldn't start, so your mic goes out as it is.");
    } finally {
      setDeskStarting(false);
    }
  }
  async function stopDesk() {
    deskOnRef.current = false;
    setDeskOn(false);
    deskRef.current = null;
    await audioTrackRef.current?.stopProcessor().catch(() => {});
  }
  // The scene's guest faders, however they arrive (a reload picks them up
  // from the room): guests the host hears play at those levels too.
  const sceneGains = scene.gains;
  useEffect(() => {
    gainsRef.current = sceneGains ?? {};
    guestAudioElsRef.current.forEach((el) => {
      el.volume = gainFor(gainsRef.current, el.dataset.identity);
    });
  }, [sceneGains]);

  /** A guest's fader: heard here at once, and by every viewer once the scene carries it. */
  const setGuestGain = (identity: string, level: number) => {
    const gains = { ...(scene.gains ?? {}), [identity]: Math.round(level * 100) / 100 };
    gainsRef.current = gains;
    setScene((cur) => ({ ...cur, gains }));
    guestAudioElsRef.current.forEach((el) => {
      if (el.dataset.identity === identity) el.volume = level;
    });
    if (gainTimerRef.current) clearTimeout(gainTimerRef.current);
    gainTimerRef.current = setTimeout(() => void applyScene({ gains }), 300);
  };

  /** The scene an API call answered with — the newer version wins, as everywhere. */
  const takeScene = (raw: unknown) => {
    const next = readScene(raw);
    setScene((cur) => newerScene(cur, next) ?? cur);
  };

  /** Comments-on-screen choices save to the channel, like slow mode. */
  const saveFeatureSettings = (settings: { featureSeconds?: number; featureGiftsFromMinor?: number }) => {
    apiFetch("/api/user/me", { method: "PATCH", body: JSON.stringify({ settings }) }).catch(() =>
      setError("Couldn't save that setting — it's on for this stream only.")
    );
  };


  // What's waiting when the room opens (a resume, a reload); the chat
  // follows the queue from there.
  useEffect(() => {
    if (!streamId || !isLive) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { queue: unknown } }>(`/api/streams/${streamId}/feature-queue`)
      .then((r) => {
        if (!cancelled) setFeatureQueue(readFeatureQueue(r.data.queue));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [streamId, isLive]);

  // A resumed broadcast's goal and meter, as the API has them; room events
  // carry them on from here.
  useEffect(() => {
    if (!streamId || !isLive) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { stream: { goal?: unknown; heat?: unknown } } }>(`/api/streams/${streamId}`)
      .then((r) => {
        if (cancelled) return;
        const loadedGoal = readGoal(r.data.stream.goal);
        const loadedHeat = readHeat(r.data.stream.heat);
        setGoal((g) => newerGoal(g, loadedGoal));
        setHeat((h) => newerHeat(h, loadedHeat));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [streamId, isLive]);

  /** A suggested line: up on screen (it leaves the queue), or turned down. */
  const putUpSuggested = async (messageId: string) => {
    if (!streamId) return;
    try {
      const r = await apiFetch<{ success: boolean; data: { scene: unknown } }>(`/api/streams/${streamId}/chat/${messageId}/feature`, {
        method: "POST",
        body: JSON.stringify({ seconds: featureSeconds || null }),
      });
      takeScene(r.data.scene);
      setFeatureQueue((q) => q.filter((x) => x.messageId !== messageId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't put that up");
    }
  };
  const dismissSuggested = async (messageId: string) => {
    if (!streamId) return;
    setFeatureQueue((q) => q.filter((x) => x.messageId !== messageId));
    try {
      const r = await apiFetch<{ success: boolean; data: { queue: unknown } }>(`/api/streams/${streamId}/feature-queue/${messageId}`, {
        method: "DELETE",
      });
      setFeatureQueue(readFeatureQueue(r.data.queue));
    } catch {
      // It stays turned down here; the next queue event settles it.
    }
  };

  const takeDownFeatured = async () => {
    const current = scene.featured;
    if (!streamId || !current) return;
    try {
      const r = await apiFetch<{ success: boolean; data: { scene: unknown } }>(
        `/api/streams/${streamId}/chat/${current.id}/feature`,
        { method: "DELETE" }
      );
      takeScene(r.data.scene);
    } catch {
      setError("Couldn't take it down — it comes down at its time anyway.");
    }
  };

  // Sharing a screen beside the camera: the screen takes the preview's main
  // picture (what viewers see) and the camera moves to the corner; when the
  // share stops, the camera comes back.
  useEffect(() => {
    const el = videoElRef.current;
    if (!el || !isLive || source !== "camera") return;
    const track = localScreen ?? videoTrackRef.current;
    track?.attach(el);
  }, [localScreen, isLive, source]);

  const priceStrip = layerOf(scene.layers, "prices")?.symbols ?? [];
  const scenesPanel = (
    <div className="flex flex-col gap-6 px-4 pt-1 pb-6">
      {/* A shared screen first: what it might show that viewers mustn't see. */}
      {(shieldTrack || source === "screen") && (
        <CollapsibleSection id="live-shield" title="Privacy shield" icon={Shield} summary={shieldSummary} defaultOpen>
          <PrivacyShieldPanel sharing={Boolean(shieldTrack)} editingZones={editingZones} onEditZones={setEditingZones} prewarm={source === "screen" || screenShareActive} headless />
        </CollapsibleSection>
      )}
      <DirectorSwitch
        on={directorOn}
        onToggle={setDirector}
        live={isLive}
        blocked={directorBlocked}
        pausedUntil={director.pausedUntil}
        pausedBy={framedBy}
        onResume={director.resume}
        shot={shotOf(scene)}
        names={stageTiles}
      />

      {/* Chat's $tickers and the market's moments lead only on a markets stream, or once asked for. */}
      {marketsUp && (
        <>
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

      <MarketSuggestions
        suggestions={marketSuggestions.suggestions}
        charted={scene.layout === "chart-face" ? (scene.chart?.symbol ?? null) : null}
        onChart={(symbol, interval) => void applyScene({ layout: "chart-face", chart: { symbol, interval } })}
        onBanner={(text) => void applyScene({ layers: withLayer(scene.layers, "banner", { kind: "banner", text }) })}
        onPredict={(preset) => {
          // A fresh object each time, so the same preset twice still opens the form.
          setMarketPreset({ ...preset });
          setPanel("games");
        }}
        onDismiss={marketSuggestions.dismiss}
      />
        </>
      )}

      <LayoutAndCards
        markets={marketsUp}
        phone={phoneConnected}
        scene={scene}
        battle={Boolean(battle)}
        guests={stageTiles.filter((t) => t.identity !== interpreterId)}
        cardNote={cardNote}
        onCardNote={setCardNote}
        onScene={(patch) => void applyScene(patch)}
      />

      <FeaturedPanel
        queue={featureQueue}
        onPutUp={(id) => void putUpSuggested(id)}
        onDismiss={(id) => void dismissSuggested(id)}
        featured={scene.featured ?? null}
        seconds={featureSeconds}
        giftsFrom={giftsFrom}
        carded={Boolean(scene.card)}
        onSeconds={(seconds) => {
          setFeatureSecondsPick(seconds);
          saveFeatureSettings({ featureSeconds: seconds });
        }}
        onGiftsFrom={(minor) => {
          setGiftsFromPick(minor);
          saveFeatureSettings({ featureGiftsFromMinor: minor });
        }}
        onTakeDown={() => void takeDownFeatured()}
      />

      <GoalPanel streamId={isLive ? streamId : null} goal={goal} onGoal={(g) => setGoal((cur) => newerGoal(cur, g))} />

      {/* Show rules run by themselves (Settings → Show rules); here's the way there. */}
      <Link
        href="/settings#rules"
        className="press flex items-center gap-3 rounded-[12px] bg-white/[0.04] px-3.5 py-3 transition-colors hover:bg-white/[0.07]"
      >
        <Lightning size={16} weight="fill" className="shrink-0 text-ember-hi" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold">Show rules</span>
          <span className="block text-[12px] leading-snug text-muted-foreground">
            A thank-you for big gifts, a sound for a battle won — they run by themselves.{deskOn ? "" : " Sounds need the audio desk on."}
          </span>
        </span>
        <CaretRight size={14} className="shrink-0 text-muted-foreground" />
      </Link>

      <SceneGraphicsPanel
        layers={scene.layers}
        brand={brand}
        // A market call is made on the live stream — never a practice run's, which the channel's record would keep.
        streamId={isLive && !practice ? streamId : null}
        hostName={user?.displayName || user?.username || ""}
        streamTitle={onAirTitle}
        people={liveGuests.map((g) => ({
          name: guestTiles.find((t) => t.identity === g.userId)?.name || g.username,
          username: g.username,
        }))}
        carded={Boolean(scene.card)}
        battle={Boolean(opponentStreamId)}
        sponsors={sponsorships.data ? { own: sponsorships.data.sponsors, campaigns: sponsorships.data.campaigns } : null}
        markets={marketsUp}
        onLayers={(layers) => void applyScene({ layers })}
        onBrand={saveBrand}
      />

      <CollapsibleSection id="live-sets" title="Sets" icon={Sparkle} summary={setsSummary}>
        {setsPanel}
      </CollapsibleSection>

      {/* Charts, prices and market calls: always here, up front only when they fit the stream. */}
      <div className="rounded-[12px] bg-tint/[0.04] px-3.5 py-3">
        <SwitchField
          label="Market tools"
          description={
            isMarketCategory(category)
              ? "On for this category: chart + face, the price strip and market calls."
              : "Chart + face, a price strip and market calls — for when your stream talks markets."
          }
          checked={marketTools || isMarketCategory(category)}
          disabled={isMarketCategory(category)}
          onCheckedChange={toggleMarketTools}
        />
      </div>
    </div>
  );

  const viewersPanel = (
    <div className="px-4 pt-3 pb-4">
      {connectedViewers.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-white/[0.06]">
            <UsersThree size={22} className="text-muted-foreground" />
          </span>
          <p className="mt-3 font-wide text-[16px] font-bold tracking-[-0.02em]">The room&apos;s warming up</p>
          <p className="mt-1 max-w-[30ch] text-[13px] leading-relaxed text-muted-foreground">Share the link — everyone who drops in shows up here.</p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className={cn(SETUP_LABEL, "mb-2")}>{connectedViewers.length} in the room</p>
          {connectedViewers.map((v) => (
            <div key={v.identity} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-white/[0.04]">
              <div className="flex size-8 items-center justify-center rounded-full bg-white/[0.06] text-xs font-medium text-foreground/80">{v.name.charAt(0).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground/85">{v.name}</p>
                <p className="text-[11px] text-muted-foreground/50">Joined {v.joinedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const statsPanel = (
    <div className="px-4 pb-4">
      {health.verdict && (
        <div className="pt-4">
          <HealthSection samples={health.samples} verdict={health.verdict} encoder={source === "obs" ? encoderHealth.reading : null} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 pt-4">
        <div className="col-span-2 rounded-[12px] bg-white/[0.04] p-4">
          <p className={SETUP_LABEL}>Watching now</p>
          <p className="mt-2.5 font-money text-[44px] leading-none tabular-nums">{viewerCount}</p>
        </div>
        <div className="rounded-[12px] bg-white/[0.04] p-4">
          <p className={SETUP_LABEL}>Peak</p>
          <p className="mt-2.5 font-money text-[26px] leading-none tabular-nums">{peakViewers}</p>
        </div>
        <div className="rounded-[12px] bg-white/[0.04] p-4">
          <p className={SETUP_LABEL}>On air</p>
          <p className="mt-2.5 font-money text-[26px] leading-none tabular-nums">{elapsed}</p>
        </div>
        <div className="col-span-2 rounded-[12px] bg-white/[0.04] p-4">
          <p className={SETUP_LABEL}>Gifts this stream</p>
          <p className="mt-2.5 font-money text-[32px] leading-none text-value tabular-nums">{tipsLabel}</p>
        </div>
      </div>
      {isLive && streamId && panel === "stats" && <LiveAudience streamId={streamId} />}
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground/70">Gifts land in your wallet as they arrive and play on the stage for everyone.</p>
    </div>
  );

  const morePanel = (
    <div className="flex flex-col gap-2.5 px-4 pt-4 pb-4">
      {practice ? (
        // A watch-only preview link for the rehearsal (practice-share.tsx).
        <PracticeShare streamId={isLive ? streamId : null} />
      ) : (
        <button onClick={shareStream} className="press flex h-11 items-center justify-center gap-2 rounded-full bg-white/[0.07] text-[14px] font-semibold text-foreground transition-colors hover:bg-white/[0.11]">
          {shareCopied ? <Check size={16} weight="bold" className="text-ember-hi" /> : <ShareNetwork size={16} />}
          {shareCopied ? "Link copied" : "Share the stream"}
        </button>
      )}
      {/* The watch page as a viewer gets it, muted (viewer-view.tsx). */}
      {isLive && streamId && <ViewerView streamId={streamId} practice={practice} />}
      {/* A screen beside the camera — when the screen is the stream, stopping it here would take the picture down. */}
      {source === "camera" && (
        <button onClick={toggleScreenShare} className={cn("press flex h-11 items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition-colors", screenShareActive ? "bg-white text-[#0b0708]" : "bg-white/[0.07] text-foreground hover:bg-white/[0.11]")}>
          <MonitorArrowUp size={16} />
          {screenShareActive ? "Stop sharing your screen" : "Share your screen"}
        </button>
      )}
      {source === "obs" && <div className="mt-1">{encoderBlock}</div>}
      {user?.username && (
        <div className="mt-1">
          <ConsoleLink username={user.username} />
        </div>
      )}
      <button onClick={() => setConfirmDialog("end")} className="press mt-2 flex h-11 items-center justify-center gap-2 rounded-full bg-chili/15 text-[14px] font-semibold text-chili-hi transition-colors hover:bg-chili/25">
        <Stop size={14} weight="fill" />
        End stream
      </button>
    </div>
  );

  const panelBody = (
    <>
      <div className={cn("min-h-0 flex-1", panel !== "stage" && "hidden")}>
        <div className="h-full overflow-y-auto">{stagePanel}</div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", panel !== "audio" && "hidden")}>
        <AudioDeskPanel
          desk={deskRef.current}
          on={deskOn}
          starting={deskStarting}
          encoder={source === "obs"}
          settings={deskSettings}
          onToggle={(on) => void (on ? startDesk() : stopDesk())}
          onSettings={(next) => {
            setDeskSettings(next);
            saveDeskSettings(next);
          }}
          moments={deskMoments}
          onMoments={setDeskMoments}
          guests={liveGuests}
          gains={scene.gains ?? {}}
          onGain={setGuestGain}
        />
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", panel !== "requests" && "hidden")}>
        <RequestsPanel
          queue={requestQueue}
          live={isLive}
          onScreenId={scene.featured?.kind === "request" ? scene.featured.id : null}
          onScene={takeScene}
        />
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", panel !== "scenes" && "hidden")}>{scenesPanel}</div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", panel !== "viewers" && "hidden")}>{viewersPanel}</div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", panel !== "stats" && "hidden")}>{statsPanel}</div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-4", panel !== "battle" && "hidden")}>
        {streamId && (
          <BattlePanel
            inline
            streamId={streamId}
            onBattle={setBattle}
            practice={practice}
            practiceNext={practiceNext}
            onPracticeNext={setPracticeNext}
            partner={liveGuests[0] ? { userId: liveGuests[0].userId, username: liveGuests[0].username, avatar: liveGuests[0].avatar } : null}
          />
        )}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-4", panel !== "games" && "hidden")}>
        {streamId && (
          <GamesPanel
            inline
            streamId={streamId}
            // What a market question offers first: the price strip, chat's tickers, the chart.
            markets={[...new Set([...priceStrip, ...tickers.map((t) => t.symbol), ...(scene.chart ? [scene.chart.symbol] : [])])]}
            marketPreset={marketPreset}
            marketsOn={marketsUp}
          />
        )}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", panel !== "more" && "hidden")}>{morePanel}</div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-5", panel !== "show" && "hidden")}>{runOfShow}</div>
    </>
  );

  /** A round control on the picture — the phone's camera column. */
  const roundButton = (props: { onClick?: () => void; label: string; active?: boolean; danger?: boolean; badge?: number; children: React.ReactNode }) => (
    // The column rides the right edge, so its tips open to the left.
    <Tip label={props.label} side="left">
      <button
        type="button"
        onClick={props.onClick}
        aria-label={props.label}
        className={cn(
          "press relative flex size-11 items-center justify-center rounded-full text-white",
          props.danger ? "bg-chili/30 text-chili-hi ring-1 ring-chili/40 hover:bg-chili/40" : props.active ? "obj-on" : "obj hover:text-white"
        )}
      >
        {props.children}
        {props.badge ? (
          <span className="absolute -top-0.5 -right-0.5 rounded-full bg-chili px-1.5 text-[10px] font-bold text-white tabular-nums">{props.badge}</span>
        ) : null}
      </button>
    </Tip>
  );

  /** A key in the live dock: white when it's on, chili when something you'd expect on is off. */
  const dockButton = (props: { onClick?: () => void; label: string; on?: boolean; off?: boolean; children: React.ReactNode }) => (
    <Tip label={props.label}>
      <button
        type="button"
        onClick={props.onClick}
        aria-label={props.label}
        className={cn(
          "press flex size-11 items-center justify-center rounded-full transition-colors",
          props.off ? "bg-chili text-white" : props.on ? "bg-white text-[#0b0708]" : "text-white hover:bg-white/[0.12]",
        )}
      >
        {props.children}
      </button>
    </Tip>
  );

  /**
   * Three rooms for one studio. Phones: the picture is the screen and the
   * room is a drawer. Tablets: the stage on top, the console under it — a
   * 380px column beside a 700px screen left the picture a sliver (owner,
   * 2026-09-24: "the studio in the tab view looks squashed"). Desktop: the
   * picture framed beside the console, never under it, so a broadcaster sees
   * every edge of their own shot.
   */
  const mode: "phone" | "stacked" | "side" = phone ? "phone" : stacked ? "stacked" : "side";
  /** Only a mouse gets the three-second hide; touch screens keep their controls. */
  const dockHidden = mode === "side" && !controlsVisible;

  return (
    <>
    <div
      ref={rootRef}
      // Minimized, the console is out of sight and out of the keyboard's way
      // while the broadcast carries on in the corner.
      inert={minimized}
      className={cn(
        "relative w-full overflow-hidden text-white",
        mode === "phone" ? "h-[100dvh] bg-black" : cn("bg-background", isLive ? "h-[100dvh]" : "h-[calc(100dvh-4rem)]"),
        minimized && "hidden"
      )}
    >
      {/* ---- The stage ---- */}
      <div
        className={cn(
          "absolute overflow-hidden bg-black [container-type:size]",
          mode === "phone" && "inset-0",
          // Setting up, the fields get the room; on air, the picture takes it back.
          mode === "stacked" && cn("inset-x-3 top-3 rounded-[20px] transition-[height] duration-500 ease-out", isLive ? "h-[56%]" : "h-[46%]"),
          mode === "side" && "top-4 right-[calc(340px+2rem)] bottom-4 left-4 rounded-[20px] xl:right-[calc(380px+2rem)]",
        )}
        onMouseMove={isLive ? showControls : undefined}
        onTouchStart={isLive ? showControls : undefined}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={pictureRef}
            className={cn(
              "relative overflow-hidden",
              // Contained, never cropped: a portrait broadcast fills a phone and
              // is pillarboxed elsewhere; a landscape one letterboxes to fit.
              orientation === "portrait"
                ? mode === "phone"
                  ? "size-full"
                  : "aspect-[9/16] h-[min(100cqh,calc(100cqw*16/9))]"
                : "aspect-video w-[min(100cqw,calc(100cqh*16/9))]",
            )}
          >
            {/* What viewers see, drawn by the same renderer: the layout, a
                shared screen with the camera in the corner, and any card. */}
            <SceneRenderer
              scene={scene}
              portrait={orientation === "portrait"}
              forceAuto={Boolean(opponentStreamId)}
              host={{ name: user?.displayName || user?.username || "You", avatar: user?.avatar }}
              mainLabel="You"
              main={
                <div className="relative size-full">
                  <video
                    ref={videoElRef}
                    autoPlay
                    muted
                    playsInline
                    className={cn(
                      "size-full",
                      localScreen || source === "screen" ? "object-contain" : "object-cover",
                      source === "camera" && facing === "user" && !localScreen && "-scale-x-100"
                    )}
                  />
                  {/* Privacy zones, drawn over the shared screen they cover. */}
                  {editingZones && shieldTrack && (
                    <PrivacyZonesEditor
                      zones={shield.zones}
                      onChange={(zones) => setShieldSettings({ zones })}
                      aspect={(() => {
                        const { width, height } = shieldTrack.mediaStreamTrack.getSettings();
                        return width && height ? width / height : 16 / 9;
                      })()}
                      onDone={() => setEditingZones(false)}
                    />
                  )}
                </div>
              }
              over={
                // The Set's gift effects round your face, as viewers see them — mirrored with a mirrored preview.
                <GiftEffects
                  set={activeSet}
                  anchors={cameraIsMain ? faceFeed : null}
                  fit={localScreen || source === "screen" ? "contain" : "cover"}
                  mirrored={source === "camera" && facing === "user" && !localScreen}
                  delayMs={80}
                  onReady={(handle) => {
                    effectsRef.current = handle;
                  }}
                />
              }
              pip={localScreen && videoTrackRef.current ? <StageTile fill self track={videoTrackRef.current} label="You" /> : undefined}
              // Your camera, for the corner when the phone takes your picture in Screen + face.
              face={source === "camera" && !localScreen && videoTrackRef.current ? <StageTile fill self track={videoTrackRef.current} label="You" /> : undefined}
              phone={phoneTile}
              guests={stageOthers}
              brand={shownBrand}
              goal={goal}
              heat={heat}
              // Full-bleed on a phone: graphics keep between the live row and the room's drawer.
              insets={
                mode === "phone" && orientation === "portrait"
                  ? { top: "calc(max(env(safe-area-inset-top), 12px) + 2.75rem)", bottom: "46dvh" }
                  : undefined
              }
            />
            {/* The Set's stinger between layouts, over the whole picture. */}
            <SetStinger set={activeSet} trigger={scene.layout} />
            {/* The chat on screen (host-only, never in the program): LiveChat draws its lane in here. */}
            {chatOnScreen.shows && (
              <div
                ref={chatOnScreen.targetRef}
                style={chatOnScreen.laneStyle}
                className={cn(
                  "pointer-events-none absolute z-20",
                  mode === "phone"
                    ? "bottom-0 left-3 h-[min(34dvh,17rem)] w-[min(18rem,calc(100%-5.5rem))]"
                    : "bottom-24 left-4 h-[min(40cqh,16rem)] w-[min(24rem,calc(100%-2rem))]",
                )}
              />
            )}
          </div>
        </div>

        {/* Pre-live idle stage: a lit set, not a black box. */}
        {idle && (
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-surface" />
            <BrandMark size={360} className="absolute -right-16 -bottom-20 opacity-[0.06]" />
            <div className={cn("absolute inset-0 flex items-center justify-center px-8 text-center", mode === "phone" && "pb-60")}>
              <div className="max-w-md">
                <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-white/[0.08]">
                  {source === "camera" ? (camIssue && camIssue !== "waiting" ? <VideoCameraSlash size={28} weight="fill" /> : <VideoCamera size={28} weight="fill" />) : source === "screen" ? <Monitor size={28} weight="fill" /> : <Broadcast size={28} weight="fill" />}
                </span>
                <p className="mt-5 font-wide text-[clamp(1.5rem,2.8vw,2.25rem)] leading-[1.05] font-bold tracking-[-0.035em] text-balance">
                  {source === "camera"
                    ? camIssue === "denied"
                      ? "Your camera is blocked"
                      : camIssue === "missing"
                        ? "No camera found"
                        : camIssue === "busy"
                          ? "Your camera is busy"
                          : "Setting up your camera"
                    : source === "screen"
                      ? "Your screen is the stage"
                      : "Stream from OBS or any encoder"}
                </p>
                <p className="mx-auto mt-3 max-w-[40ch] text-[14px] leading-relaxed text-white/60">
                  {source === "camera"
                    ? camIssue === "denied"
                      ? "The browser said no to the camera. Allow it for this site — the camera icon in the address bar — then turn it on here."
                      : camIssue === "missing"
                        ? "Plug a camera in and try again — or go live with your screen, from More."
                        : camIssue === "busy"
                          ? "Another app is using it. Close that app, then turn it on here."
                          : "Allow camera and microphone access when the browser asks. Your preview appears here."
                    : source === "screen"
                      ? "The share picker opens the moment you go live, so nothing is captured before you say so."
                      : "Your server URL and stream key are in More, under Source. Set them once in OBS or vMix — they never change."}
                </p>
                {source === "camera" &&
                  (camIssue && camIssue !== "waiting" ? (
                    <button
                      type="button"
                      onClick={() => void startPreview()}
                      className="press mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-inverse px-5 text-[14px] font-semibold text-on-inverse"
                    >
                      <VideoCamera size={16} weight="fill" />
                      {camIssue === "missing" ? "Try again" : "Turn on camera"}
                    </button>
                  ) : (
                    <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-[12px] font-medium text-white/80">
                      <span className="size-3 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                      Waiting for permission
                    </span>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* Live but the encoder hasn't connected yet */}
        {encoderWaiting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="px-6 text-center">
              <div className={cn("mx-auto mb-3 size-7 animate-spin rounded-full border-2", feedDropped ? "border-amber-400/20 border-t-amber-300" : "border-white/15 border-t-white/60")} />
              <p className={cn("text-sm font-medium", feedDropped ? "text-amber-200" : "text-white/60")}>{feedDropped ? "Encoder disconnected — reconnecting" : "Waiting for your encoder"}</p>
              <p className="mt-1 max-w-xs text-xs text-white/35">
                {feedDropped ? `Your stream stays live for ${Math.round(graceMs / 60_000)} minutes while OBS reconnects on the same key. Viewers have been told.` : "Start streaming in OBS or vMix with your key — the picture lands here."}
              </p>
            </div>
          </div>
        )}

        {/* Off the air for a moment: the connection is healing, or the
            studio is getting back in. The stream holds meanwhile. */}
        {isLive && source !== "obs" && (conn !== "live" || needsReshare) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
            <div className="max-w-sm px-6 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-ember/15 text-ember-hi">
                {needsReshare && conn === "live" ? <MonitorArrowUp size={24} /> : <CellSignalLow size={24} weight="fill" />}
              </span>
              <p className="mt-4 font-wide text-[19px] leading-tight font-bold tracking-[-0.02em] text-white">
                {needsReshare && conn === "live" ? "Share your screen again" : conn === "reconnecting" ? "Reconnecting…" : "Connection lost — getting you back"}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
                {needsReshare && conn === "live"
                  ? "You're back in the room, but the browser needs a click before it shares your screen again."
                  : conn === "reconnecting"
                    ? "Hang on — this usually takes a few seconds."
                    : `Your stream is on hold: viewers see “Be right back” for up to ${Math.round(graceMs / 60_000)} minutes while the studio reconnects. Nothing to do but keep this tab open.`}
              </p>
              {needsReshare && conn === "live" && (
                <button type="button" onClick={() => void reshareScreen()} className="press mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-semibold text-[#0b0708]">
                  <MonitorArrowUp size={16} />
                  Share screen
                </button>
              )}
            </div>
          </div>
        )}

        {/* 3·2·1 over the preview, between the tap and the air. */}
        <CountdownOverlay count={countdown.count} />

        {/* Scrims: the copy and controls sit on black, never on the picture. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
        {(isLive || mode === "phone") && <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent", mode === "phone" ? (isLive ? "h-64" : "h-80") : "h-36")} />}

        {/* Tip alerts — the on-air moment */}
        {tipAlerts.length > 0 && (
          <div
            className={cn(
              "pointer-events-none absolute z-30 flex items-start gap-2",
              // Clear of the run of show: under the segment chip, or — while
              // the prompter is up — down by the dock, off the script.
              prompterOn
                ? mode === "phone"
                  ? "bottom-[calc(46dvh+0.75rem)] left-3 flex-col-reverse"
                  : "bottom-24 left-4 flex-col-reverse"
                : mode === "phone" && isLive
                  ? // Under the details pill, and the segment chip when one's on air.
                    onAirSegment
                    ? "top-[calc(max(env(safe-area-inset-top),12px)+9.25rem)] left-3 flex-col"
                    : "top-[calc(max(env(safe-area-inset-top),12px)+6rem)] left-3 flex-col"
                  : onAirSegment && isLive
                    ? "top-28 left-4 flex-col"
                    : "top-[4.5rem] left-4 flex-col md:top-16"
            )}
          >
            {tipAlerts.map((t) => (
              <div key={t.id} className="flex animate-in items-center gap-2 rounded-full bg-black/80 py-1 pr-3.5 pl-1.5 slide-in-from-left-4">
                <GiftArt emoji={t.emoji} size={30} />
                <span className="max-w-[9rem] truncate text-xs font-semibold">{t.username}</span>
                <span className="flex items-center gap-0.5 text-xs font-bold text-yellow-300"><CurrencyDollar size={12} />{t.amountLabel.replace("$", "")}</span>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div role="alert" className="absolute top-[4.5rem] right-4 left-4 z-30 flex items-start gap-2 rounded-[12px] bg-chili px-4 py-3 text-[13.5px] font-semibold text-white shadow-[0_18px_40px_-18px_rgba(0,0,0,0.8)] md:right-auto md:max-w-md"><Warning size={16} className="mt-0.5 shrink-0" />{error}</div>
        )}

        {/* ---- Top row ---- */}
        <div className="absolute top-0 right-0 left-0 z-20 flex items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)] md:px-4 md:pt-4">
          {!isLive ? (
            <>
              <Link href="/explore" aria-label="Back" className="obj press flex size-11 items-center justify-center rounded-full text-white md:hidden"><CaretLeft size={20} weight="bold" /></Link>
              {/* The source (camera, screen, OBS) lives in More now: the screen is the camera and one button. */}
              <span className="flex-1" />
              {source === "camera" ? (
                roundButton({ onClick: flipCamera, label: "Flip camera", children: <CameraRotate size={22} /> })
              ) : (
                <span className="size-11 md:hidden" />
              )}
            </>
          ) : (
            <>
              {/* LIVE, the clock and the room in one capsule — the three numbers a host glances at. */}
              <span className="obj flex h-8 items-center overflow-hidden rounded-full">
                {practice ? (
                  // A rehearsal isn't on air: ember, and it says so.
                  <span className="flex h-full items-center gap-1.5 bg-ember px-2.5 text-[12px] font-bold tracking-[0.06em] text-on-ember" title="A practice run — nobody can find or join this room">
                    PRACTICE
                  </span>
                ) : (
                  <span className="flex h-full items-center gap-1.5 bg-chili px-2.5 text-[12px] font-bold tracking-[0.06em]">
                    <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex size-1.5 rounded-full bg-white" /></span>
                    LIVE
                  </span>
                )}
                <span className="px-2.5 font-mono text-[12px] font-semibold tabular-nums">{elapsed}</span>
                <Tip label="See who's watching" side="bottom">
                  <button type="button" onClick={() => openPanel("viewers")} aria-label={`${viewerCount} watching`} className="flex h-full items-center gap-1.5 pr-3 font-mono text-[12px] font-semibold tabular-nums transition-colors hover:text-white/80">
                    <Eye size={14} weight="bold" />
                    {viewerCount}
                  </button>
                </Tip>
              </span>
              {conn === "live" && health.verdict && <HealthChip verdict={health.verdict} onOpen={() => openPanel("stats")} />}
              {conn !== "live" && (
                <span className="obj flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-ember-hi">
                  <span className="size-1.5 animate-pulse rounded-full bg-ember" />
                  Reconnecting
                </span>
              )}
              {source === "obs" && (
                <span className="obj flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-white/85">
                  <span className={cn("size-1.5 rounded-full", obsFeedActive ? "bg-emerald-400" : "animate-pulse bg-ember")} />
                  {obsFeedActive ? "Encoder connected" : feedDropped ? "Reconnecting" : "Waiting for encoder"}
                </span>
              )}
              {mode === "phone" ? (
                <>
                  <BrandMark size={24} className="ml-auto drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]" />
                  <button type="button" onClick={() => setConfirmDialog("end")} className="obj press flex h-8 items-center gap-1.5 rounded-full pr-3.5 pl-2.5 text-[13px] font-semibold text-chili-hi hover:text-white">
                    <Stop size={14} weight="fill" />
                    End
                  </button>
                </>
              ) : (
                // The top bar steps aside while live, so the title and Vivid ride the stage instead.
                <div className="ml-auto flex min-w-0 items-center gap-2">
                  {/* The title, or an invitation to add one — a tap opens the details. */}
                  <DetailsPill title={title} category={category} onOpen={() => setDetailsOpen(true)} className="max-w-[36ch]" />
                  <VividLauncher variant="orb" />
                </div>
              )}
            </>
          )}
        </div>

        {/* Pre-live: camera status, under the source picker. */}
        {!isLive && source === "camera" && previewTrack && (
          <div className="absolute top-[calc(max(env(safe-area-inset-top),12px)+3.5rem)] left-3 z-20 flex gap-1.5 md:top-[4.5rem] md:left-4">
            <span className="obj flex h-7 items-center gap-2 rounded-full px-3 text-[11.5px] font-medium text-white/85">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Camera ready · {micEnabled ? "mic on" : "mic off"}
            </span>
          </div>
        )}

        {/* Run of show on the stage (host-only, never in the program): the
            segment on air with its clock and Next, and the prompter. */}
        {/* On a phone the stream's details pill leads this column; the segment chip sits under it. */}
        {isLive && (mode === "phone" || (onAirSegment && show.position)) && (
          <div
            className={cn(
              "absolute z-20",
              mode === "phone" ? "top-[calc(max(env(safe-area-inset-top),12px)+3.5rem)] left-3 flex max-w-[calc(100%-5rem)] flex-col items-start gap-2" : "top-16 left-4 max-w-[calc(100%-2rem)]"
            )}
          >
            {mode === "phone" && <DetailsPill title={title} category={category} onOpen={() => setDetailsOpen(true)} />}
            {onAirSegment && show.position && (
            <SegmentChip
              segment={onAirSegment}
              index={onAirIndex}
              count={segments.length}
              position={show.position}
              next={nextSegment}
              busy={segmentBusy}
              compact={mode === "phone"}
              onOpen={() => setPanel("show")}
              onNext={() => void goSegment(nextSegment).catch((err) => setError(err instanceof Error ? err.message : "Couldn't move the show on"))}
            />
            )}
          </div>
        )}
        {prompterOn && (
          <div
            className={cn(
              "pointer-events-none absolute z-20 flex justify-center",
              mode === "phone"
                ? cn(
                    "right-[4.25rem] left-3",
                    // Under the details pill (and the segment chip, when one's on air).
                    isLive && onAirSegment ? "top-[calc(max(env(safe-area-inset-top),12px)+9.25rem)]" : "top-[calc(max(env(safe-area-inset-top),12px)+6.25rem)]",
                    isLive ? "h-[36dvh]" : "h-[26dvh]"
                  )
                : "inset-x-4 top-28 h-[min(46cqh,420px)]"
            )}
          >
            <Teleprompter
              className="size-full max-w-[820px]"
              segment={prompterSegment}
              next={onAirSegment ? (nextSegment?.title ?? null) : null}
              compact={mode === "phone"}
              onClose={() => setPrompterOn(false)}
              onOpenRundown={() => (isLive ? setPanel("show") : setShowPlanner(true))}
            />
          </div>
        )}

        {/* ---- Tablet & desktop live: the dock — the camera's keys, the link, End ---- */}
        {isLive && mode !== "phone" && (
          <div className={cn("absolute inset-x-0 bottom-5 z-20 flex justify-center px-4 transition-[opacity,transform] duration-300", dockHidden && "pointer-events-none translate-y-2 opacity-0")}>
            <div className="obj flex items-center gap-1 rounded-full p-1.5">
              {source !== "obs" && dockButton({ onClick: toggleMic, label: micEnabled ? "Mute your mic" : "Unmute your mic", off: !micEnabled, children: micEnabled ? <Microphone size={21} /> : <MicrophoneSlash size={21} /> })}
              {source !== "obs" && dockButton({ onClick: () => setPanel(panel === "audio" ? "chat" : "audio"), label: panel === "audio" ? "Close the audio desk" : "Open the audio desk", on: panel === "audio", children: <Faders size={20} /> })}
              {source !== "obs" && dockButton({ onClick: toggleCam, label: camEnabled ? "Turn your camera off" : "Turn your camera on", off: !camEnabled, children: camEnabled ? <VideoCamera size={21} /> : <VideoCameraSlash size={21} /> })}
              {source === "camera" && dockButton({ onClick: flipCamera, label: "Flip camera", children: <CameraRotate size={21} /> })}
              {source === "camera" && dockButton({ onClick: toggleScreenShare, label: screenShareActive ? "Stop sharing your screen" : "Share your screen", on: screenShareActive, children: <MonitorArrowUp size={21} /> })}
              {source !== "obs" && <span aria-hidden className="mx-1 h-6 w-px bg-white/15" />}
              {vividOnAir && talkHold({})}
              {dockButton({ onClick: () => setPanel(panel === "show" ? "chat" : "show"), label: panel === "show" ? "Close the run of show" : "Open the run of show", on: panel === "show", children: <Playlist size={20} /> })}
              {dockButton({ onClick: () => setPrompterOn((on) => !on), label: prompterOn ? "Hide the teleprompter" : "Show the teleprompter", on: prompterOn, children: <ClapperboardText size={20} /> })}
              <span aria-hidden className="mx-1 h-6 w-px bg-white/15" />
              {dockButton({ onClick: shareStream, label: shareCopied ? "Link copied" : "Share the stream", on: shareCopied, children: shareCopied ? <Check size={19} weight="bold" /> : <ShareNetwork size={20} /> })}
              <button
                type="button"
                onClick={() => setConfirmDialog("end")}
                className="press ml-1 flex h-11 items-center gap-2 rounded-full bg-chili pr-5 pl-4 text-[14px] font-semibold text-white hover:brightness-110"
              >
                <Stop size={14} weight="fill" />
                End
              </button>
            </div>
          </div>
        )}

        {/* ---- Phone live: the camera's own controls ride the picture ---- */}
        {isLive && mode === "phone" && source !== "obs" && (
          <div className="absolute top-[calc(max(env(safe-area-inset-top),12px)+3.5rem)] right-3 z-20 flex flex-col items-center gap-2.5">
            {roundButton({ onClick: toggleMic, label: micEnabled ? "Mute your mic" : "Unmute your mic", danger: !micEnabled, children: micEnabled ? <Microphone size={22} /> : <MicrophoneSlash size={22} /> })}
            {roundButton({ onClick: () => setPanel(panel === "audio" ? "chat" : "audio"), label: panel === "audio" ? "Close the audio desk" : "Open the audio desk", active: panel === "audio", children: <Faders size={22} /> })}
            {roundButton({ onClick: toggleCam, label: camEnabled ? "Turn your camera off" : "Turn your camera on", danger: !camEnabled, children: camEnabled ? <VideoCamera size={22} /> : <VideoCameraSlash size={22} /> })}
            {/* Phones can't share a screen; a camera flips. */}
            {source === "camera" && roundButton({ onClick: flipCamera, label: "Flip camera", children: <CameraRotate size={22} /> })}
            {roundButton({ onClick: () => setPanel(panel === "show" ? "chat" : "show"), label: panel === "show" ? "Close the run of show" : "Open the run of show", active: panel === "show", children: <Playlist size={21} /> })}
            {roundButton({ onClick: () => setPrompterOn((on) => !on), label: prompterOn ? "Hide the teleprompter" : "Show the teleprompter", active: prompterOn, children: <ClapperboardText size={21} /> })}
            {vividOnAir && talkHold({ phone: true })}
          </div>
        )}

        {/* ---- Phone, pre-live: the camera and one big button. A title and
            a category if you like; everything else is behind More. ---- */}
        {mode === "phone" && !isLive && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
            {setupNotices && <div className="rounded-[14px] bg-surface text-foreground">{setupNotices}</div>}
            {!countdown.running && quickFields("picture")}
            {goLiveAction("picture")}
          </div>
        )}

        {/* On air elsewhere than a phone: the details card opens under its pill. */}
        {isLive && detailsOpen && mode !== "phone" && (
          <StreamDetailsSheet phone={false} title={title} category={category} onSave={saveDetails} onClose={() => setDetailsOpen(false)} />
        )}
      </div>

      {/* ---- Tablet & desktop: the console — setup before, the room during ---- */}
      {mode !== "phone" && (
        <aside
          aria-label={isLive ? "Your room" : "Stream setup"}
          // The category chooser opens over the console, not as a popover beside it.
          data-chooser-host
          className={cn(
            "absolute z-20 flex flex-col overflow-hidden rounded-[20px] bg-surface shadow-[inset_0_1px_0_rgba(255,236,230,0.06)]",
            mode === "side"
              ? "top-4 right-4 bottom-4 w-[340px] xl:w-[380px]"
              : cn("inset-x-3 bottom-3 transition-[top] duration-500 ease-out", isLive ? "top-[calc(56%+1.5rem)]" : "top-[calc(46%+1.5rem)]"),
          )}
        >
          {!isLive ? (
            <>
              {moreOpen ? (
                // More, as a panel in the console: every other option, and back.
                <Appear key="more" className="flex min-h-0 flex-1 flex-col">
                  <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-1">
                    <button
                      type="button"
                      onClick={() => setMoreOpen(false)}
                      aria-label="Back to going live"
                      className="press flex size-9 items-center justify-center rounded-full text-foreground hover:bg-tint/[0.06]"
                    >
                      <CaretLeft size={18} weight="bold" />
                    </button>
                    <h2 className="font-wide text-[17px] font-bold tracking-[-0.02em]">More</h2>
                  </div>
                  <div className="@container min-h-0 flex-1 overflow-y-auto p-5 pt-3 pb-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">{moreSections}</div>
                </Appear>
              ) : (
                <div className="@container min-h-0 flex-1 overflow-y-auto p-5 pb-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                  {setupHeader}
                  <div className="mt-5 flex flex-col gap-3">
                    {setupNotices}
                    {quickFields("panel")}
                    {moreButton("row")}
                  </div>
                </div>
              )}
              {/* Pinned: the button never scrolls away. */}
              <div className="shrink-0 shadow-[inset_0_1px_0_var(--hairline-color)]">{goLiveAction("console")}</div>
            </>
          ) : (
            <>
              {roomHeader}
              {/* Live from a computer with no phone in: a phone as a second camera, suggested once. */}
              <SecondCameraTip
                streamId={streamId}
                eligible={isLive && !practice && source !== "obs" && !cameraTurnsWithDevice()}
                phoneConnected={phoneConnected}
                onUse={() => {
                  setPanel("stage");
                  openSection("live-second-camera");
                  setPhoneAsk((n) => n + 1);
                }}
              />
              <div className={cn("min-h-0 flex-1", panel !== "chat" && "hidden")}>
                {streamId && (
                  <LiveChat
                    streamId={streamId}
                    room={liveRoom}
                    isLive={isLive}
                    isHost
                    hostUsername={user?.username}
                    featured={scene.featured ?? null}
                    featureSeconds={featureSeconds}
                    onScene={takeScene}
                    onFeatureQueue={(q) => setFeatureQueue(readFeatureQueue(q))}
                    lane={chatOnScreen.lane}
                    onScreen={{ on: chatOnScreen.on, onChange: chatOnScreen.setOn }}
                  />
                )}
              </div>
              {panelBody}
            </>
          )}
        </aside>
      )}

      {/* ---- Phone live: the room, in a drawer. Chat, stage, gifts, battle,
          games and more are its tabs; fold it to the thumb for a clean
          picture, pull it up when the room needs you. ---- */}
      {isLive && streamId && mode === "phone" && (
        <DragSheet label="Your room" collapsible detents={[0.46, 0.84]} defaultDetent={0} {...chatOnScreen.sheet} header={<div className="pb-1">{roomHeader}</div>}>
          {/* Compact (the chat on screen), this hugs the composer and the sheet hugs it. */}
          <div className={cn(!chatOnScreen.compact && "h-full", panel !== "chat" && "hidden")}>
            <LiveChat
              streamId={streamId}
              room={liveRoom}
              isLive={isLive}
              isHost
              hostUsername={user?.username}
              variant="sheet"
              featured={scene.featured ?? null}
              featureSeconds={featureSeconds}
              onScene={takeScene}
              onFeatureQueue={(q) => setFeatureQueue(readFeatureQueue(q))}
              lane={chatOnScreen.lane}
              compact={chatOnScreen.compact}
              onScreen={{ on: chatOnScreen.on, onChange: chatOnScreen.setOn }}
            />
          </div>
          {panel !== "chat" && <div className="flex h-full flex-col">{panelBody}</div>}
        </DragSheet>
      )}

      {/* ---- Phones: More, pre-live — every other setup option, in a sheet ---- */}
      {mode === "phone" && !isLive && moreOpen && (
        <>
          <button type="button" aria-label="Close More" onClick={() => setMoreOpen(false)} className="animate-fade-in absolute inset-0 z-[35] bg-black/50" />
          <DragSheet
            label="More"
            detents={[0.62, 0.9]}
            defaultDetent={0}
            onDismiss={() => setMoreOpen(false)}
            className="animate-sheet-up z-40"
            header={
              <div className="flex items-center justify-between px-4 pb-3">
                <h2 className="font-wide text-[18px] font-bold tracking-[-0.02em]">More</h2>
                <button type="button" onClick={() => setMoreOpen(false)} className="press h-9 rounded-full bg-tint/[0.08] px-4 text-[13px] font-semibold text-foreground">
                  Done
                </button>
              </div>
            }
          >
            <div className="px-4 pb-[max(env(safe-area-inset-bottom),20px)]">{moreSections}</div>
          </DragSheet>
        </>
      )}

      {/* ---- Phones, on air: the details sheet, over the room's drawer ---- */}
      {isLive && detailsOpen && mode === "phone" && (
        <StreamDetailsSheet phone title={title} category={category} onSave={saveDetails} onClose={() => setDetailsOpen(false)} />
      )}

      {/* Ending asks first. Going live doesn't: its 3·2·1 is the moment to change your mind. */}
      {confirmDialog === "end" && (
        <div className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/70 md:items-center">
          <div className="animate-sheet-up w-full rounded-t-[20px] bg-popover p-6 pb-[max(env(safe-area-inset-bottom),24px)] text-center shadow-[inset_0_1px_0_rgba(255,236,230,0.06)] md:animate-pop-in md:mx-4 md:max-w-sm md:rounded-[20px] md:pb-6">
            {/* Ending is a quieter chili. */}
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-chili/15">
              <Warning size={22} className="text-chili-hi" />
            </div>
            <h2 className="font-wide text-[20px] font-bold tracking-[-0.02em]">{practice ? "End the practice run?" : "End the stream?"}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              {practice
                ? "The rehearsal ends and can't be resumed. Nothing was recorded or announced."
                : `Your stream will end for all ${viewerCount} viewer${viewerCount !== 1 ? "s" : ""} and can't be resumed.`}
            </p>
            <div className="mt-6 flex gap-2">
              <button onClick={() => setConfirmDialog(null)} className="press h-11 flex-1 rounded-full bg-control text-sm font-semibold text-foreground transition-colors hover:bg-control-hover">Keep going</button>
              <button
                onClick={() => {
                  setConfirmDialog(null);
                  void endStream();
                }}
                className="press h-11 flex-1 rounded-full bg-white text-sm font-semibold text-[#0b0708] transition-[filter,background-color] hover:bg-white/90"
              >
                {practice ? "End practice" : "End stream"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    {minimized && isLive && (
      <MiniLive
        getTrack={() => localScreen ?? videoTrackRef.current}
        trackKey={`${source}|${localScreen ? "screen" : "main"}|${camEnabled}|${conn}`}
        getOrigin={() => pictureRectRef.current}
        onPlaced={(rect) => {
          miniRectRef.current = rect;
        }}
        mirrored={source === "camera" && facing === "user" && !localScreen}
        portrait={orientation === "portrait"}
        source={source}
        elapsed={elapsed}
        viewers={viewerCount}
        conn={conn}
        micOn={micEnabled}
        camOn={camEnabled}
        host={{ name: user?.displayName || user?.username || "You", avatar: user?.avatar }}
        tip={tipAlerts[tipAlerts.length - 1] ?? null}
        onToggleMic={() => void toggleMic()}
        onToggleCam={() => void toggleCam()}
        onReconnect={reconnectNow}
        onEnd={() => void endStream()}
      />
    )}
    </>
  );
}
