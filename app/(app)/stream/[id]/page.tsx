"use client";

import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import { registerVividContext } from "@/lib/vivid/page-context";
import {
  Eye,
  Heart,
  ShareNetwork,
  Flag,
  Clock,
  CornersOut,
  Crown,
  Microphone,
  MicrophoneSlash,
  SignOut,
  SpeakerHigh,
  SpeakerSlash,
  UsersThree,
  X,
  PictureInPicture,
  Sidebar,
  CellSignalLow,
  ChatCircleDots,
  VideoCamera,
  HandWaving,
  Check,
  Info,
  Ticket,
} from "@/components/icons";
import { Empty } from "@/components/app/empty";
import { MessageButton } from "@/components/app/message-button";
import { streamContext } from "@/lib/messaging";
import { Pill, PillLink } from "@/components/ui/pill";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { centsToDollars } from "@/lib/gifts";
import { IconButton } from "@/components/ui/icon-button";
import { Tip } from "@/components/ui/tip";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/feedback";
import { signInHref } from "@/lib/auth-urls";
import { BattleBar } from "@/components/app/battle-bar";
import { BattleResultSheet } from "@/components/app/battle-result-card";
import { GiftEffects, type GiftEffectsHandle } from "@/components/app/gift-effects";
import { SetStinger } from "@/components/app/set-stinger";
import { anchorsListener, useAnchorFeed } from "@/lib/face-anchors";
import { brandWithSet, setById } from "@/lib/sets";
import { LivePreview, PreviewVideo, hostTrackOf, useRoomPreview } from "@/components/app/live-preview";
import { isBattleActive, sideOf, type BattleView } from "@/lib/battles";
import { useShareBattleGifts } from "@/lib/battle-gifts";
import { PlayPanel } from "@/components/app/play-panel";
import { ScheduleList } from "@/components/app/supporters-strip";
import { CalendarBlank } from "@/components/icons";
import type { GameView } from "@/lib/games";
import Link from "next/link";
import { LiveChat, type PinnedMessage } from "@/components/app/live-chat";
import { Shelf } from "@/components/app/shelf";
import { StreamCard } from "@/components/app/stream-card";
import { apiFetch as discoveryFetch } from "@/lib/api-client";
import { toCard, type RowItem } from "@/lib/discovery";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatNumber, type Category } from "@/lib/categories";
import { SceneRenderer, type SceneCell } from "@/components/app/scene-renderer";
import { newerGoal, newerHeat, readGoal, readHeat, type StreamGoal, type StreamHeat } from "@/lib/goals";
import type { TopFan } from "@/components/app/chat/chat-lines";
import { readFan, type FanStanding } from "@/components/app/chat/lines";
import { DEFAULT_SCENE, gainFor, layerOf, newerScene, readBrand, readScene, sceneFromMetadata, type Scene } from "@/lib/scene";
import { AnglePicker } from "@/components/app/angle-picker";
import { isCameraIdentity, placePhone, setAnglePick, tilesBeside, useAnglePick, viewPhone, type PhoneView } from "@/lib/angles";
import { useRestrictedRegion, useSponsoredQuest } from "@/lib/sponsors";
import { SponsorPanel } from "@/components/app/sponsor-panel";
import { cn } from "@/lib/utils";
import { use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, apiUrl, ApiError } from "@/lib/api-client";
import type { Room, DisconnectReason as DisconnectReasonType } from "livekit-client";
import { VideoQuality } from "livekit-client";
import { setDataMode, useDataMode, type PictureMode } from "@/lib/data-mode";
import { PictureIcon, PictureMenu, RadioCard } from "@/components/app/picture-menu";
import {
  GiftOverlay,
  type GiftOverlayHandle,
} from "@/components/app/gift-overlay";
import {
  AwayTile,
  StageTile,
  type AttachableVideoTrack,
} from "@/components/app/stage-tile";
import { BackstagePanel } from "@/components/app/backstage-panel";
import {
  FloatingHearts,
  type FloatingHeartsHandle,
} from "@/components/app/floating-hearts";
import { readStageLine } from "@/components/app/stage-line";
import { PracticeBadge, PreviewBanner, PreviewGone, usePreviewMode } from "@/components/app/practice-preview";
import { useViewerView } from "@/lib/viewer-view";

/** How sharp a camera comes in, in LiveKit's words: the angle says which tile gets which. */
const QUALITY = { high: VideoQuality.HIGH, medium: VideoQuality.MEDIUM, low: VideoQuality.LOW } as const;

/** Who's watching: everyone in the room but the feeds and the crew's own surfaces (the encoder, a monitor, a console, the phone cam). */
function audienceOf(room: { remoteParticipants: Map<string, { identity: string }> }) {
  let n = 0;
  room.remoteParticipants.forEach((p) => {
    if (!/^(obs|mon|prod|cam)-/.test(p.identity)) n += 1;
  });
  return n;
}

const REPORT_REASONS: Array<{ value: string; label: string }> = [
  { value: "spam", label: "Spam or misleading" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "violence", label: "Violence or dangerous acts" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "scam_or_fraud", label: "Scam or fraud" },
  { value: "copyright", label: "Copyright violation" },
  { value: "other", label: "Other" },
];

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";
/** Section titles under the player — the same voice as the shelves below them. */
const SECTION_TITLE =
  "mb-3.5 flex min-w-0 items-center gap-2.5 font-wide text-[17px] font-bold tracking-[-0.02em] text-foreground md:text-[19px]";

/** A round control on the picture: the black object, white while it's on. */
function playerButton(on = false) {
  return cn(
    "press flex size-10 items-center justify-center rounded-full transition-colors",
    on ? "obj-on" : "obj text-white/85 hover:text-white"
  );
}

/** "2:09:14" → "2h 09m"; "41:07" → "41m" — how long a stream ran. */
function runTime(duration: string) {
  const parts = duration.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 3) return parts[0] > 0 ? `${parts[0]}h ${String(parts[1]).padStart(2, "0")}m` : `${parts[1]}m`;
  if (parts.length === 2) return parts[0] > 0 ? `${parts[0]}m` : null;
  return null;
}

/**
 * One round button in the phone view's action column, its word under it —
 * the same object the live feed's column uses. Chili for the stage's
 * warnings (a muted mic, leaving), Ember while a request is waiting.
 */
/** Said while the host's AI assistant speaks, in case its voice is on air. */
function AiVoiceBadge() {
  return (
    <span
      title="The host's AI assistant is speaking"
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-black/55 px-2.5 text-xs font-semibold text-white motion-safe:animate-[fade-in_200ms_ease-out_both]"
    >
      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-white/80" />
      AI voice
    </span>
  );
}

function RailButton({
  icon,
  label,
  title,
  onClick,
  disabled,
  tone = "obj",
  pulse = false,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "obj" | "chili" | "ember";
  pulse?: boolean;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      title={title}
      className="press flex flex-col items-center gap-1 disabled:opacity-50"
    >
      <span
        className={cn(
          "relative flex size-12 items-center justify-center rounded-full transition-colors",
          tone === "obj" && "obj text-white",
          tone === "chili" && "bg-chili text-white",
          tone === "ember" && "bg-ember text-on-ember",
          pulse && "animate-pulse"
        )}
      >
        {icon}
        {badge ? (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-chili px-1 text-[10px] font-bold text-white tabular-nums ring-2 ring-black">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-[11px] font-semibold text-white/85 tabular-nums [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]">
        {label}
      </span>
    </button>
  );
}

interface StreamData {
  _id: string;
  title: string;
  category: Category;
  tags: string[];
  isLive: boolean;
  /** Current concurrent viewers — 0 once a stream has ended. */
  viewers: number;
  peakViewers?: number;
  likes?: number;
  duration: string;
  startedAt: string;
  livekitRoomName: string;
  pinnedMessage?: PinnedMessage | null;
  /** Set while the host's feed has dropped and the stream is holding for it. */
  feedDroppedAt?: string | null;
  /** How the program is laid out: layout and card (see lib/scene.ts). */
  scene?: Scene;
  /** The goal bar and the heat meter, as the API last had them (lib/goals.ts reads them). */
  goal?: unknown;
  heat?: unknown;
  streamerId: {
    _id: string;
    username: string;
    displayName: string;
    avatar: string;
    bio?: string;
    followers: number;
    isLive: boolean;
    /** The brand kit the graphics wear — the logo as a version, never its bytes. */
    brand?: { accent?: string; lowerThird?: string; logoVersion?: number; logoUrl?: string | null; set?: string | null };
    /** Whether the request line is open ("off" hides Join; the API holds the rest of the rules). */
    settings?: { stageRequests?: string };
  };
}

export default function StreamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, isLoading: authLoading } = useAuth();
  // A practice run's preview link (?preview=): watch-only, with a banner.
  const preview = usePreviewMode();
  // The host's own "See what viewers see" frame (?as=viewer): a viewer's page, sound locked off.
  const viewerView = useViewerView();
  const router = useRouter();
  const [stream, setStream] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Taken down by the platform after a report — on load (410) or while watching. */
  const [removed, setRemoved] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  /** Why the last follow/unfollow was refused, shown next to the button. */
  const [followError, setFollowError] = useState<string | null>(null);
  /** Bumped on each new ally so the ring burst replays; 0 = never shown. */
  const [allyBurst, setAllyBurst] = useState(0);
  /** Share fell back to the clipboard — say so for a moment. */
  const [copied, setCopied] = useState(false);
  /** Phones: the top gifters list, opened from their faces in the top bar. */
  const [showGifters, setShowGifters] = useState(false);
  const [elapsed, setElapsed] = useState("0:00");
  // The sponsor on screen, if this viewer may see it — crypto, betting and
  // alcohol promotions stay off screens in Nigeria unless cleared — and,
  // for an Xtream campaign, its sponsored quest.
  const restrictedRegion = useRestrictedRegion();
  const sponsorOnAir = layerOf(stream?.scene?.layers ?? [], "sponsor") ?? null;
  const sponsorShown = sponsorOnAir && !(sponsorOnAir.restricted && restrictedRegion !== false) ? sponsorOnAir : null;
  const sponsoredQuest = useSponsoredQuest(sponsorShown?.source === "campaign" ? sponsorShown.sponsorId : null, Boolean(user));
  /** Phones: the sponsored quest's sheet, from its chip under the header. */
  const [showQuest, setShowQuest] = useState(false);

  // LiveKit
  const roomRef = useRef<Room | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  // Joined-the-room and actually-receiving-video are different things: an
  // OBS stream is flagged live the moment the key is issued, long before the
  // encoder pushes. Track them apart so the player can say which it is.
  const [hasVideo, setHasVideo] = useState(false);
  /** The host's AI assistant is speaking (and may be heard on air). */
  const [aiVoice, setAiVoice] = useState(false);
  const aiVoiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** How long the stream holds for a dropped feed — from the API's "feed" event. */
  const [graceMs, setGraceMs] = useState(300_000);
  /** Bumped to rejoin the room after this viewer's own connection gave out. */
  const [rejoinNonce, setRejoinNonce] = useState(0);
  /** Getting this viewer back into the room after their connection dropped. */
  const [rejoining, setRejoining] = useState(false);
  /** The same account opened this stream in another tab, which took over. */
  const [playingElsewhere, setPlayingElsewhere] = useState(false);
  /**
   * Bumped every time the host's video track object is replaced.
   *
   * A publisher restarting video (camera toggle, track republish, the
   * socials app resubscribing) delivers a NEW track while `hasVideo` stays
   * true — so an effect keyed only on `hasVideo` never re-runs and the
   * element keeps rendering the old track, which goes muted the moment it
   * is replaced. That is exactly how a live host renders as a black cell.
   */
  const [hostTrackEpoch, setHostTrackEpoch] = useState(0);
  const videoTrackRef = useRef<AttachableVideoTrack | null>(null);
  /**
   * The host's two possible pictures. A shared screen takes the main
   * picture, with the camera in the corner (the scene decides the rest);
   * `videoTrackRef` is whichever of them is the main one.
   */
  const hostCameraRef = useRef<AttachableVideoTrack | null>(null);
  const hostScreenRef = useRef<AttachableVideoTrack | null>(null);
  const [hostFeeds, setHostFeeds] = useState({ camera: false, screen: false });
  /**
   * Concurrent watchers, derived from the room roster.
   *
   * `remoteParticipants` is everyone *except* me — i.e. the broadcaster plus
   * the other viewers. Swapping the broadcaster out for myself leaves the
   * count unchanged, so `remoteParticipants.size` *is* the watcher count.
   * It previously rendered as `viewerCount + 1`, which counted the
   * broadcaster as a viewer and read one higher than both the studio and the
   * server-side count (`participants - 1`, see the LiveKit webhook).
   */
  const [viewerCount, setViewerCount] = useState(0);
  const elapsedInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  /** Set when joining the room fails, so the player doesn't just sit black. */
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // ---- Audio ----
  // Playback starts muted: browsers block un-muted autoplay without a fresh
  // user gesture, and the old behaviour (attach + hope) meant viewers landing
  // from a shared link got video with silent audio and no control to fix it.
  // Muted-start plus an explicit "tap to unmute" is the Twitch/YouTube answer.
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const mutedRef = useRef(true);
  const volumeRef = useRef(1);
  /** Every attached remote audio element, keyed by its track object. */
  const audioElsRef = useRef<Map<object, HTMLAudioElement>>(new Map());
  /** The host's guest faders (the scene's gains): each guest plays at the player's volume times theirs. */
  const gainsRef = useRef<Record<string, number>>({});

  // ---- Stage (guests broadcasting alongside the host) ----
  /**
   * Where I am with the stage: asked, waiting backstage (publishing, seen
   * by the host and their producers only), or on it.
   */
  type StageState = "idle" | "requested" | "backstage" | "live";
  const [stageState, setStageState] = useState<StageState>("idle");
  const stageStateRef = useRef<StageState>("idle");
  stageStateRef.current = stageState;
  /**
   * Where the API last told me to be. The camera takes a moment to start,
   * and "backstage" then "approved" can land inside that moment — so the
   * publish reads its destination when it finishes, not when it began.
   */
  const stageTargetRef = useRef<"idle" | "backstage" | "live">("idle");
  const [stageBusy, setStageBusy] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [stageMicOn, setStageMicOn] = useState(true);
  /** My own published camera track while on stage or backstage. */
  const [localStageTrack, setLocalStageTrack] =
    useState<AttachableVideoTrack | null>(null);
  /** My own mic, for the backstage meter. */
  const [localStageAudio, setLocalStageAudio] = useState<MediaStreamTrack | null>(null);
  /** Backstage: the panel is up (a sheet on phones); the rail button brings it back. */
  const [backstageOpen, setBackstageOpen] = useState(true);
  /** Remote guests currently publishing video (host excluded). */
  const [guestVideos, setGuestVideos] = useState<
    Array<{ identity: string; name: string }>
  >([]);
  const guestTracksRef = useRef<Map<string, AttachableVideoTrack>>(new Map());
  /**
   * Who's backstage, by room identity. They publish like any guest, but
   * their tracks are for the host and the producers: this page never
   * subscribes to them, so viewers neither see nor hear them. The ref is
   * for the room's callbacks; the state re-renders the stage.
   */
  const backstageIdsRef = useRef<Set<string>>(new Set());
  const [backstageIds, setBackstageIds] = useState<Set<string>>(() => new Set());
  // The host's phone cam (cam-<id>): on offer while it's publishing, and its
  // track while this viewer takes it. What's shown, and how sharp each
  // camera comes in, is the host's angle under this viewer's own pick.
  const phoneCameraRef = useRef<AttachableVideoTrack | null>(null);
  const [phoneAvailable, setPhoneAvailable] = useState(false);
  // A battle's result card, open: held here so it outlives the scoreboard,
  // which lets an ended battle go a couple of minutes after the clock.
  const [shareBattle, setShareBattle] = useState<BattleView | null>(null);
  // The phone's track comes and goes: a re-render of its own, never the host's element re-attached.
  const [, setPhoneEpoch] = useState(0);
  const anglePick = useAnglePick(id);
  // Where the phone sits on this screen — the host's placement, or this
  // viewer's pin over it — and how sharp each feed comes in.
  const resolved = viewPhone(
    { layout: (stream?.scene ?? DEFAULT_SCENE).layout, phoneSlot: (stream?.scene ?? DEFAULT_SCENE).phoneSlot ?? "off" },
    anglePick,
    phoneAvailable
  );
  const resolvedRef = useRef<PhoneView>(resolved);
  resolvedRef.current = resolved;
  const streamerIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  /** Latest publish/stop functions, reachable from LiveKit callbacks. */
  const publishAsGuestRef = useRef<() => void>(() => {});
  const stopStagePublishRef = useRef<() => void>(() => {});

  // ---- Gifts ----
  const giftOverlayRef = useRef<GiftOverlayHandle | null>(null);
  // The Set's gift effects round the host's face: anchors from the host's
  // studio (topic "anchors", theirs alone), drawn over their picture here.
  const anchorFeed = useAnchorFeed();
  const takeAnchors = useMemo(() => anchorsListener(anchorFeed, () => streamerIdRef.current), [anchorFeed]);
  const effectsRef = useRef<GiftEffectsHandle | null>(null);
  const handleGiftOverlayReady = useCallback(
    (handle: GiftOverlayHandle) => {
      giftOverlayRef.current = handle;
    },
    []
  );
  const [topGifters, setTopGifters] = useState<
    Array<{
      userId?: string;
      username: string;
      displayName?: string;
      avatar: string;
      totalUsdMinor: number;
    }>
  >([]);

  // ---- Player extras ----
  /** Theater mode hides the chat column so the video takes the width. */
  const [theaterMode, setTheaterMode] = useState(false);
  /**
   * Where chat lives: beside the player (the default) or beneath it, for
   * wide screens and quiet rooms where a tall side column is mostly empty.
   */
  const [chatPlacement, setChatPlacement] = useState<"side" | "below">("side");
  /** About · Also live · Schedule beneath the player. */
  const [alsoLive, setAlsoLive] = useState<RowItem[]>([]);
  const [hostUpcoming, setHostUpcoming] = useState<RowItem[]>([]);
  /** My downlink quality, from LiveKit — only surfaced when it's bad. */
  const [connQuality, setConnQuality] = useState<string | null>(null);

  // ---- Watch next (stream ended) ----
  const [watchNext, setWatchNext] = useState<
    Array<{
      _id: string;
      title: string;
      category: string;
      viewers: number;
      thumbnailUrl?: string | null;
      streamerName: string;
      streamerAvatar?: string;
    }>
  >([]);
  const [watchNextLoaded, setWatchNextLoaded] = useState(false);

  // ---- Mobile immersive view ----
  /** Below lg the page becomes a TikTok-style full-screen live view. */
  const [isMobileView, setIsMobileView] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobileView(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /**
   * Screen orientation, watched separately from the breakpoint: rotating
   * the phone flips the stage from stacked rows to side-by-side columns.
   */
  const [portraitScreen, setPortraitScreen] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const apply = () => setPortraitScreen(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /** Portrait feeds fill the phone screen; landscape ones letterbox. */
  const [feedPortrait, setFeedPortrait] = useState(true);
  useEffect(() => {
    const el = videoElRef.current;
    if (!el || !hasVideo) return;
    const measure = () => {
      if (el.videoWidth && el.videoHeight) {
        setFeedPortrait(el.videoHeight >= el.videoWidth);
      }
    };
    measure();
    el.addEventListener("resize", measure);
    el.addEventListener("loadedmetadata", measure);
    return () => {
      el.removeEventListener("resize", measure);
      el.removeEventListener("loadedmetadata", measure);
    };
  }, [hasVideo, isMobileView]);

  const heartsRef = useRef<FloatingHeartsHandle | null>(null);
  const handleHeartsReady = useCallback((h: FloatingHeartsHandle) => {
    heartsRef.current = h;
  }, []);

  // ---- Host-on-mobile: the owner watching their own stream manages the
  // stage from here (their broadcast usually runs on their phone app). ----
  const isOwner = Boolean(
    user && stream && String(stream.streamerId._id) === user.id
  );
  const isOwnerRef = useRef(false);
  isOwnerRef.current = isOwner;
  const [hostRequests, setHostRequests] = useState<
    Array<{ userId: string; username: string; avatar: string }>
  >([]);
  const [hostLiveGuests, setHostLiveGuests] = useState<
    Array<{ userId: string; username: string; avatar: string }>
  >([]);
  /** Owner: who's waiting backstage — accepted, publishing, not on the picture yet. */
  const [hostBackstageGuests, setHostBackstageGuests] = useState<
    Array<{ userId: string; username: string; avatar: string }>
  >([]);
  const [showStageSheet, setShowStageSheet] = useState(false);
  const [hostStageBusy, setHostStageBusy] = useState<string | null>(null);

  // ---- Co-live ----
  /** Set when this stream merges into another — brief notice, then follow. */
  const [mergingInto, setMergingInto] = useState<string | null>(null);
  /**
   * ?stage=1: I arrived holding a live stage slot (co-live accept, or a
   * reconnect) — claim publish rights and start the camera instead of
   * tidying the slot away.
   */
  const wantStageRef = useRef(false);
  useEffect(() => {
    wantStageRef.current =
      new URLSearchParams(window.location.search).get("stage") === "1";
  }, []);
  const [claimPending, setClaimPending] = useState(false);

  // Like & share state
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // In fullscreen the chat is a proper rail beside the video — inside the
  // fullscreened element, since nothing outside it is visible — not a
  // floating overlay. On by default; the viewer can fold it away.
  const [fsChat, setFsChat] = useState(true);
  // The battle this stream is in (or just finished). Server-fed: room
  // events carry every change, a slow poll covers a dropped frame.
  const [battle, setBattle] = useState<BattleView | null>(null);
  // Which gifts count in it, for the gift picker to mark.
  useShareBattleGifts(battle);
  // The prediction running in this stream, if any — same feed: room events
  // plus a slow poll.
  const [game, setGame] = useState<GameView | null>(null);
  // The goal bar and the heat meter: room events move them the moment a
  // gift lands, the stream's poll covers a dropped frame. They belong to
  // this stream — another one starts them afresh.
  const [goal, setGoal] = useState<StreamGoal | null>(null);
  const [heat, setHeat] = useState<StreamHeat | null>(null);
  const [goalsFor, setGoalsFor] = useState(id);
  if (goalsFor !== id) {
    setGoalsFor(id);
    setGoal(null);
    setHeat(null);
  }
  // How much picture to take: the viewer's data setting (it stays with
  // them), or Radio — the sound without the picture — for this stream only.
  const dataMode = useDataMode();
  const [radio, setRadio] = useState(false);
  const [showPicture, setShowPicture] = useState(false);
  const pictureMode: PictureMode = radio ? "radio" : dataMode;
  const pictureModeRef = useRef<PictureMode>(pictureMode);
  useEffect(() => {
    pictureModeRef.current = pictureMode;
  }, [pictureMode]);
  // A 2v2's other pair: their host and partner over one connection to their
  // room, a tile each. (A 1v1's other side is one LivePreview.)
  const pairOpponent =
    battle && isBattleActive(battle) && battle.mode === "2v2" ? (sideOf(battle, id) === "host" ? battle.challenger : battle.host) : null;
  const pairTracks = useRoomPreview(pairOpponent?.streamId ?? null, !radio);
  // The host's guest faders: every guest plays at the level the scene carries.
  const sceneGains = stream?.scene?.gains;
  useEffect(() => {
    gainsRef.current = sceneGains ?? {};
    audioElsRef.current.forEach((el) => {
      el.volume = volumeRef.current * gainFor(gainsRef.current, el.dataset.identity);
    });
  }, [sceneGains]);
  const pickPicture = (mode: PictureMode) => {
    setShowPicture(false);
    if (mode === "radio") {
      setRadio(true);
      return;
    }
    setRadio(false);
    setDataMode(mode);
  };
  // Every video in the room follows the setting as it changes.
  useEffect(() => {
    const room = roomRef.current;
    if (!room || !connected) return;
    const hostId = streamerIdRef.current;
    room.remoteParticipants.forEach((participant) => {
      // Backstage stays unsubscribed whatever the picture setting.
      if (backstageIdsRef.current.has(participant.identity)) return;
      const phone = isCameraIdentity(participant.identity);
      const host = participant.identity === hostId || participant.identity === `obs-${hostId}`;
      participant.videoTrackPublications.forEach((pub) => {
        // Radio takes no picture; the phone cam only while it's on screen.
        if (pictureMode === "radio" || (phone && resolved.phone === "off")) {
          pub.setSubscribed(false);
          return;
        }
        pub.setSubscribed(true);
        // Data saver takes the smallest of everything; otherwise the angle
        // says how sharp each camera comes in.
        const wanted = phone ? resolved.phone : host ? resolved.main : "high";
        pub.setVideoQuality(pictureMode === "saver" ? VideoQuality.LOW : QUALITY[wanted === "off" ? "low" : wanted]);
      });
    });
  }, [pictureMode, connected, resolved.main, resolved.phone]);
  const [streamEnded, setStreamEnded] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // Report modal state
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState<string>("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  // Escape closes the report dialog, like every other dialog in the app.
  useEffect(() => {
    if (!showReport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowReport(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showReport]);

  // Auto-hide video controls after mouse inactivity
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    showControls();
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [showControls]);

  // Fetch stream data
  const fetchStream = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!opts.quiet) setLoading(true);
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { stream: StreamData };
        }>(`/api/streams/${id}${preview.query}`);
        setStream(res.data.stream);
        setLikeCount(res.data.stream.likes ?? 0);
        // A poll a beat behind a room event never rolls the goal or meter back.
        const polledGoal = readGoal(res.data.stream.goal);
        const polledHeat = readHeat(res.data.stream.heat);
        setGoal((g) => newerGoal(g, polledGoal));
        setHeat((h) => newerHeat(h, polledHeat));
      } catch (err) {
        if (err instanceof ApiError && err.status === 410) setRemoved(true);
        // A preview link dies with the run (or when the host stops sharing): that's its end.
        if (preview.on && opts.quiet && err instanceof ApiError && err.status === 404) {
          setStream((prev) => (prev ? { ...prev, isLive: false } : prev));
        }
        if (!opts.quiet) {
          setError(err instanceof Error ? err.message : "Failed to load stream");
        }
      } finally {
        if (!opts.quiet) setLoading(false);
      }
    },
    [id, preview.on, preview.query],
  );

  useEffect(() => {
    void fetchStream();
  }, [fetchStream]);

  // Quiet re-checks in BOTH directions: a stream that starts after the page
  // opened appears without a refresh, and a stream that ends while the page
  // sits on "waiting for the broadcaster" flips to the ended state instead
  // of spinning forever.
  useEffect(() => {
    if (loading) return;
    const poll = setInterval(() => void fetchStream({ quiet: true }), 10_000);
    return () => clearInterval(poll);
  }, [loading, fetchStream]);

  useEffect(() => {
    if (stream && !stream.isLive) setStreamEnded(true);
  }, [stream]);

  useEffect(() => {
    streamerIdRef.current = stream?.streamerId?._id ?? null;
  }, [stream?.streamerId?._id]);

  // What Vivid's getCurrentPageContext reads while the user is on this page.
  const vividRef = useRef({ stream, isFollowing, liked, viewerCount, muted, theaterMode, chatPlacement, showReport });
  useEffect(() => {
    vividRef.current = { stream, isFollowing, liked, viewerCount, muted, theaterMode, chatPlacement, showReport };
  });
  useEffect(
    () =>
      registerVividContext("stream", () => {
        const v = vividRef.current;
        if (!v.stream) return null;
        return {
          streamId: v.stream._id,
          title: v.stream.title,
          category: v.stream.category,
          streamer: v.stream.streamerId?.displayName || v.stream.streamerId?.username || null,
          streamerUsername: v.stream.streamerId?.username || null,
          isLive: v.stream.isLive,
          viewers: v.viewerCount,
          following: v.isFollowing,
          liked: v.liked,
          playerMuted: v.muted,
          theaterMode: v.theaterMode,
          chatPlacement: v.chatPlacement,
          openDialog: v.showReport ? "report" : null,
        };
      }),
    [],
  );

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  // Check follow status
  useEffect(() => {
    if (!stream?.streamerId?.username || !user) return;
    async function checkFollow() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { isFollowing?: boolean };
        }>(`/api/user/${stream!.streamerId.username}`);
        setIsFollowing(res.data.isFollowing ?? false);
      } catch (err) {
        // Don't swallow this. If the status lookup fails the button renders
        // "Follow" regardless of reality, and the follow request that follows
        // is then rejected as a duplicate — which is exactly how the button
        // ends up looking dead.
        console.error("[Follow] status check failed:", err);
      }
    }
    checkFollow();
  }, [stream?.streamerId?.username, user]);

  // Load whether the current user already liked this stream
  useEffect(() => {
    if (!user) return;
    async function checkLiked() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { likes: number; liked: boolean };
        }>(`/api/streams/${id}/like`);
        setLikeCount(res.data.likes);
        setLiked(res.data.liked);
      } catch {
        // Endpoint unavailable — keep local-only state
      }
    }
    checkLiked();
  }, [id, user]);

  // Elapsed timer
  useEffect(() => {
    if (!stream?.isLive || !stream.startedAt) return;
    const updateElapsed = () => {
      const diff = Math.floor(
        (Date.now() - new Date(stream.startedAt).getTime()) / 1000
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
    };
    updateElapsed();
    elapsedInterval.current = setInterval(updateElapsed, 1000);
    return () => {
      if (elapsedInterval.current) clearInterval(elapsedInterval.current);
    };
  }, [stream?.isLive, stream?.startedAt]);

  /**
   * Put someone backstage, or bring them out. Backstage tracks are never
   * subscribed to — no bytes, no picture, no sound, for viewers and for the
   * other backstage guests alike. Coming out re-subscribes, which brings
   * their tile and their audio in through TrackSubscribed like anyone
   * else's. The host's studio and the producers' consoles do their own thing.
   */
  const setBackstage = useCallback((identity: string, on: boolean) => {
    const ids = backstageIdsRef.current;
    if (on === ids.has(identity)) return;
    if (on) ids.add(identity);
    else ids.delete(identity);
    setBackstageIds(new Set(ids));
    const participant = roomRef.current?.remoteParticipants.get(identity);
    participant?.trackPublications.forEach((pub) => pub.setSubscribed(!on));
  }, []);

  // Connect to LiveKit as viewer
  const connectToStream = useCallback(async () => {
    if (!stream?.isLive || connected) return;

    try {
      // The owner joins as a monitor (mon-<id>): watching your own stream
      // must never steal the broadcaster identity from the device actually
      // publishing it.
      const res = await apiFetch<{
        success: boolean;
        data: { token: string; livekitUrl: string };
      }>(
        `/api/streams/${id}/token${isOwnerRef.current ? "?monitor=1" : preview.query}`
      );

      // Dynamic import to avoid SSR issues
      const { Room: LKRoom, RoomEvent, Track, DisconnectReason } = await import("livekit-client");

      // adaptiveStream matches each subscribed video's quality to the size
      // it's actually rendered at; dynacast lets the publisher pause simulcast
      // layers nobody is consuming. Both are free wins for viewers on phones
      // and bad networks — the majority.
      const room = new LKRoom({ adaptiveStream: true, dynacast: true });

      /** Wire up a subscribed remote track: host video to the main player,
       *  guest video to a stage tile, all audio muted-by-default. */
      const addTrack = (
        track: { kind: string; attach: () => HTMLElement } & AttachableVideoTrack,
        participant: { identity: string; name?: string }
      ) => {
        if (track.kind === Track.Kind.Video) {
          // The host's phone cam is their second angle: kept for the
          // program, never a guest tile.
          if (isCameraIdentity(participant.identity)) {
            phoneCameraRef.current = track;
            setPhoneEpoch((n) => n + 1);
            return;
          }
          // The host's feed arrives as their user id (browser publish) or
          // as obs-<id> (RTMP encoder) — both are the main video, never a
          // guest tile.
          const hostId = streamerIdRef.current;
          if (
            !hostId ||
            participant.identity === hostId ||
            participant.identity === `obs-${hostId}`
          ) {
            if ((track as { source?: string }).source === "screen_share") hostScreenRef.current = track;
            else hostCameraRef.current = track;
            videoTrackRef.current = hostScreenRef.current ?? hostCameraRef.current;
            setHostFeeds({ camera: Boolean(hostCameraRef.current), screen: Boolean(hostScreenRef.current) });
            setHasVideo(true);
            setHostTrackEpoch((n) => n + 1);
          } else {
            guestTracksRef.current.set(participant.identity, track);
            // A fresh array even when the guest is already listed: the tile
            // reads its track from the ref during render, so a republished
            // track only reaches it if React re-renders.
            setGuestVideos((prev) =>
              prev.some((g) => g.identity === participant.identity)
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
        }
        if (track.kind === Track.Kind.Audio) {
          // Belt and braces: a backstage track never gets this far (it's
          // unsubscribed on publish), but if one did, it stays silent.
          if (backstageIdsRef.current.has(participant.identity)) return;
          const audioEl = track.attach() as HTMLAudioElement;
          // Muted start — see the audio state block. Unmuting flips these
          // elements directly inside the user's click.
          audioEl.muted = mutedRef.current;
          audioEl.dataset.identity = participant.identity;
          audioEl.volume = volumeRef.current * gainFor(gainsRef.current, participant.identity);
          document.body.appendChild(audioEl);
          audioElsRef.current.set(track, audioEl);
        }
      };

      // Backstage publishes for the crew, not the room: drop the
      // subscription the moment the track is announced, before any of it
      // arrives. (The viewer token auto-subscribes; this is the opt-out.)
      // The phone cam is taken only while it's on this viewer's screen.
      const wantPhone = () => resolvedRef.current.phone !== "off" && pictureModeRef.current !== "radio";
      room.on(RoomEvent.TrackPublished, (publication, participant) => {
        if (backstageIdsRef.current.has(participant.identity)) publication.setSubscribed(false);
        if (isCameraIdentity(participant.identity)) {
          setPhoneAvailable(true);
          publication.setSubscribed(wantPhone());
        }
      });
      room.on(RoomEvent.TrackUnpublished, (_publication, participant) => {
        if (isCameraIdentity(participant.identity)) setPhoneAvailable(false);
      });

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (!track) return;
        // Subscribed before we knew they were backstage (a page that loaded
        // mid-wait): let go now, and take nothing from it.
        if (backstageIdsRef.current.has(participant.identity)) {
          publication.setSubscribed(false);
          return;
        }
        // The phone cam: subscribed before this viewer's pick was known —
        // let go, or take it at the size the pick asks for.
        if (isCameraIdentity(participant.identity)) {
          if (!wantPhone()) {
            publication.setSubscribed(false);
            return;
          }
          const wanted = resolvedRef.current.phone;
          if (track.kind === Track.Kind.Video) publication.setVideoQuality(pictureModeRef.current === "saver" ? VideoQuality.LOW : QUALITY[wanted === "off" ? "low" : wanted]);
          addTrack(track, participant);
          return;
        }
        // Radio takes no picture; Data saver takes the smallest.
        if (track.kind === Track.Kind.Video) {
          if (pictureModeRef.current === "radio") {
            publication.setSubscribed(false);
            return;
          }
          if (pictureModeRef.current === "saver") publication.setVideoQuality(VideoQuality.LOW);
        }
        addTrack(track, participant);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        if (!track) return;
        // Only the audio elements are ours to remove (we made them). The
        // video elements belong to React — removing them too left a host
        // who reconnected, or a guest who republished, attached to a
        // <video> no longer in the page: a black player until a reload.
        const detached = track.detach();
        if (track.kind === Track.Kind.Audio) detached.forEach((el) => el.remove());
        audioElsRef.current.delete(track);
        if (track.kind === Track.Kind.Video) {
          if (isCameraIdentity(participant.identity)) {
            phoneCameraRef.current = null;
            setPhoneEpoch((n) => n + 1);
            return;
          }
          const hostId = streamerIdRef.current;
          if (
            participant.identity === hostId ||
            participant.identity === `obs-${hostId}`
          ) {
            if (hostScreenRef.current === track) hostScreenRef.current = null;
            else if (hostCameraRef.current === track) hostCameraRef.current = null;
            else hostCameraRef.current = hostScreenRef.current = null;
            videoTrackRef.current = hostScreenRef.current ?? hostCameraRef.current;
            setHostFeeds({ camera: Boolean(hostCameraRef.current), screen: Boolean(hostScreenRef.current) });
            setHasVideo(Boolean(videoTrackRef.current));
            setHostTrackEpoch((n) => n + 1);
          } else {
            guestTracksRef.current.delete(participant.identity);
            setGuestVideos((prev) =>
              prev.filter((g) => g.identity !== participant.identity)
            );
          }
        }
      });

      room.on(RoomEvent.ParticipantConnected, () => {
        setViewerCount(audienceOf(room));
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        setViewerCount(audienceOf(room));
        if (isCameraIdentity(participant.identity)) {
          phoneCameraRef.current = null;
          setPhoneAvailable(false);
        }
      });
      // Surface MY downlink health — viewers blame the streamer for what is
      // usually their own wifi; a quiet chip says which it is.
      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (participant === room.localParticipant) {
          setConnQuality(String(quality));
        }
      });
      room.on(RoomEvent.Disconnected, (reason?: DisconnectReasonType) => {
        setConnected(false);
        setHasVideo(false);
        videoTrackRef.current = null;
        hostCameraRef.current = null;
        hostScreenRef.current = null;
        setHostFeeds({ camera: false, screen: false });
        audioElsRef.current.forEach((el) => el.remove());
        audioElsRef.current.clear();
        guestTracksRef.current.clear();
        setGuestVideos([]);
        setLocalStageTrack(null);
        setLocalStageAudio(null);
        stageTargetRef.current = "idle";
        setStageState("idle");
        // Why the room let go decides what the viewer is told. This used to
        // call every disconnect the end of the stream — so a viewer whose
        // own wifi blinked got "Stream ended" on a stream still going.
        if (reason === DisconnectReason.CLIENT_INITIATED) return;
        if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
          setPlayingElsewhere(true);
          setPlaybackError("This stream is playing in another tab or on another device.");
          return;
        }
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
          // A preview's viewers leave when the host stops sharing or the run ends.
          if (preview.on) {
            setStream((prev) => (prev ? { ...prev, isLive: false } : prev));
            setStreamEnded(true);
            return;
          }
          setPlaybackError("You were removed from this stream.");
          return;
        }
        if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED) {
          setStream((prev) => (prev ? { ...prev, isLive: false } : prev));
          setStreamEnded(true);
          return;
        }
        // Most likely this viewer's own network. Ask the API whether the
        // stream is still on (if it isn't, the ended sheet takes over), then
        // go back in.
        setRejoining(true);
        void fetchStream({ quiet: true }).then(() => setRejoinNonce((n) => n + 1));
      });

      // Real-time engagement events, broadcast by the API server-side.
      // Chat messages are handled inside LiveChat; events carry `__evt`.
      // The event carries the authoritative post-write count — client-sent
      // deltas could drift (drops, replays) and never reached viewers whose
      // sender had no data-publish rights (cross-platform, guests).
      room.on(RoomEvent.DataReceived, (payload: Uint8Array, from?: { identity: string }, kind?: unknown, topic?: string) => {
        // The host's face positions: binary, and many a second — never JSON.
        if (takeAnchors(payload, from, kind, topic)) return;
        // Everything else is the API's, sent by the server with no
        // participant — bar the host's own AI-voice badge. Anyone else in the
        // room is ignored, whatever their packet claims to be.
        if (from && from.identity !== streamerIdRef.current) return;
        try {
          const data = JSON.parse(new TextDecoder().decode(payload)) as {
            __evt?: string;
            likes?: number;
            delta?: number;
            action?: string;
            userId?: string;
            username?: string;
            avatar?: string;
            type?: string;
            tipAmount?: string;
            tipCurrency?: string;
            emoji?: string;
            id?: string;
            battle?: BattleView;
            game?: GameView;
            points?: number;
            state?: string;
            graceMs?: number;
          };
          // From the host's studio, only the AI-voice badge counts.
          if (from && data.__evt !== "ai_voice") return;
          // The host's assistant is talking — said by the host's own studio,
          // so it only counts from them. It lapses by itself if the "off" is lost.
          if (data.__evt === "ai_voice") {
            if (from && from.identity === streamerIdRef.current) {
              const on = (data as { on?: boolean }).on === true;
              setAiVoice(on);
              if (aiVoiceTimer.current) clearTimeout(aiVoiceTimer.current);
              if (on) aiVoiceTimer.current = setTimeout(() => setAiVoice(false), 20_000);
            }
            return;
          }
          // The host changed the scene: the newer version wins.
          if (data.__evt === "scene") {
            const next = readScene((data as { scene?: unknown }).scene);
            setStream((prev) => (prev ? { ...prev, scene: newerScene(prev.scene, next) } : prev));
            return;
          }
          // The host changed their brand kit: the graphics redraw in it.
          if (data.__evt === "brand") {
            const brand = (data as { brand?: StreamData["streamerId"]["brand"] }).brand;
            if (brand) setStream((prev) => (prev ? { ...prev, streamerId: { ...prev.streamerId, brand } } : prev));
            return;
          }
          // The host changed who can ask to join: Join shows or goes.
          if (data.__evt === "stage_line") {
            const who = readStageLine(data).who;
            setStream((prev) => (prev ? { ...prev, streamerId: { ...prev.streamerId, settings: { ...prev.streamerId.settings, stageRequests: who } } } : prev));
            return;
          }
          // The host renamed the stream (or moved its category) on air.
          if (data.__evt === "details") {
            const d = data as { title?: unknown; category?: unknown };
            setStream((prev) =>
              prev
                ? {
                    ...prev,
                    ...(typeof d.title === "string" && d.title ? { title: d.title } : {}),
                    ...(typeof d.category === "string" && d.category ? { category: d.category } : {}),
                  }
                : prev
            );
            return;
          }
          // Taken down while we watch: the room closes next; say why.
          if (data.__evt === "takedown") {
            setRemoved(true);
            return;
          }
          // The host's feed dropped or came back — the API decides, the
          // player shows "Be right back" while it's away.
          if (data.__evt === "feed") {
            const away = data.state === "reconnecting";
            setStream((prev) =>
              prev
                ? { ...prev, feedDroppedAt: away ? (prev.feedDroppedAt ?? new Date().toISOString()) : null }
                : prev
            );
            if (typeof data.graceMs === "number") setGraceMs(data.graceMs);
            return;
          }
          // A drop: the on-player moment; chat gets its own row from the API.
          if (data.__evt === "drop" && data.username) {
            giftOverlayRef.current?.push({
              id: String(data.id ?? `drop-${Date.now()}`),
              username: data.username,
              emoji: "🎁",
              amountLabel: `+${data.points ?? 50} pts`,
              amountUsdMinor: 0,
            });
            if (data.userId === userIdRef.current) window.dispatchEvent(new CustomEvent("xtreme:points"));
            return;
          }
          if (data.__evt === "game" && data.game) {
            // Keep my own entry: the broadcast view doesn't carry it.
            setGame((prev) => ({ ...data.game!, mine: prev && prev.id === data.game!.id ? prev.mine : undefined }));
            return;
          }
          if (data.__evt === "battle" && data.battle) {
            setBattle(data.battle);
            return;
          }
          // A gift, a like or an ally moved the goal, or the host changed it.
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
          if (data.__evt === "like") {
            if (typeof data.likes === "number") {
              setLikeCount(data.likes);
            } else if (typeof data.delta === "number") {
              // Legacy clients still publish deltas; honour them.
              setLikeCount((c) => Math.max(0, c + Math.sign(data.delta!)));
            }
            heartsRef.current?.push();
            return;
          }
          // Host-on-mobile: stage requests reach the owner wherever they are.
          if (data.__evt === "guest_request" && data.userId) {
            if (isOwnerRef.current) {
              const row = {
                userId: data.userId,
                username: data.username ?? "viewer",
                avatar: data.avatar ?? "",
              };
              setHostRequests((prev) =>
                prev.some((r) => r.userId === row.userId)
                  ? prev
                  : [...prev, row]
              );
            }
            return;
          }
          // Stage transitions about *me* drive publishing; everyone else's
          // tiles follow the tracks themselves via TrackSubscribed — except
          // backstage, which every page keeps off its picture and sound.
          if (data.__evt === "guest_update" && data.userId) {
            const uid = data.userId;
            if (data.action === "backstage") setBackstage(uid, true);
            else if (data.action === "approved" || data.action === "removed" || data.action === "left") setBackstage(uid, false);
            if (isOwnerRef.current) {
              const known = data.username ? { userId: uid, username: data.username, avatar: data.avatar ?? "" } : null;
              const bringOn = (row: { userId: string; username: string; avatar: string }) =>
                setHostLiveGuests((live) => (live.some((g) => g.userId === uid) ? live : [...live, row]));
              if (data.action === "cancelled" || data.action === "denied") {
                setHostRequests((prev) =>
                  prev.filter((r) => r.userId !== uid)
                );
              } else if (data.action === "backstage") {
                // A producer sent them backstage from the console: the row
                // moves from asking to waiting.
                setHostRequests((prev) => {
                  const row = prev.find((r) => r.userId === uid) ?? known;
                  if (row) {
                    setHostBackstageGuests((wings) =>
                      wings.some((g) => g.userId === uid) ? wings : [...wings, row]
                    );
                  }
                  return prev.filter((r) => r.userId !== uid);
                });
              } else if (data.action === "approved") {
                // On from a request, or from backstage.
                setHostRequests((prev) => {
                  const row = prev.find((r) => r.userId === uid);
                  if (row) bringOn(row);
                  return prev.filter((r) => r.userId !== uid);
                });
                setHostBackstageGuests((prev) => {
                  const row = prev.find((r) => r.userId === uid);
                  if (row) bringOn(row);
                  return prev.filter((r) => r.userId !== uid);
                });
              } else if (data.action === "removed" || data.action === "left") {
                setHostLiveGuests((prev) =>
                  prev.filter((g) => g.userId !== uid)
                );
                setHostBackstageGuests((prev) =>
                  prev.filter((g) => g.userId !== uid)
                );
              }
            }
            if (data.userId === userIdRef.current) {
              if (data.action === "backstage") {
                // Accepted into the wings: camera and mic go up exactly as
                // an approval's do; the page shows the check, not a tile.
                stageTargetRef.current = "backstage";
                setBackstageOpen(true);
                publishAsGuestRef.current();
              } else if (data.action === "approved") {
                stageTargetRef.current = "live";
                // From backstage I'm already sending — just step on.
                if (stageStateRef.current === "backstage") setStageState("live");
                else publishAsGuestRef.current();
              } else if (
                data.action === "removed" ||
                data.action === "denied"
              ) {
                const wasBackstage = stageStateRef.current === "backstage";
                stopStagePublishRef.current();
                setStageState("idle");
                setStageError(
                  data.action === "denied"
                    ? "The host declined your request."
                    : wasBackstage
                      ? "The host took you off backstage."
                      : "The host removed you from the stage."
                );
              }
            }
            return;
          }
          // This stream is merging into another live — follow the party.
          if (data.__evt === "colive_merged") {
            const into = (data as { into?: string }).into;
            if (into) {
              setMergingInto(into);
              setTimeout(() => {
                window.location.assign(`/stream/${into}`);
              }, 1600);
            }
            return;
          }
          // Wallet-charged tips arrive as chat payloads (no __evt). The chat
          // renders the row; this turns the same event into the on-player
          // moment and keeps the supporters strip current.
          if (!data.__evt && data.type === "tip" && data.username) {
            const amountStr = data.tipAmount ?? "0";
            const cents = Math.round(parseFloat(amountStr) * 100) || 0;
            const label = amountStr.endsWith(".00")
              ? `$${amountStr.slice(0, -3)}`
              : `$${amountStr}`;
            // The Set's effect for this gift, round the host's face.
            effectsRef.current?.gift({ emoji: data.emoji }, { id: String(data.id ?? "") });
            giftOverlayRef.current?.push({
              id: String(data.id ?? `tip-${Date.now()}-${Math.random()}`),
              username: data.username,
              emoji: data.emoji || "💰",
              amountLabel: label,
              amountUsdMinor: cents,
            });
            setTopGifters((prev) => {
              const next = prev.map((g) =>
                g.username === data.username
                  ? { ...g, totalUsdMinor: g.totalUsdMinor + cents }
                  : g
              );
              if (!next.some((g) => g.username === data.username)) {
                next.push({
                  username: data.username!,
                  avatar: data.avatar ?? "",
                  totalUsdMinor: cents,
                });
              }
              return next
                .sort((a, b) => b.totalUsdMinor - a.totalUsdMinor)
                .slice(0, 5);
            });
          }
        } catch {
          // Not an event payload
        }
      });

      // The scene rides on the room's metadata: whoever joins mid-stream
      // draws the host's layout from the first frame.
      room.on(RoomEvent.RoomMetadataChanged, (metadata: string) => {
        const next = sceneFromMetadata(metadata);
        setStream((prev) => (prev ? { ...prev, scene: newerScene(prev.scene, next) } : prev));
      });

      await room.connect(res.data.livekitUrl, res.data.token);
      roomRef.current = room;
      {
        const joined = sceneFromMetadata(room.metadata);
        if (joined) setStream((prev) => (prev ? { ...prev, scene: newerScene(prev.scene, joined) } : prev));
      }
      setConnected(true);
      setRejoining(false);
      setPlayingElsewhere(false);
      setViewerCount(audienceOf(room));
      // A phone cam already in the room is an angle on offer.
      let phone = false;
      room.remoteParticipants.forEach((p) => {
        if (isCameraIdentity(p.identity) && p.videoTrackPublications.size > 0) phone = true;
      });
      setPhoneAvailable(phone);

      // Attach any already-published tracks
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.track && pub.isSubscribed) {
            addTrack(pub.track, participant);
          }
        });
      });
      setPlaybackError(null);
    } catch (err) {
      // Swallowing this is what produced the worst failure mode on this page:
      // a stale stream still flagged live rendered the LIVE badge and a ticking
      // timer over a permanently black player, with no indication anything had
      // gone wrong. Surface it instead.
      console.error("[Stream] Failed to join the LiveKit room:", err);
      setRejoining(false);
      setPlaybackError(
        err instanceof ApiError && err.status === 400
          ? "This stream has ended."
          : "Couldn't connect to this stream. It may have ended."
      );
    }
  }, [stream?.isLive, id, connected, fetchStream, setBackstage, takeAnchors, preview.on, preview.query]);

  // Back online after a failed rejoin: go back in without waiting for a tap.
  useEffect(() => {
    if (!playbackError || !stream?.isLive || playingElsewhere) return;
    const online = () => {
      setPlaybackError(null);
      setRejoinNonce((n) => n + 1);
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [playbackError, stream?.isLive, playingElsewhere]);

  // Attach the video track whenever BOTH it and the element exist. The old
  // code attached inside the subscribe callback against a ref that could
  // still be null (the element only renders after `stream` resolves), which
  // lost the track for good and left a permanently black player.
  useEffect(() => {
    const track = videoTrackRef.current;
    const el = videoElRef.current;
    if (!hasVideo || !track || !el) return;
    // Detach first: crossing the mobile/desktop breakpoint swaps the video
    // element, and a track left attached to an unmounted one keeps a stale
    // visibility entry that adaptiveStream can read as "nobody is watching".
    track.detach();
    track.attach(el);
    // hostTrackEpoch: re-attach when the track OBJECT is replaced, which
    // `hasVideo` alone can't see.
  }, [hasVideo, connected, isMobileView, hostTrackEpoch]);

  // Auto-connect when stream loads. Waits for auth to settle: connecting
  // before we know whether this viewer is the OWNER would fetch a normal
  // token and kick their live broadcast off the air.
  useEffect(() => {
    if (stream?.isLive && !connected && !authLoading) {
      connectToStream();
    }
    const audioEls = audioElsRef.current;
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      // The audio elements live on document.body, not in this component's
      // tree — React won't reap them on unmount, so we must.
      audioEls.forEach((el) => el.remove());
      audioEls.clear();
    };
    // rejoinNonce: a bump re-runs this to go back in after a drop.
  }, [stream?.isLive, authLoading, rejoinNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { battle: BattleView | null } }>(`/api/streams/${id}/battle`)
        .then((r) => !cancelled && setBattle(r.data.battle))
        .catch(() => {});
    void load();
    const t = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { game: GameView | null } }>(`/api/streams/${id}/games/current`)
        .then((r) => !cancelled && setGame(r.data.game))
        .catch(() => {});
    void load();
    const t = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id]);

  // Track fullscreen exits (e.g. pressing Escape)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  /** Push the current mute/volume state onto every attached audio element. */
  const applyAudioState = useCallback((nextMuted: boolean, nextVolume: number) => {
    mutedRef.current = nextMuted;
    volumeRef.current = nextVolume;
    audioElsRef.current.forEach((el) => {
      el.muted = nextMuted;
      el.volume = nextVolume * gainFor(gainsRef.current, el.dataset.identity);
      if (!nextMuted) {
        // Runs inside the user's gesture, so autoplay policy allows it.
        el.play().catch(() => {});
      }
    });
  }, []);

  const toggleMute = useCallback(() => {
    // Beside the host's live mic, sound here would feed back into the stream.
    if (viewerView) return;
    setMuted((prev) => {
      const next = !prev;
      applyAudioState(next, volumeRef.current);
      return next;
    });
  }, [applyAudioState, viewerView]);

  const changeVolume = useCallback(
    (next: number) => {
      if (viewerView) return;
      setVolume(next);
      // Dragging the slider up is an intent to hear — unmute like every
      // other player does.
      setMuted(next === 0);
      applyAudioState(next === 0, next);
    },
    [applyAudioState, viewerView]
  );

  const toggleFullscreen = useCallback(() => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      // The request can be refused (a background window, an iframe without
      // the permission). Only the promise decides the state — flipping it
      // eagerly left the page stuck in its fullscreen layout after a refusal.
      videoContainerRef.current
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => setIsFullscreen(false));
    } else {
      void document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  const togglePiP = useCallback(async () => {
    const video = videoElRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // Unsupported (Firefox without flag, or no video yet) — button is a
      // no-op rather than an error.
    }
  }, []);

  // What this audience also watches, and what the host has scheduled. Both
  // are "where do I go next" answers, which is the question a watch page
  // has to hold when the stream ends.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await discoveryFetch<{ success: boolean; data: { streams: RowItem[] } }>(
          `/api/streams/${id}/also-watched`
        );
        if (!cancelled) setAlsoLive(res.data.streams);
      } catch {
        if (!cancelled) setAlsoLive([]);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    const username = stream?.streamerId?.username;
    if (!username) return;
    let cancelled = false;
    discoveryFetch<{ success: boolean; data: { streams: RowItem[] } }>(
      `/api/streams?streamer=${encodeURIComponent(username)}&status=upcoming&limit=6`
    )
      .then((res) => {
        if (!cancelled) setHostUpcoming(res.data.streams);
      })
      .catch(() => {
        if (!cancelled) setHostUpcoming([]);
      });
    return () => {
      cancelled = true;
    };
  }, [stream?.streamerId?.username]);

  const toggleTheater = useCallback(() => {
    setTheaterMode((t) => !t);
  }, []);

  // Player keyboard shortcuts: m mute, f fullscreen. Skipped while typing
  // (the chat input lives on this page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "m" || e.key === "M") toggleMute();
      if (e.key === "f" || e.key === "F") toggleFullscreen();
      if (e.key === "t" || e.key === "T") toggleTheater();
      if ((e.key === "c" || e.key === "C") && document.fullscreenElement) setFsChat((v) => !v);
      if (e.key === "p" || e.key === "P") void togglePiP();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute, toggleFullscreen, toggleTheater, togglePiP]);

  // ---- Stage: request/publish/leave ----

  /** Stop sending my camera/mic. Safe to call when not publishing. */
  const stopStagePublish = useCallback(() => {
    const room = roomRef.current;
    stageTargetRef.current = "idle";
    setLocalStageTrack(null);
    setLocalStageAudio(null);
    setStageMicOn(true);
    if (!room) return;
    void room.localParticipant.setCameraEnabled(false).catch(() => {});
    void room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  }, []);

  /** A start is in flight: a second call would only race it. */
  const publishingRef = useRef(false);

  /**
   * Called when the host approves me, or sends me backstage: my participant
   * now has publish rights (granted server-side), so turning the camera on
   * Just Works. Retried a few times because the grant and the data event
   * race each other to my client. Lands wherever `stageTargetRef` says by
   * the time the camera is up.
   */
  const publishAsGuest = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    // Already sending (backstage or on stage), or a start is under way: the
    // caller set the target, and that's where it lands.
    if (stageStateRef.current === "live" || stageStateRef.current === "backstage" || publishingRef.current) return;
    publishingRef.current = true;
    setStageError(null);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await room.localParticipant.setCameraEnabled(true);
          await room.localParticipant.setMicrophoneEnabled(true);
          // Taken off, or left, while the camera was starting: stay down.
          if (stageTargetRef.current === "idle") {
            stopStagePublish();
            return;
          }
          const pub = Array.from(
            room.localParticipant.videoTrackPublications.values()
          )[0];
          const mic = Array.from(
            room.localParticipant.audioTrackPublications.values()
          )[0];
          setLocalStageTrack(
            (pub?.track as unknown as AttachableVideoTrack) ?? null
          );
          setLocalStageAudio(mic?.track?.mediaStreamTrack ?? null);
          setStageState(stageTargetRef.current);
          setStageMicOn(true);
          return;
        } catch (err) {
          const msg = String(err).toLowerCase();
          if (msg.includes("permission") || msg.includes("notallowed")) {
            // Camera denied — free the slot instead of squatting on it.
            setStageError(
              "Camera or microphone permission was denied, so you couldn't join."
            );
            stageTargetRef.current = "idle";
            setStageState("idle");
            void apiFetch(`/api/streams/${id}/guests/leave`, {
              method: "POST",
            }).catch(() => {});
            return;
          }
          // Grant may not have reached us yet — brief pause, then retry.
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      setStageError("Couldn't start your camera. Try joining again.");
      stageTargetRef.current = "idle";
      setStageState("idle");
      void apiFetch(`/api/streams/${id}/guests/leave`, { method: "POST" }).catch(
        () => {}
      );
    } finally {
      publishingRef.current = false;
    }
  }, [id, stopStagePublish]);

  useEffect(() => {
    publishAsGuestRef.current = () => void publishAsGuest();
    stopStagePublishRef.current = stopStagePublish;
  }, [publishAsGuest, stopStagePublish]);

  const requestStage = async () => {
    if (stageBusy || !user) return;
    setStageBusy(true);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${id}/guests/request`, { method: "POST" });
      setStageState("requested");
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't send the request."
      );
    } finally {
      setStageBusy(false);
    }
  };

  // A refusal says its piece, then clears.
  useEffect(() => {
    if (!stageError) return;
    const t = setTimeout(() => setStageError(null), 6000);
    return () => clearTimeout(t);
  }, [stageError]);

  const cancelStageRequest = async () => {
    if (stageBusy) return;
    setStageBusy(true);
    try {
      await apiFetch(`/api/streams/${id}/guests/request`, { method: "DELETE" });
      setStageState("idle");
    } catch {
      // Worst case the host denies a request we no longer care about.
      setStageState("idle");
    } finally {
      setStageBusy(false);
    }
  };

  const leaveStage = async () => {
    if (stageBusy) return;
    setStageBusy(true);
    stopStagePublish();
    setStageState("idle");
    try {
      await apiFetch(`/api/streams/${id}/guests/leave`, { method: "POST" });
    } catch {
      // The webhook cleanup will free the slot if this failed.
    } finally {
      setStageBusy(false);
    }
  };

  const toggleStageMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !stageMicOn;
    setStageMicOn(next);
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      // An unmute can hand out a fresh track: the backstage meter follows it.
      const mic = Array.from(room.localParticipant.audioTrackPublications.values())[0];
      setLocalStageAudio(mic?.track?.mediaStreamTrack ?? null);
    } catch {
      setStageMicOn(!next);
    }
  };

  // Owner: seed the stage roster (requests + who's on + who's waiting) once live.
  useEffect(() => {
    if (!isOwner || !stream?.isLive) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            live: Array<{ userId: string; username: string; avatar: string }>;
            backstage?: Array<{ userId: string; username: string; avatar: string }>;
            requests: Array<{
              userId: string;
              username: string;
              avatar: string;
            }>;
          };
        }>(`/api/streams/${id}/guests`);
        if (cancelled) return;
        setHostRequests(res.data.requests);
        setHostLiveGuests(res.data.live);
        setHostBackstageGuests(res.data.backstage ?? []);
      } catch {
        // Sheet just starts empty; events fill it in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, stream?.isLive, id]);

  // Who's backstage, for everyone — signed in or not: the seed for the
  // set that keeps them off this page's picture and out of its sound.
  // Events keep it current from here.
  useEffect(() => {
    if (!stream?.isLive) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { backstage?: Array<{ userId: string }> } }>(`/api/streams/${id}/guests`)
      .then((res) => {
        if (cancelled) return;
        for (const g of res.data.backstage ?? []) setBackstage(g.userId, true);
      })
      .catch(() => {
        // Events still arrive; a page that loaded mid-wait may take a beat.
      });
    return () => {
      cancelled = true;
    };
  }, [stream?.isLive, id, setBackstage]);

  const hostApprove = async (userId: string) => {
    if (hostStageBusy) return;
    setHostStageBusy(userId);
    try {
      await apiFetch(`/api/streams/${id}/guests/${userId}/approve`, {
        method: "POST",
      });
      // From a request, or from backstage.
      const bringOn = (row: { userId: string; username: string; avatar: string }) =>
        setHostLiveGuests((live) => (live.some((g) => g.userId === userId) ? live : [...live, row]));
      setHostRequests((prev) => {
        const row = prev.find((r) => r.userId === userId);
        if (row) bringOn(row);
        return prev.filter((r) => r.userId !== userId);
      });
      setHostBackstageGuests((prev) => {
        const row = prev.find((r) => r.userId === userId);
        if (row) bringOn(row);
        return prev.filter((r) => r.userId !== userId);
      });
    } catch {
      // Row stays; the host can retry.
    } finally {
      setHostStageBusy(null);
    }
  };

  const hostSendBackstage = async (userId: string) => {
    if (hostStageBusy) return;
    setHostStageBusy(userId);
    try {
      await apiFetch(`/api/streams/${id}/guests/${userId}/backstage`, {
        method: "POST",
      });
      setHostRequests((prev) => {
        const row = prev.find((r) => r.userId === userId);
        if (row) {
          setHostBackstageGuests((wings) =>
            wings.some((g) => g.userId === userId) ? wings : [...wings, row]
          );
        }
        return prev.filter((r) => r.userId !== userId);
      });
    } catch {
      // Row stays; the host can retry.
    } finally {
      setHostStageBusy(null);
    }
  };

  const hostDeny = async (userId: string) => {
    if (hostStageBusy) return;
    setHostStageBusy(userId);
    try {
      await apiFetch(`/api/streams/${id}/guests/${userId}/deny`, {
        method: "POST",
      });
      setHostRequests((prev) => prev.filter((r) => r.userId !== userId));
    } catch {
      // Retryable.
    } finally {
      setHostStageBusy(null);
    }
  };

  const hostRemove = async (userId: string) => {
    if (hostStageBusy) return;
    setHostStageBusy(userId);
    try {
      await apiFetch(`/api/streams/${id}/guests/${userId}/remove`, {
        method: "POST",
      });
      setHostLiveGuests((prev) => prev.filter((g) => g.userId !== userId));
      setHostBackstageGuests((prev) => prev.filter((g) => g.userId !== userId));
    } catch {
      // Retryable.
    } finally {
      setHostStageBusy(null);
    }
  };

  // Reconcile my stage state on load: a pending request survives a refresh,
  // and so does backstage (they're waiting on the host, not on the picture
  // — the camera comes back up and the check shows again), but "live"
  // can't (the refresh killed my published tracks and my publish grant) —
  // release that slot instead of haunting the stage.
  useEffect(() => {
    if (!user || !stream?.isLive) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            live: Array<{ userId: string }>;
            backstage?: Array<{ userId: string }>;
            requests: Array<{ userId: string }>;
          };
        }>(`/api/streams/${id}/guests`);
        if (cancelled) return;
        if (res.data.requests.some((g) => g.userId === user.id)) {
          setStageState("requested");
        } else if (res.data.backstage?.some((g) => g.userId === user.id)) {
          // Still in the wings: re-arm the grant once the room is up, then
          // the camera goes back on and the check shows again.
          stageTargetRef.current = "backstage";
          setBackstageOpen(true);
          setClaimPending(true);
        } else if (res.data.live.some((g) => g.userId === user.id)) {
          if (wantStageRef.current) {
            // Co-live accept or mid-stage reconnect: the slot is mine —
            // re-arm it once the room connection is up.
            stageTargetRef.current = "live";
            setClaimPending(true);
          } else {
            void apiFetch(`/api/streams/${id}/guests/leave`, {
              method: "POST",
            }).catch(() => {});
          }
        }
      } catch {
        // Stage endpoints unavailable — the join button will surface errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, stream?.isLive, id]);

  // Claim a held stage slot once the room is connected (co-live merge /
  // reconnect): server re-grants publish, then the camera goes up.
  useEffect(() => {
    if (!claimPending || !connected) return;
    let cancelled = false;
    (async () => {
      try {
        await apiFetch(`/api/streams/${id}/guests/claim`, { method: "POST" });
        if (!cancelled) {
          setClaimPending(false);
          await publishAsGuest();
        }
      } catch {
        if (!cancelled) {
          setClaimPending(false);
          setStageError("Couldn't rejoin the stage — ask to join again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimPending, connected, id, publishAsGuest]);

  // Seed the supporters strip from persisted gifts; live tips keep it fresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            top: Array<{
              userId: string;
              username: string;
              displayName: string;
              avatar: string;
              totalUsdMinor: number;
            }>;
          };
        }>(`/api/streams/${id}/gifts/top`);
        if (!cancelled) setTopGifters(res.data.top);
      } catch {
        // No gifts yet, or endpoint unavailable — strip stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The fans board: watch time and chat count as well as gifts, so it
  // moves while nobody gifts — a slow poll (the API works it out once per
  // 15 s for everyone). Signed in, it also says where I stand.
  const [topFans, setTopFans] = useState<TopFan[]>([]);
  const [myFan, setMyFan] = useState<FanStanding | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { fans: TopFan[]; me: unknown } }>(`/api/streams/${id}/fans`)
        .then((r) => {
          if (cancelled) return;
          setTopFans(r.data.fans);
          setMyFan(readFan(r.data.me) ?? null);
        })
        .catch(() => {});
    void load();
    const poll = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [id, user?.id]);

  // When the stream ends, offer what's live *now* instead of ejecting the
  // viewer — the session should roll on, not stop. The auto-redirect only
  // remains for the case where nothing else is live.
  useEffect(() => {
    if (!streamEnded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            streams: Array<{
              _id: string;
              title: string;
              category: string;
              viewers: number;
              thumbnailUrl?: string | null;
              streamerId?: { displayName?: string; username?: string; avatar?: string };
              guests?: Array<{ username: string; status: string }>;
            }>;
          };
        }>(`/api/streams?live=true&limit=5&sort=viewers`);
        if (cancelled) return;
        setWatchNext(
          res.data.streams
            .filter((s) => s._id !== id)
            .slice(0, 4)
            .map((s) => {
              const host =
                s.streamerId?.displayName || s.streamerId?.username || "";
              const guest = (s.guests ?? []).find(
                (g) => g.status === "live"
              )?.username;
              return {
                _id: s._id,
                title: s.title,
                category: s.category,
                viewers: s.viewers,
                thumbnailUrl: s.thumbnailUrl,
                streamerName: guest ? `${host} with ${guest}` : host,
                streamerAvatar: s.streamerId?.avatar,
              };
            })
        );
      } catch {
        // Fall back to the redirect countdown.
      } finally {
        if (!cancelled) setWatchNextLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [streamEnded, id]);

  // Stream-ended countdown & redirect — only when there's nothing to watch
  // next (otherwise the cards ARE the exit).
  useEffect(() => {
    if (!streamEnded || preview.on || !watchNextLoaded || watchNext.length > 0) return;
    if (countdown <= 0) {
      router.push("/explore");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [streamEnded, countdown, router, watchNextLoaded, watchNext.length, preview.on]);

  /** Apply a follow outcome: the button state, plus the follower tally. */
  const syncFollow = (following: boolean, delta: number) => {
    setIsFollowing(following);
    if (delta === 0) return;
    setStream((prev) =>
      prev
        ? {
            ...prev,
            streamerId: {
              ...prev.streamerId,
              followers: Math.max(0, prev.streamerId.followers + delta),
            },
          }
        : prev
    );
  };

  // Follow / unfollow
  const toggleFollow = async () => {
    const username = stream?.streamerId?.username;
    if (!username || followLoading) return;

    const wasFollowing = isFollowing;
    setFollowLoading(true);
    setFollowError(null);

    try {
      await apiFetch(`/api/user/${username}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
      });
      syncFollow(!wasFollowing, wasFollowing ? -1 : 1);
      if (!wasFollowing) setAllyBurst((b) => b + 1);
    } catch (err) {
      const code =
        err instanceof ApiError &&
        err.data &&
        typeof err.data === "object" &&
        "code" in err.data
          ? (err.data as { code?: string }).code
          : undefined;

      // ALREADY_FOLLOWING and NOT_FOLLOWING don't mean the action failed —
      // they mean our local state was stale, and the server is already in the
      // state the user was asking for. Previously both were swallowed into a
      // console log, so the button sat there looking broken however many
      // times you pressed it. Adopt the server's answer instead; the tally
      // doesn't move because it already accounts for us.
      if (code === "ALREADY_FOLLOWING") {
        syncFollow(true, 0);
      } else if (code === "NOT_FOLLOWING") {
        syncFollow(false, 0);
      } else {
        console.error("[Follow] toggle failed:", err);
        setFollowError(
          err instanceof Error ? err.message : "Couldn't update your alliance."
        );
      }
    } finally {
      setFollowLoading(false);
    }
  };

  // Like / unlike — persists via API and broadcasts to other viewers
  const toggleLike = async () => {
    if (!user || likeBusy) return;
    setLikeBusy(true);

    const nowLiked = !liked;
    setLiked(nowLiked);
    setLikeCount((c) => Math.max(0, c + (nowLiked ? 1 : -1)));

    // No client-side broadcast: the like endpoint fans the new count into
    // the room itself, so every platform's viewers see it — not only the
    // ones lucky enough to share a data channel with this sender.
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { likes: number; liked: boolean };
      }>(`/api/streams/${id}/like`, {
        method: nowLiked ? "POST" : "DELETE",
      });
      setLikeCount(res.data.likes);
      setLiked(res.data.liked);
    } catch {
      // Endpoint unavailable — keep the optimistic local state
    } finally {
      setLikeBusy(false);
    }
  };

  // Submit a report
  const submitReport = async () => {
    if (!reportReason || reportBusy) return;
    setReportBusy(true);
    setReportError(null);
    try {
      await apiFetch(`/api/streams/${id}/report`, {
        method: "POST",
        body: JSON.stringify({
          reason: reportReason,
          ...(reportDetails.trim() ? { details: reportDetails.trim() } : {}),
        }),
      });
      setReportDone(true);
    } catch (err) {
      setReportError(
        err instanceof Error ? err.message : "Failed to submit report"
      );
    } finally {
      setReportBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner variant="orbit" />
      </div>
    );
  }

  if (removed) {
    return (
      <Empty
        className="min-h-screen"
        scene="locked"
        title="This stream was removed"
        body="It was taken down after a report, for breaking the community rules."
        action={{ label: "Browse live channels", href: "/explore" }}
      />
    );
  }

  if (preview.on && (error || !stream)) return <PreviewGone />;

  if (error || !stream) {
    return (
      <Empty
        className="min-h-screen"
        scene="missing"
        title="Stream not found"
        body={error || "This stream may have ended or doesn't exist."}
        action={{ label: "Browse live channels", href: "/explore" }}
      />
    );
  }

  const streamer = stream.streamerId;

  const hostName = streamer.displayName || streamer.username;
  // The Set the stream wears goes over the creator's own kit.
  const ownBrand = readBrand(streamer.brand, streamer._id);
  const brand = brandWithSet(ownBrand);
  const activeSet = setById(ownBrand.set ?? null);
  // The request line: closed hides Join; the API holds the other rules and says why.
  const lineOpen = streamer.settings?.stageRequests !== "off" && !preview.on;

  /** The native share sheet where there is one; the clipboard, said out loud, where there isn't. */
  const shareStream = () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: stream.title, text: `Watch ${stream.title} live on Xtream!`, url }).catch(() => {});
      return;
    }
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  /**
   * Ally, the page's one white action. Signed-out visitors get the same
   * button and land on sign-in, coming back here after — allying is the most
   * common reason anyone makes an account. The moment it lands, the ring
   * bursts (Afterglow's allied beat).
   */
  const allyButton = (size: "sm" | "md") =>
    isOwner || preview.on ? null : !user ? (
      <PillLink external href={signInHref(`/stream/${id}`)} data-tour="watch-ally" size={size} variant="primary" icon={<Heart size={size === "sm" ? 13 : 16} weight="fill" />} className="shadow-none!">
        Ally
      </PillLink>
    ) : (
      <span data-tour="watch-ally" className="relative inline-flex shrink-0">
        {allyBurst > 0 && isFollowing && (
          <span
            key={allyBurst}
            aria-hidden
            className="pointer-events-none absolute -inset-1.5 rounded-full bg-heat [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)] p-[2px] motion-safe:animate-[xt-ring-burst_.7s_var(--ease-out)_both] motion-reduce:hidden"
          />
        )}
        <Pill
          size={size}
          variant={isFollowing ? "soft" : "primary"}
          icon={
            isFollowing ? (
              <Check size={size === "sm" ? 13 : 16} weight="bold" className="text-ember-hi" />
            ) : (
              <Heart size={size === "sm" ? 13 : 16} weight="fill" />
            )
          }
          onClick={toggleFollow}
          disabled={followLoading}
          aria-pressed={isFollowing}
          title={isFollowing ? `You're allied with ${hostName} — tap to leave` : `Ally with ${hostName}`}
          // Flat, no glow (owner, 2026-09-25: "i don't like the glossy looks").
          className="shadow-none!"
        >
          {isFollowing ? "Allied" : "Ally"}
        </Pill>
      </span>
    );

  /** Back into the room after this viewer's own connection gave out. */
  const retryPlayback = () => {
    setPlaybackError(null);
    setRejoinNonce((n) => n + 1);
  };

  // The host's feed dropped and the stream is holding for it (the API's
  // reconnect grace): say so plainly, instead of a black or frozen frame.
  const hostAway = stream.isLive && Boolean(stream.feedDroppedAt) && !hasVideo && !playbackError;
  // In a battle the scoreboard stays up top (gifts still count), so the
  // card sits below it rather than under it.
  const battleUp = Boolean(battle && (isBattleActive(battle) || battle.status === "ended"));
  /** The player's badges and controls are up (they fade while live and idle). */
  const chromeShown = controlsVisible || !stream.isLive;
  const brbCard = (
    <div className={cn("absolute inset-0 flex items-center justify-center bg-black/85", battleUp && "pt-24")}>
      <div className="max-w-sm px-8 text-center">
        <span className="relative mx-auto flex w-fit">
          <UserAvatar src={streamer.avatar} name={hostName} size={64} ring="seen" ringGapClassName="bg-black" />
          <span className="absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full bg-ember text-on-ember ring-4 ring-black">
            <CellSignalLow size={14} weight="fill" />
          </span>
        </span>
        <p className="mt-5 font-wide text-[22px] font-bold tracking-[-0.025em] text-white">Be right back</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/60">
          {hostName} lost their connection. The stream picks up right here when they&apos;re back — stay put.
        </p>
        <p className="caps mt-4 font-mono text-[10.5px] text-white/40">
          Holding for up to {Math.round(graceMs / 60_000)} min
        </p>
      </div>
    </div>
  );

  // Shared by the desktop page and the mobile immersive view.
  const mergeOverlay = mergingInto && (
    <div className="animate-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/80">
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <Spinner variant="orbit" />
        <div>
          <p className="font-wide text-[19px] font-bold tracking-[-0.02em] text-foreground">
            The lives are merging
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Taking you to the combined stream…
          </p>
        </div>
      </div>
    </div>
  );

  // How the stream went, in the numbers it actually has.
  const ranFor = stream.duration ? runTime(stream.duration) : null;
  const recap = [
    ranFor ? { key: "ran", icon: <Clock size={13} />, label: `Ran ${ranFor}` } : null,
    (stream.peakViewers ?? 0) > 0
      ? { key: "peak", icon: <Eye size={13} />, label: `${formatNumber(stream.peakViewers ?? 0)} at peak` }
      : null,
    likeCount > 0
      ? { key: "likes", icon: <Heart size={13} weight="fill" />, label: `${formatNumber(likeCount)} likes` }
      : null,
  ].filter((r): r is { key: string; icon: React.ReactElement; label: string } => r !== null);

  // The stream is over: who it was, how it went, and who's live instead. A
  // sheet from the bottom on phones, a dialog on wider screens.
  const endedOverlay = preview.on ? (
    <PreviewBanner ended={streamEnded} hostName={hostName} channelHref={`/c/${streamer.username}`} />
  ) : streamEnded && (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/75 sm:items-start sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stream-ended-title"
        className={cn(
          // my-auto rather than items-center: a dialog taller than the
          // window scrolls from its top instead of losing it.
          "w-full rounded-t-[26px] bg-surface-raised px-5 pt-6 pb-[max(env(safe-area-inset-bottom),20px)] shadow-overlay sm:my-auto sm:rounded-[26px] sm:p-7",
          watchNext.length > 0 ? "sm:max-w-[640px]" : "sm:max-w-[420px]"
        )}
      >
        <div className="flex items-center gap-3.5">
          <UserAvatar
            src={streamer.avatar}
            name={hostName}
            size={52}
            ring="seen"
            ringGapClassName="bg-surface-raised"
          />
          <div className="min-w-0">
            <p className={EYEBROW}>Stream ended</p>
            <h2
              id="stream-ended-title"
              className="mt-1 font-wide text-[21px] leading-tight font-bold tracking-[-0.03em] text-balance text-foreground sm:text-[23px]"
            >
              {hostName} has wrapped up
            </h2>
          </div>
        </div>
        {recap.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {recap.map((r) => (
              <Badge key={r.key} variant="muted" size="md" icon={r.icon}>
                {r.label}
              </Badge>
            ))}
          </div>
        )}

        {watchNext.length > 0 ? (
          <>
            <div className="mt-7 flex items-center gap-2">
              <LiveBadge size="xs" />
              <p className="text-[15px] font-semibold text-foreground">Live right now</p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-x-3 sm:gap-y-4">
              {watchNext.map((s) => (
                <a
                  key={s._id}
                  // Full navigation on purpose: a soft route change to the
                  // same dynamic segment keeps this component instance —
                  // and all its ended-stream state — alive.
                  href={`/stream/${s._id}`}
                  className="press group -mx-1.5 flex items-center gap-3 rounded-[16px] p-1.5 transition-colors hover:bg-white/[0.05] sm:mx-0 sm:block sm:p-0 sm:hover:bg-transparent"
                >
                  <div className="relative aspect-video w-[118px] shrink-0 overflow-hidden rounded-[12px] bg-black sm:w-full">
                    {s.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={apiUrl(s.thumbnailUrl)}
                        alt=""
                        className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-white/20">
                        <VideoCamera size={24} />
                      </div>
                    )}
                    <LiveBadge size="xs" className="absolute top-1.5 left-1.5" />
                    <Badge
                      variant="glass"
                      size="xs"
                      icon={<Eye size={10} />}
                      className="absolute right-1.5 bottom-1.5"
                    >
                      {formatNumber(s.viewers)}
                    </Badge>
                  </div>
                  <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:mt-2.5">
                    <UserAvatar
                      src={s.streamerAvatar}
                      name={s.streamerName || "?"}
                      size={28}
                      className="hidden size-7 shrink-0 sm:flex"
                    />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-[13.5px] leading-snug font-semibold text-foreground">
                        {s.title}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                        {s.streamerName}
                        <span className="text-muted-foreground/50"> · {s.category}</span>
                      </p>
                    </div>
                  </div>
                </a>
              ))}
            </div>
            <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <PillLink href={`/c/${streamer.username}`} variant="glass" size="lg">
                Visit channel
              </PillLink>
              <PillLink href="/explore" variant="primary" size="lg">
                Browse live streams
              </PillLink>
            </div>
          </>
        ) : (
          <>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              {watchNextLoaded ? (
                <>
                  No one else is live right now. Taking you to Explore in{" "}
                  <span className="font-mono font-semibold text-foreground tabular-nums">
                    {countdown}s
                  </span>
                  .
                </>
              ) : (
                "Looking for who's live…"
              )}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Pill variant="primary" size="lg" onClick={() => router.push("/explore")} className="w-full">
                Go to Explore now
              </Pill>
              <PillLink href={`/c/${streamer.username}`} variant="ghost" size="lg" className="w-full">
                Visit channel
              </PillLink>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // A battle's other side, while it's on: a muted picture of their room on
  // our stage — the same tile on a phone and on the desktop player.
  const opponent =
    battle && isBattleActive(battle) ? (sideOf(battle, id) === "host" ? battle.challenger : battle.host) : null;
  /** The other side's picture, named on it: "Ada · muted". */
  const previewCell = (key: string, name: string, picture: ReactNode): SceneCell => ({
    key,
    node: (
      <div className="relative size-full bg-black">
        {picture}
        <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-full bg-black/55 px-2.5 py-1">
          <span className="block truncate text-xs font-semibold text-white">
            {name}
            <span className="font-medium text-white/60"> · muted</span>
          </span>
        </div>
      </div>
    ),
  });
  const opponentCell = (o: BattleView["host"]): SceneCell =>
    previewCell(
      "opponent",
      o.displayName,
      <LivePreview streamId={o.streamId} enabled={!radio} className="absolute inset-0" poster={<div className="absolute inset-0 bg-black" />} fallbackSrc={null} />
    );
  /**
   * Everyone else in the picture, in the order the scene brings them in: a
   * battle's other side, the guests, you. A 2v2 is a 2×2 — our pair down
   * the left, theirs down the right, so after our host the grid takes their
   * host, our partner, their partner. Other guests sit the battle out.
   */
  const stageCells = (): SceneCell[] => {
    // Backstage — mine or anyone's — is not on the picture.
    const me: SceneCell | null =
      stageState === "live" && localStageTrack
        ? { key: "me", identity: user?.id, node: <StageTile fill track={localStageTrack} label="You" self micOn={stageMicOn} /> }
        : null;
    const onStage = guestVideos.filter((g) => !backstageIds.has(g.identity));
    const guestCell = (g: (typeof guestVideos)[number]): SceneCell => ({
      key: g.identity,
      node: <StageTile fill track={guestTracksRef.current.get(g.identity)} label={g.name} />,
    });
    if (pairOpponent && battle) {
      const mate = (sideOf(battle, id) === "host" ? battle.host : battle.challenger).partner ?? null;
      const mateGuest = mate ? onStage.find((g) => g.identity === mate.userId) : undefined;
      const theirMate = pairOpponent.partner ?? null;
      return [
        previewCell("opponent", pairOpponent.displayName, <PreviewVideo track={hostTrackOf(pairTracks, pairOpponent, theirMate?.userId)} />),
        mateGuest
          ? guestCell(mateGuest)
          : me && mate && user?.id === mate.userId
            ? me
            : { key: "mate", node: <AwayTile name={mate?.displayName ?? "Their partner"} /> },
        theirMate
          ? previewCell("opponent-mate", theirMate.displayName, <PreviewVideo track={pairTracks.get(theirMate.userId)} />)
          : { key: "opponent-mate", node: <AwayTile name="Their partner" /> },
      ];
    }
    return [...(opponent ? [opponentCell(opponent)] : []), ...onStage.map(guestCell), ...(me ? [me] : [])];
  };

  /**
   * The phone cam's tile, while this viewer takes it: SceneRenderer puts it
   * where the host placed it (or where this viewer pinned it) — over the
   * host's picture, which stays put so a cut back is instant; beside it; or
   * in the corner.
   */
  const phoneTile = phoneCameraRef.current ? <StageTile fill track={phoneCameraRef.current} label="Phone cam" /> : undefined;
  /** The phone has the host's own tile: the Set's face effects stand aside. */
  const phoneHasCell = Boolean(phoneTile) && placePhone(resolved.slot, resolved.layout).cell;
  /** The host's camera for the corner, when the phone takes their picture in Screen + face. */
  const hostFace = !hostFeeds.screen && hostFeeds.camera ? <StageTile fill track={hostCameraRef.current ?? undefined} label={hostName} /> : undefined;
  /** How many tiles share the frame with the host's: the others on stage, and the phone when it's placed beside them. */
  const tilesShown = (others: number) => tilesBeside(resolved.layout, others, phoneTile ? resolved.slot : "off", Boolean(opponent));

  /** Backstage, from my side: the mirror, the meter, the way out. */
  const backstagePanel = (
    <BackstagePanel
      video={localStageTrack}
      audio={localStageAudio}
      micOn={stageMicOn}
      onToggleMic={() => void toggleStageMic()}
      onLeave={() => void leaveStage()}
      busy={stageBusy}
    />
  );

  // ---- Mobile: full-screen immersive live view ----
  if (isMobileView) {
    const scene = stream.scene ?? DEFAULT_SCENE;
    const others = stageCells();
    const sharing = tilesShown(others.length) > 0;
    // A battle on an upright phone, TikTok's way: the two sides side by side
    // in a band under the header, the scoreboard and "Back" right under
    // them where a thumb reaches, the chat in what's left.
    const band = Boolean(opponent) && portraitScreen;
    return (
      <div
        className="fixed inset-0 z-[60] bg-black"
        style={{ "--band-top": "calc(max(env(safe-area-inset-top), 12px) + 98px)", "--band-h": "min(80vw, 40dvh)" } as CSSProperties}
      >
        {/* The program, drawn from the scene — full-bleed, and split along
            the screen's long axis: rows while upright, columns once the
            phone is turned (lib/stage-layout.ts). A battle's band splits
            into columns, whichever way the phone is held. */}
        <div className="absolute inset-0">
          <SceneRenderer
            scene={scene}
            portrait={band ? false : portraitScreen}
            forceAuto={Boolean(opponent)}
            layout={resolved.layout}
            phone={phoneTile}
            phoneSlot={resolved.slot}
            face={hostFace}
            stage={band ? { top: "var(--band-top)", height: "var(--band-h)" } : undefined}
            host={{ name: hostName, avatar: streamer.avatar }}
            mainLabel={hostName}
            main={
              <div className="relative size-full">
                <video
                  ref={videoElRef}
                  autoPlay
                  playsInline
                  className={cn(
                    "size-full",
                    // Portrait phones fill the frame; landscape feeds and a
                    // shared screen letterbox rather than lose their edges.
                    sharing || (feedPortrait && !hostFeeds.screen) ? "object-cover" : "object-contain"
                  )}
                />
              </div>
            }
            over={
              // The Set's gift effects, round the host's face — not over a shared screen or the phone cam.
              <GiftEffects
                set={activeSet}
                anchors={hostFeeds.screen || phoneHasCell ? null : anchorFeed}
                fit={sharing || (feedPortrait && !hostFeeds.screen) ? "cover" : "contain"}
                onReady={(handle) => {
                  effectsRef.current = handle;
                }}
              />
            }
            pip={
              hostFeeds.screen && hostFeeds.camera ? (
                <StageTile fill track={hostCameraRef.current ?? undefined} label={hostName} />
              ) : undefined
            }
            pipClassName="top-[132px] right-3"
            guests={others}
            goal={goal}
            heat={heat}
            brand={brand}
            hideRestricted={restrictedRegion !== false}
            // Graphics keep between the header and the chat lane — or, in a
            // battle's band, to the band.
            insets={
              band
                ? { top: "var(--band-top)", bottom: "calc(100dvh - var(--band-top) - var(--band-h))" }
                : { top: "124px", bottom: "calc(34dvh + 96px + env(safe-area-inset-bottom))" }
            }
          />
          <SetStinger set={activeSet} trigger={scene.layout} />
        </div>

        {radio && stream.isLive && <RadioCard name={hostName} avatar={streamer.avatar} onPicture={() => pickPicture(dataMode)} />}

        {/* Light falls off at the bottom, so the chat lane reads on any picture. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[56dvh] bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        {/* Gift banners ride above the chat lane, not over it. */}
        <GiftOverlay onReady={handleGiftOverlayReady} laneBottom="calc(34dvh + 96px + env(safe-area-inset-bottom))" />
        <FloatingHearts onReady={handleHeartsReady} />

        {/* Status overlays */}
        {hostAway
          ? brbCard
          : stream.isLive && (connected || rejoining) && !hasVideo && !radio && !playbackError && !stream.scene?.card && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="px-8 text-center">
                  <Spinner className="mx-auto size-7 text-white/70" />
                  <p className="mt-4 font-wide text-[17px] font-bold tracking-[-0.02em] text-white/85">
                    {rejoining ? "Reconnecting you…" : "Waiting for the broadcaster"}
                  </p>
                  <p className="mt-1 text-[13px] text-white/50">
                    {rejoining
                      ? "Your connection dropped — getting you back in."
                      : "The picture appears the moment they start sending."}
                  </p>
                </div>
              </div>
            )}
        {stream.isLive && playbackError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="px-8 text-center">
              <p className="font-wide text-[17px] font-bold tracking-[-0.02em] text-white/80">
                {playbackError}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Pill variant="primary" size="md" onClick={retryPlayback}>
                  {playingElsewhere ? "Watch here" : "Try again"}
                </Pill>
                <PillLink href="/explore" variant="glass" size="md">
                  Browse live streams
                </PillLink>
              </div>
            </div>
          </div>
        )}
        {!stream.isLive && !streamEnded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <p className="font-wide text-[17px] font-bold tracking-[-0.02em] text-white/70">
              This stream is offline
            </p>
          </div>
        )}

        {/* The battle's scoreboard: under the band while the sides are up,
            under the header while the result stays on after the clock. */}
        {battle && (isBattleActive(battle) || battle.status === "ended") && (
          <BattleBar
            battle={battle}
            streamId={id}
            onShare={setShareBattle}
            className={band ? "top-[calc(var(--band-top)+var(--band-h)+10px)]" : "top-[calc(var(--band-top)+4px)]"}
            // Like and share ride in the scoreboard's row while the band is
            // up — the side rail would climb over the totals on a short phone.
            actionsEnd={
              band && !preview.on ? (
                <>
                  {/* Icon-only: with Back and Their side, the row has to fit a 375px screen. */}
                  <Tip label={user && !liked ? "Like this stream" : "Send a heart"} side="bottom">
                    <button
                      type="button"
                      onClick={() => {
                        heartsRef.current?.push();
                        if (user && !liked) void toggleLike();
                      }}
                      aria-label={`${liked ? "Liked" : "Like"} · ${formatNumber(likeCount)}`}
                      className="press flex size-8 items-center justify-center rounded-full bg-control text-white hover:bg-control-hover"
                    >
                      <Heart size={15} weight="fill" className={liked ? "text-chili" : "text-white"} />
                    </button>
                  </Tip>
                  <Tip label={copied ? "Link copied" : "Share this stream"} side="bottom">
                    <button
                      type="button"
                      onClick={shareStream}
                      aria-label={copied ? "Link copied" : "Share this stream"}
                      className="press flex size-8 items-center justify-center rounded-full bg-control text-white hover:bg-control-hover"
                    >
                      {copied ? <Check size={15} weight="bold" /> : <ShareNetwork size={15} weight="fill" />}
                    </button>
                  </Tip>
                </>
              ) : undefined
            }
          />
        )}
        {shareBattle && <BattleResultSheet battle={shareBattle} streamId={id} onClose={() => setShareBattle(null)} />}

        {/* Light falls off at the top, so the bar reads on any picture. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-32 bg-gradient-to-b from-black/60 to-transparent" />

        {/* Top bar: who's on — face in its ring, name, allies, Ally — then
            the room's count and the way out. What's on sits under it. */}
        <div className="absolute inset-x-0 top-0 z-30 px-3 pt-[max(env(safe-area-inset-top),12px)]">
          <div className="flex items-center gap-2">
            <div className="obj flex min-w-0 items-center gap-2 rounded-full p-1">
              <Link href={`/c/${streamer.username}`} className="flex min-w-0 items-center gap-2 pr-1">
                <UserAvatar
                  src={streamer.avatar}
                  name={hostName}
                  size={30}
                  ring={stream.isLive ? "live" : "seen"}
                  ringGapClassName="bg-black"
                />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate font-wide text-[13.5px] font-bold tracking-[-0.02em] text-white">
                    {hostName}
                  </span>
                  <span className="block truncate text-[10.5px] text-white/65 tabular-nums">
                    {formatNumber(streamer.followers)} allies
                  </span>
                </span>
              </Link>
              {!isFollowing && allyButton("sm")}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {stream.isLive && (
                <Tip label="Picture quality and data saver" side="bottom">
                  <button
                    type="button"
                    onClick={() => setShowPicture(true)}
                    aria-label="Picture and data"
                    className={cn("obj press flex size-9 items-center justify-center rounded-full", pictureMode === "auto" ? "text-white" : "text-ember-hi")}
                  >
                    <PictureIcon mode={pictureMode} size={17} />
                  </button>
                </Tip>
              )}
              <Badge variant="glass" size="md" icon={<Eye size={13} />}>
                {formatNumber(connected ? viewerCount : stream.viewers)}
              </Badge>
              <Tip label="Leave stream" side="bottom">
                <button
                  onClick={() => router.push("/explore")}
                  aria-label="Leave stream"
                  className="obj press flex size-9 items-center justify-center rounded-full text-white"
                >
                  <X size={17} weight="bold" />
                </button>
              </Tip>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {stream.isLive && (preview.on ? <PracticeBadge /> : <LiveBadge size="md" />)}
            {stream.isLive && aiVoice && <AiVoiceBadge />}
            <Link href={`/browse?category=${encodeURIComponent(stream.category)}`} className="press min-w-0">
              <Badge variant="glass" size="md" className="max-w-[44vw] truncate">
                {stream.category}
              </Badge>
            </Link>
            {/* The room's leaders, TikTok-style: their faces up top, ranked,
                and the lists a tap away — gifters, and fans (watch time and
                chat count too). */}
            {(topGifters.length > 0 || topFans.length > 0) && (
              <Tip label={topGifters.length > 0 ? "See top gifters and fans" : "See top fans"} side="bottom" disabled={showGifters}>
                <button
                  type="button"
                  onClick={() => setShowGifters((v) => !v)}
                  data-tour="watch-top-gifters"
                  aria-expanded={showGifters}
                  aria-label={topGifters.length > 0 ? "Top gifters and fans" : "Top fans"}
                  className="press ml-auto flex shrink-0 -space-x-2 pb-1"
                >
                  {(topGifters.length > 0 ? topGifters : topFans).slice(0, 3).map((g, i) => (
                    <span key={g.userId ?? g.username} className="relative">
                      <UserAvatar src={g.avatar} name={g.displayName || g.username} size={28} className="size-7 ring-2 ring-black" />
                      <span
                        className={cn(
                          "absolute -bottom-1 left-1/2 flex h-3.5 min-w-3.5 -translate-x-1/2 items-center justify-center rounded-full px-0.5 font-mono text-[8.5px] font-bold ring-2 ring-black",
                          i === 0 ? (topGifters.length > 0 ? "bg-value text-[#1b1406]" : "bg-ember text-on-ember") : "bg-white text-[#0b0708]"
                        )}
                      >
                        {i + 1}
                      </span>
                    </span>
                  ))}
                </button>
              </Tip>
            )}
          </div>
          {showGifters && (topGifters.length > 0 || topFans.length > 0) && (
            <div className="mt-2 ml-auto max-h-[60dvh] w-[min(270px,calc(100vw-24px))] animate-in overflow-y-auto rounded-[16px] bg-black/90 p-1.5 duration-200 fade-in slide-in-from-top-1">
              {topGifters.length > 0 && (
                <>
                  <p className="flex items-center gap-1.5 px-2 pt-1.5 pb-2 text-[11px] font-semibold tracking-wide text-white/60 uppercase">
                    <Crown size={12} weight="fill" className="text-value" />
                    Top gifters
                  </p>
                  {topGifters.slice(0, 5).map((g, i) => (
                    <Link
                      key={g.userId ?? g.username}
                      href={`/c/${g.username}`}
                      className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-white/10"
                    >
                      <span className={cn("w-3 text-center font-mono text-[11px] font-bold", i === 0 ? "text-value" : "text-white/55")}>{i + 1}</span>
                      <UserAvatar src={g.avatar} name={g.displayName || g.username} size={28} className="size-7" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">{g.displayName || g.username}</span>
                      <span className="font-mono text-[12px] font-semibold text-value tabular-nums">{centsToDollars(g.totalUsdMinor)}</span>
                    </Link>
                  ))}
                </>
              )}
              {topFans.length > 0 && (
                <>
                  <p
                    className={cn(
                      "flex items-center gap-1.5 px-2 pb-2 text-[11px] font-semibold tracking-wide text-white/60 uppercase",
                      topGifters.length > 0 ? "mt-1.5 border-t border-white/10 pt-2.5" : "pt-1.5"
                    )}
                  >
                    <Heart size={11} weight="fill" className="text-ember-hi" />
                    Top fans
                    <span className="ml-auto font-medium tracking-normal normal-case">watching, chatting, gifting</span>
                  </p>
                  {topFans.slice(0, 5).map((f, i) => (
                    <Link
                      key={f.userId}
                      href={`/c/${f.username}`}
                      className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-white/10"
                    >
                      <span className={cn("w-3 text-center font-mono text-[11px] font-bold", i === 0 ? "text-ember-hi" : "text-white/55")}>{i + 1}</span>
                      <UserAvatar src={f.avatar} name={f.displayName} size={28} className="size-7" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-white">{f.displayName}</span>
                        <span className="block truncate text-[11px] text-white/55 tabular-nums">
                          {[
                            f.minutes > 0 && (f.minutes >= 60 ? `${Math.floor(f.minutes / 60)}h ${String(f.minutes % 60).padStart(2, "0")}m watched` : `${f.minutes}m watched`),
                            f.chats > 0 && `${f.chats} ${f.chats === 1 ? "message" : "messages"}`,
                            f.giftsMinor > 0 && `${centsToDollars(f.giftsMinor)} gifted`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="flex items-center gap-0.5 font-mono text-[12px] font-semibold text-ember-hi tabular-nums">
                        <Heart size={9} weight="fill" aria-hidden />
                        {f.score.toLocaleString("en-US")}
                      </span>
                    </Link>
                  ))}
                  {myFan && myFan.level > 0 && (
                    <p className="mx-1 mt-1.5 rounded-[10px] bg-ember/15 px-2.5 py-2 text-[12px] font-semibold text-ember-hi">
                      You&apos;re level {myFan.level} with {hostName} · {myFan.hours}h watched
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Why asking to join didn't go through — the request line's rules, a full list. */}
        {stageError && (
          <p
            role="status"
            className="animate-fade-in absolute top-[max(env(safe-area-inset-top),12px)] left-1/2 z-40 mt-40 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 rounded-[14px] bg-black/75 px-4 py-2.5 text-center text-[13px] leading-snug font-semibold text-white"
          >
            {stageError}
          </p>
        )}

        {/* Unmute — the one control that never hides. */}
        {muted && stream.isLive && hasVideo && !playbackError && !viewerView && (
          <button
            onClick={toggleMute}
            className="obj-on press absolute top-[max(env(safe-area-inset-top),12px)] left-1/2 z-40 mt-24 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold"
          >
            <SpeakerSlash size={16} weight="fill" />
            Tap to unmute
          </button>
        )}

        {/* Right action rail — above the chat layer, which is painted after
            it and would otherwise sit over these buttons. */}
        <div className="absolute right-2.5 bottom-[calc(max(env(safe-area-inset-bottom),10px)+76px)] z-40 flex flex-col items-center gap-3.5">
          {/* A sponsored quest on the card that's up: your minutes, a tap from the prize. */}
          {sponsorShown && sponsoredQuest.quest && (
            <RailButton
              title={`${sponsorShown.name} sponsored quest`}
              label={
                !user
                  ? "Quest"
                  : sponsoredQuest.quest.voucher
                    ? "Won"
                    : sponsoredQuest.quest.progress >= sponsoredQuest.quest.minutes
                      ? "Claim"
                      : `${sponsoredQuest.quest.progress}/${sponsoredQuest.quest.minutes}`
              }
              tone={!sponsoredQuest.quest.voucher && sponsoredQuest.quest.progress >= sponsoredQuest.quest.minutes ? "ember" : "obj"}
              onClick={() => setShowQuest(true)}
              icon={<Ticket size={22} weight="fill" />}
            />
          )}
          {/* In a battle's band these two ride in the scoreboard instead. A preview has neither. */}
          {!band && !preview.on && (
            <>
              <RailButton
                title={liked ? "Liked" : "Like"}
                label={likeCount > 0 ? formatNumber(likeCount) : "Like"}
                onClick={() => {
                  heartsRef.current?.push();
                  if (user && !liked) void toggleLike();
                }}
                icon={<Heart size={23} weight="fill" className={liked ? "text-chili" : "text-white"} />}
              />
              <RailButton
                title="Share this stream"
                label={copied ? "Copied" : "Share"}
                onClick={shareStream}
                icon={copied ? <Check size={21} weight="bold" /> : <ShareNetwork size={22} weight="fill" />}
              />
            </>
          )}
          {user && !isOwner && stream.isLive && connected && (stageState !== "idle" || lineOpen) && (
            stageState === "idle" ? (
              <RailButton
                title="Ask to join the stream"
                label="Join"
                onClick={requestStage}
                disabled={stageBusy}
                icon={<UsersThree size={22} weight="fill" />}
              />
            ) : stageState === "requested" ? (
              <RailButton
                title="Waiting for the host — tap to cancel"
                label="Asked"
                tone="ember"
                pulse
                onClick={cancelStageRequest}
                disabled={stageBusy}
                icon={<Clock size={22} weight="bold" />}
              />
            ) : stageState === "backstage" ? (
              <RailButton
                title="You're backstage — tap to check your camera and mic"
                label="Backstage"
                tone="ember"
                pulse
                onClick={() => setBackstageOpen(true)}
                icon={<VideoCamera size={22} weight="fill" />}
              />
            ) : (
              <>
                <RailButton
                  title={stageMicOn ? "Mute your mic" : "Unmute your mic"}
                  label={stageMicOn ? "Mic" : "Muted"}
                  tone={stageMicOn ? "obj" : "chili"}
                  onClick={toggleStageMic}
                  icon={stageMicOn ? <Microphone size={22} weight="fill" /> : <MicrophoneSlash size={22} weight="fill" />}
                />
                <RailButton
                  title="Leave the stage"
                  label="Leave"
                  tone="chili"
                  onClick={leaveStage}
                  disabled={stageBusy}
                  icon={<SignOut size={22} weight="bold" />}
                />
              </>
            )
          )}
          {isOwner && !viewerView && stream.isLive && (
            <RailButton
              title="Stage requests"
              label="Stage"
              badge={hostRequests.length}
              onClick={() => setShowStageSheet(true)}
              icon={<HandWaving size={22} weight="fill" />}
            />
          )}
        </div>

        {/* Chat overlay + input. The wrapper takes no taps of its own — its
            right padding covers the action rail's column, and a full-width
            box there swallowed Like, Share and Ask-to-join on phones (Greg,
            2026-09-22). LiveChat's overlay pieces opt back in one by one. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3 pr-16 pb-[max(env(safe-area-inset-bottom),10px)]",
            // In a battle the chat takes what's left under the scoreboard.
            band && "top-[calc(var(--band-top)+var(--band-h)+132px)]"
          )}
        >
          <div className={band ? "h-full" : "h-[46dvh]"}>
            <LiveChat
              streamId={id}
              room={roomRef.current}
              isLive={stream.isLive}
              isHost={isOwner && !viewerView}
              initialPinned={stream.pinnedMessage ?? null}
                  topGifters={topGifters}
                  topFans={topFans}
                  myFan={myFan}
                  hostUsername={streamer.username}
                  watchOnly={preview.on}
              variant="overlay"
            />
          </div>
        </div>

        {/* The sponsor and its quest: a sheet from the bottom. */}
        {showQuest && sponsorShown && (
          <div className="animate-fade-in fixed inset-0 z-[70] flex items-end bg-black/70" onClick={() => setShowQuest(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${sponsorShown.name} — paid promotion`}
              className="sheet-obj w-full rounded-t-[24px] px-3 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <SponsorPanel
                sponsor={sponsorShown}
                quest={sponsoredQuest.quest}
                signedIn={Boolean(user)}
                claiming={sponsoredQuest.claiming}
                error={sponsoredQuest.error}
                onClaim={() => void sponsoredQuest.claim()}
                className="bg-transparent p-2"
              />
            </div>
          </div>
        )}

        {/* Picture and data: a sheet from the bottom. */}
        {showPicture && (
          <div className="animate-fade-in fixed inset-0 z-[70] flex items-end bg-black/70" onClick={() => setShowPicture(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="picture-sheet-title"
              className="sheet-obj w-full rounded-t-[24px] px-3 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <h3 id="picture-sheet-title" className="mb-2 px-3 font-wide text-[18px] font-bold tracking-[-0.02em] text-foreground">
                Picture
              </h3>
              <PictureMenu mode={pictureMode} onPick={pickPicture}>
                {phoneAvailable && <AnglePicker pick={anglePick} onPick={(p) => setAnglePick(id, p)} phoneAvailable />}
              </PictureMenu>
            </div>
          </div>
        )}

        {/* Backstage: my camera and mic, checked — a sheet from the bottom.
            Closing it keeps me backstage; the rail's Backstage brings it back. */}
        {stageState === "backstage" && backstageOpen && (
          <div className="animate-fade-in fixed inset-0 z-[70] flex items-end bg-black/70" onClick={() => setBackstageOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="backstage-title"
              className="sheet-obj max-h-[85dvh] w-full overflow-y-auto rounded-t-[24px] px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              {backstagePanel}
            </div>
          </div>
        )}

        {/* Host stage sheet */}
        {showStageSheet && (
          <div
            className="animate-fade-in fixed inset-0 z-[70] flex items-end bg-black/70"
            onClick={() => setShowStageSheet(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="stage-sheet-title"
              className="sheet-obj max-h-[70dvh] w-full overflow-y-auto rounded-t-[24px] px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 id="stage-sheet-title" className="font-wide text-[18px] font-bold tracking-[-0.02em] text-foreground">
                  Stage
                </h3>
                <Badge variant="muted" size="sm">
                  {hostLiveGuests.length} of 3 on stage
                </Badge>
              </div>

              {hostLiveGuests.length > 0 && (
                <div className="mb-5">
                  <p className={cn(EYEBROW, "mb-2")}>On stage</p>
                  <div className="flex flex-col gap-1.5">
                    {hostLiveGuests.map((g) => (
                      <div
                        key={g.userId}
                        className="flex items-center gap-3 rounded-[14px] bg-white/[0.05] py-2 pr-2 pl-2.5"
                      >
                        <UserAvatar src={g.avatar} name={g.username} size={32} ring="live" ringGapClassName="bg-surface" />
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                          {g.username}
                        </p>
                        <Pill
                          size="sm"
                          variant="soft"
                          tone="red"
                          icon={<X size={13} weight="bold" />}
                          onClick={() => hostRemove(g.userId)}
                          disabled={hostStageBusy !== null}
                        >
                          Remove
                        </Pill>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Accepted and publishing, seen by the crew only, until they're brought on. */}
              {hostBackstageGuests.length > 0 && (
                <div className="mb-5">
                  <p className={cn(EYEBROW, "mb-2 flex items-center gap-1.5")}>
                    <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-ember" />
                    Backstage
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {hostBackstageGuests.map((g) => (
                      <div
                        key={g.userId}
                        className="flex items-center gap-3 rounded-[14px] bg-white/[0.05] py-2 pr-2 pl-2.5"
                      >
                        <UserAvatar src={g.avatar} name={g.username} size={32} />
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                          {g.username}
                        </p>
                        <Pill
                          size="sm"
                          variant="primary"
                          icon={
                            hostStageBusy === g.userId ? (
                              <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
                            ) : (
                              <Check size={13} weight="bold" />
                            )
                          }
                          onClick={() => hostApprove(g.userId)}
                          disabled={hostStageBusy !== null || hostLiveGuests.length >= 3}
                          title={hostLiveGuests.length >= 3 ? "The stage is full" : "Bring them on"}
                        >
                          Bring on
                        </Pill>
                        <Tip label="Remove from backstage">
                          <Pill
                            size="sm"
                            variant="glass"
                            iconOnly
                            icon={<X size={14} weight="bold" />}
                            aria-label={`Remove ${g.username} from backstage`}
                            onClick={() => hostRemove(g.userId)}
                            disabled={hostStageBusy !== null}
                          />
                        </Tip>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className={cn(EYEBROW, "mb-2")}>Asking to join</p>
              {hostRequests.length === 0 ? (
                <p className="rounded-[14px] bg-white/[0.03] py-5 text-center text-[13px] text-muted-foreground">
                  No one is asking to join right now.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {hostRequests.map((r) => (
                    <div
                      key={r.userId}
                      className="flex items-center gap-2 rounded-[14px] bg-white/[0.05] py-2 pr-2 pl-2.5"
                    >
                      <UserAvatar src={r.avatar} name={r.username} size={32} />
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                        {r.username}
                      </p>
                      <Pill
                        size="sm"
                        variant="primary"
                        icon={
                          hostStageBusy === r.userId ? (
                            <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
                          ) : (
                            <Check size={13} weight="bold" />
                          )
                        }
                        onClick={() => hostApprove(r.userId)}
                        disabled={hostStageBusy !== null || hostLiveGuests.length >= 3}
                      >
                        Accept
                      </Pill>
                      {/* The wings: they set up their camera and mic where only the crew sees. */}
                      <Pill
                        size="sm"
                        variant="glass"
                        onClick={() => hostSendBackstage(r.userId)}
                        disabled={hostStageBusy !== null || hostBackstageGuests.length >= 4}
                        title={hostBackstageGuests.length >= 4 ? "Backstage is full" : "Let them get set up backstage first"}
                      >
                        Backstage
                      </Pill>
                      <Tip label="Decline their request">
                        <Pill
                          size="sm"
                          variant="glass"
                          iconOnly
                          icon={<X size={14} weight="bold" />}
                          aria-label={`Decline ${r.username}`}
                          onClick={() => hostDeny(r.userId)}
                          disabled={hostStageBusy !== null}
                        />
                      </Tip>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {mergeOverlay}
        {endedOverlay}
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-0">
      <div className="flex flex-col lg:h-[calc(100vh-3.5rem)] lg:flex-row">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {/* Video player */}
          <div
            className={cn(
              "relative w-full bg-black",
              isFullscreen && "flex",
              theaterMode
                ? "aspect-video lg:aspect-auto lg:h-[85vh]"
                : "aspect-video",
              !controlsVisible && stream.isLive && "cursor-none"
            )}
            ref={videoContainerRef}
            onMouseMove={showControls}
            onTouchStart={showControls}
          >
            {/* h-full: without it the stage is only as tall as the video's
                own picture — 150px before the first frame — and the controls
                pinned to its bottom float halfway up the player. */}
            <div className="relative h-full min-w-0 flex-1">
            {/* The program, drawn from the scene: the host — their screen
                when they share one, camera in the corner — the guests and a
                battle's other side as the layout allows, and any card over
                the lot. The main video element keeps its place across
                layout changes, so the track never re-attaches. */}
            {(() => {
              const scene = stream.scene ?? DEFAULT_SCENE;
              const others = stageCells();
              const sharing = tilesShown(others.length) > 0;
              return (
                <SceneRenderer
                  scene={scene}
                  // The desktop player is always wider than it is tall.
                  portrait={false}
                  forceAuto={Boolean(opponent)}
                  layout={resolved.layout}
                  phone={phoneTile}
                  phoneSlot={resolved.slot}
                  face={hostFace}
                  host={{ name: hostName, avatar: streamer.avatar }}
                  mainLabel={hostName}
                  main={
                    <div className="relative size-full">
                      <video
                        ref={videoElRef}
                        autoPlay
                        playsInline
                        className={cn("size-full", sharing ? "object-cover" : "object-contain")}
                      />
                    </div>
                  }
                  over={
                    // The Set's gift effects, round the host's face — not over a shared screen or the phone cam.
                    <GiftEffects
                      set={activeSet}
                      anchors={hostFeeds.screen || phoneHasCell ? null : anchorFeed}
                      fit={sharing ? "cover" : "contain"}
                      onReady={(handle) => {
                        effectsRef.current = handle;
                      }}
                    />
                  }
                  pip={
                    hostFeeds.screen && hostFeeds.camera ? (
                      <StageTile fill track={hostCameraRef.current ?? undefined} label={hostName} />
                    ) : undefined
                  }
                  pipClassName="top-14 right-3"
                  guests={others}
                  // A 2v2's four tiles start under the scoreboard's strip,
                  // so the top two keep their faces.
                  stage={pairOpponent ? { top: "92px", height: "calc(100% - 92px)" } : undefined}
                  goal={goal}
                  heat={heat}
                  brand={brand}
                  hideRestricted={restrictedRegion !== false}
                  // Clear of the badges and controls while they show (and of
                  // "Turn sound on", which never hides); the frame's own
                  // edges once they fade.
                  insets={{
                    top: chromeShown || muted ? "52px" : "0px",
                    bottom: chromeShown ? "60px" : "0px",
                  }}
                />
              );
            })()}
            <SetStinger set={activeSet} trigger={(stream.scene ?? DEFAULT_SCENE).layout} />

            {/* Radio: the sound without the picture. */}
            {radio && stream.isLive && <RadioCard name={hostName} avatar={streamer.avatar} onPicture={() => pickPicture(dataMode)} />}

            {/* Gift spectacle layer */}
            <GiftOverlay onReady={handleGiftOverlayReady} />

            {/* The battle scoreboard, while a battle is on or just ended. */}
            {battle && (isBattleActive(battle) || battle.status === "ended") && (
              <BattleBar battle={battle} streamId={id} onShare={setShareBattle} />
            )}
            {shareBattle && <BattleResultSheet battle={shareBattle} streamId={id} onClose={() => setShareBattle(null)} />}

            {/* Muted-start affordance — the one control that must never hide */}
            {muted && stream.isLive && hasVideo && !playbackError && !viewerView && (
              <button
                onClick={toggleMute}
                className="obj-on press absolute top-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold"
              >
                <SpeakerSlash size={16} weight="fill" />
                Turn sound on
              </button>
            )}

            {/* Offline fallback */}
            {!stream.isLive && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="text-center">
                  <p className="font-wide text-[19px] font-bold tracking-[-0.02em] text-white/75">
                    Stream ended
                  </p>
                  <p className="mt-1 text-sm text-white/45">
                    This stream is no longer live
                  </p>
                </div>
              </div>
            )}

            {/* The host's feed dropped and the stream is holding for it —
                "Be right back". Otherwise: live and joined, but nothing is
                being published yet — the normal state for an OBS stream
                between getting the key and the encoder connecting — or this
                viewer is on the way back in after their own drop. */}
            {hostAway
              ? brbCard
              : stream.isLive && (connected || rejoining) && !hasVideo && !radio && !playbackError && !stream.scene?.card && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <div className="px-6 text-center">
                      <Spinner className="mx-auto size-7 text-white/70" />
                      <p className="mt-4 font-wide text-[19px] font-bold tracking-[-0.02em] text-white/85">
                        {rejoining ? "Reconnecting you…" : "Waiting for the broadcaster"}
                      </p>
                      <p className="mt-1 text-sm text-white/50">
                        {rejoining
                          ? "Your connection dropped — getting you back in."
                          : "The video appears here the moment they start sending."}
                      </p>
                    </div>
                  </div>
                )}

            {/* Flagged live, but we couldn't join the room — or lost it */}
            {stream.isLive && playbackError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="px-6 text-center">
                  <p className="font-wide text-[19px] font-bold tracking-[-0.02em] text-white/80">
                    {playbackError}
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Pill variant="primary" size="md" onClick={retryPlayback}>
                      {playingElsewhere ? "Watch here" : "Try again"}
                    </Pill>
                    <PillLink href="/explore" variant="glass" size="md">
                      Browse live streams
                    </PillLink>
                  </div>
                </div>
              </div>
            )}

            {/* Stream overlay info */}
            <div
              className={cn(
                "absolute top-4 left-4 flex items-center gap-1.5 transition-opacity duration-300",
                !controlsVisible && stream.isLive && "opacity-0"
              )}
            >
              {stream.isLive && (preview.on ? <PracticeBadge /> : <LiveBadge size="md" />)}
              {stream.isLive && aiVoice && <AiVoiceBadge />}
              <Badge variant="glass" size="md" icon={<Eye size={14} />}>
                {stream.isLive
                  ? // Prefer the room roster once we're actually in the room;
                    // until then (or if the join failed) the server's last
                    // known count beats showing a confident "0 watching".
                    `${formatNumber(connected ? viewerCount : stream.viewers)} watching`
                  : // `viewers` is the live concurrent count and is 0 for an
                    // ended stream; peak is what actually describes it.
                    `${formatNumber(stream.peakViewers ?? 0)} peak`}
              </Badge>
              {stream.isLive && (
                <Badge variant="glass" size="md" icon={<Clock size={14} />} className="font-mono">
                  {elapsed}
                </Badge>
              )}
              {stream.isLive &&
                (connQuality === "poor" || connQuality === "lost") && (
                  <Badge variant="glass" size="md" icon={<CellSignalLow size={14} weight="fill" />} className="text-ember-hi">
                    Weak connection
                  </Badge>
                )}
            </div>

            {/* Volume controls */}
            <div
              className={cn(
                "obj absolute bottom-4 left-4 z-20 flex h-10 items-center gap-1.5 rounded-full pr-4 pl-1 transition-all duration-300",
                !controlsVisible && stream.isLive && "pointer-events-none opacity-0"
              )}
            >
              <Tip label={muted ? "Unmute" : "Mute"} hint="M">
                <button
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                  className="press flex size-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
                </button>
              </Tip>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 w-20 cursor-pointer accent-white"
              />
            </div>

            {/* Player buttons: picture and data, PiP, theater, fullscreen */}
            <div
              className={cn(
                "absolute right-4 bottom-4 flex items-center gap-2 transition-all duration-300",
                !controlsVisible && stream.isLive && !showPicture && "pointer-events-none opacity-0"
              )}
            >
              {stream.isLive && (
                <div className="relative">
                  <Tip label="Picture quality and data saver" disabled={showPicture}>
                    <button
                      onClick={() => setShowPicture((v) => !v)}
                      aria-expanded={showPicture}
                      className={playerButton(pictureMode !== "auto")}
                      aria-label="Picture and data"
                    >
                      <PictureIcon mode={pictureMode} />
                    </button>
                  </Tip>
                  {showPicture && (
                    <div className="absolute right-0 bottom-full z-30 mb-2 w-[320px] animate-in rounded-[16px] bg-black/90 p-1.5 duration-200 fade-in slide-in-from-bottom-1">
                      <p className="px-3 pt-2 pb-1.5 text-[11px] font-semibold tracking-wide text-white/60 uppercase">Picture</p>
                      <PictureMenu mode={pictureMode} onPick={pickPicture}>
                {phoneAvailable && <AnglePicker pick={anglePick} onPick={(p) => setAnglePick(id, p)} phoneAvailable />}
              </PictureMenu>
                    </div>
                  )}
                </div>
              )}
              <Tip label="Pop out the player" hint="P">
                <button
                  onClick={() => void togglePiP()}
                  className={playerButton()}
                  aria-label="Picture in picture"
                >
                  <PictureInPicture size={18} />
                </button>
              </Tip>
              <Tip label={theaterMode ? "Exit theater mode" : "Theater mode"} hint="T">
                <button
                  onClick={toggleTheater}
                  aria-pressed={theaterMode}
                  className={cn(playerButton(theaterMode), "hidden lg:flex")}
                  aria-label="Theater mode"
                >
                  <Sidebar size={18} />
                </button>
              </Tip>
              <Tip label={isFullscreen ? "Exit fullscreen" : "Go fullscreen"} hint="F">
                <button
                  onClick={toggleFullscreen}
                  aria-pressed={isFullscreen}
                  className={playerButton(isFullscreen)}
                  aria-label="Fullscreen"
                >
                  <CornersOut size={18} />
                </button>
              </Tip>
              {isFullscreen && (
                <Tip label={fsChat ? "Hide chat" : "Show chat"} hint="C">
                  <button
                    onClick={() => setFsChat((v) => !v)}
                    aria-pressed={fsChat}
                    className={playerButton(fsChat)}
                    aria-label="Chat"
                  >
                    <ChatCircleDots size={18} weight={fsChat ? "fill" : "regular"} />
                  </button>
                </Tip>
              )}
            </div>
            </div>

            {/* Fullscreen chat rail — a full-height column beside the video. */}
            {isFullscreen && fsChat && (
              <aside className="h-full w-[380px] shrink-0 bg-background">
                <LiveChat
                  streamId={id}
                  room={roomRef.current}
                  isLive={stream.isLive}
                  initialPinned={stream.pinnedMessage ?? null}
                  topGifters={topGifters}
                  topFans={topFans}
                  myFan={myFan}
                  hostUsername={streamer.username}
                  watchOnly={preview.on}
                />
              </aside>
            )}
          </div>

          {/* Chat beneath the player, when the viewer has put it there */}
          {chatPlacement === "below" && !theaterMode && !isFullscreen && (
            <div className="mx-4 mt-4 hidden h-[440px] overflow-hidden rounded-panel bg-surface md:mx-6 lg:block">
              <LiveChat
                streamId={id}
                room={roomRef.current}
                isLive={stream.isLive}
                initialPinned={stream.pinnedMessage ?? null}
                  topGifters={topGifters}
                  topFans={topFans}
                  myFan={myFan}
                  hostUsername={streamer.username}
                  watchOnly={preview.on}
              />
            </div>
          )}

          {/* Stream info below player. A container: the column is ~380px
              beside a wide rail at 1024 and ~730px at 1440, so the rows
              below size to it, not to the window. */}
          <div className="@container px-4 pt-5 pb-10 md:px-6">
            {/* Backstage: my camera and mic, checked, right under the picture
                I'm waiting to join. The Backstage pill folds it away. */}
            {stageState === "backstage" && backstageOpen && (
              <div className="mb-5 rounded-[12px] bg-surface p-4">{backstagePanel}</div>
            )}
            <h1 className="font-wide text-[21px] leading-tight font-bold tracking-[-0.025em] text-balance text-foreground sm:text-[24px]">
              {stream.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <Link href={`/browse?category=${encodeURIComponent(stream.category)}`} className="press mr-1">
                <Badge variant="muted" size="md" className="transition-colors hover:bg-white/[0.1] hover:text-foreground">
                  {stream.category}
                </Badge>
              </Link>
              {sponsorOnAir && (
                // The disclosure stands even where the card itself can't be shown.
                <span
                  title={`${hostName} is paid to promote ${sponsorOnAir.name}`}
                  className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 text-xs font-semibold text-foreground/85"
                >
                  <Info size={13} className="text-muted-foreground" />
                  Includes paid promotion
                </span>
              )}
              {stream.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/browse?tab=live&tag=${encodeURIComponent(tag)}`}
                  className="press rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  #{tag}
                </Link>
              ))}
            </div>

            {/* The host and everything you can do here, on one row. The host
                links to the channel: it's the one place on the page that
                names them, so it has to reach everything else they've
                streamed. */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
              <div className="flex min-w-0 items-center gap-4">
                <Link href={`/c/${streamer.username}`} className="group flex min-w-0 items-center gap-3">
                  <UserAvatar
                    src={streamer.avatar}
                    name={hostName}
                    size={46}
                    ring={stream.isLive ? "live" : "seen"}
                    className="transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate font-wide text-[16px] font-bold tracking-[-0.02em] text-foreground">
                      {hostName}
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground tabular-nums">
                      {formatNumber(streamer.followers)} allies
                    </span>
                  </span>
                </Link>
                {allyButton("md")}
                {!preview.on && <MessageButton username={streamer.username} name={hostName} context={streamContext(stream)} />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {user &&
                  !isOwner &&
                  stream.isLive &&
                  connected &&
                  (stageState !== "idle" || lineOpen) &&
                  (stageState === "idle" ? (
                    <Pill
                      variant="ember"
                      icon={<UsersThree size={16} weight="fill" />}
                      onClick={requestStage}
                      disabled={stageBusy}
                      title="Ask to join this stream with your camera"
                    >
                      Join stream
                    </Pill>
                  ) : stageState === "requested" ? (
                    <Pill
                      variant="soft"
                      tone="ember"
                      icon={<Clock size={16} />}
                      onClick={cancelStageRequest}
                      disabled={stageBusy}
                      title="Waiting for the host — click to cancel"
                    >
                      Asked to join…
                    </Pill>
                  ) : stageState === "backstage" ? (
                    <Pill
                      variant="soft"
                      tone="ember"
                      icon={<VideoCamera size={16} />}
                      onClick={() => setBackstageOpen((v) => !v)}
                      aria-expanded={backstageOpen}
                      title="You're backstage — the host can see and hear you; viewers can't"
                    >
                      Backstage
                    </Pill>
                  ) : (
                    <>
                      <Pill
                        variant="soft"
                        tone={stageMicOn ? "green" : "red"}
                        icon={stageMicOn ? <Microphone size={16} /> : <MicrophoneSlash size={16} />}
                        onClick={toggleStageMic}
                        title={stageMicOn ? "Mute your mic" : "Unmute your mic"}
                      >
                        {stageMicOn ? "Mic on" : "Muted"}
                      </Pill>
                      <Pill variant="soft" tone="red" icon={<SignOut size={16} />} onClick={leaveStage} disabled={stageBusy}>
                        Leave stage
                      </Pill>
                    </>
                  ))}
                {!preview.on && (
                  <>
                    <Pill
                      variant={liked ? "soft" : "glass"}
                      tone="red"
                      icon={<Heart size={16} weight={liked ? "fill" : "regular"} />}
                      onClick={toggleLike}
                      disabled={!user || likeBusy}
                      aria-pressed={liked}
                      title={user ? (liked ? "Unlike" : "Like") : "Sign in to like"}
                    >
                      {likeCount > 0 ? formatNumber(likeCount) : "Like"}
                    </Pill>
                    <Pill
                      variant="glass"
                      icon={copied ? <Check size={16} weight="bold" /> : <ShareNetwork size={16} />}
                      onClick={shareStream}
                    >
                      {copied ? "Link copied" : "Share"}
                    </Pill>
                  </>
                )}
                <Pill
                  variant="glass"
                  icon={<Sidebar size={16} />}
                  onClick={() => setChatPlacement((p) => (p === "side" ? "below" : "side"))}
                  aria-pressed={chatPlacement === "below"}
                  title={chatPlacement === "below" ? "Move chat beside the player" : "Move chat below the player"}
                  className="hidden lg:inline-flex"
                >
                  {chatPlacement === "below" ? "Chat beside" : "Chat below"}
                </Pill>
                {user && !isOwner && (
                  <Tip label="Report stream">
                    <Pill
                      variant="ghost"
                      iconOnly
                      icon={<Flag size={16} />}
                      aria-label="Report stream"
                      onClick={() => {
                        setReportReason("");
                        setReportDetails("");
                        setReportDone(false);
                        setReportError(null);
                        setShowReport(true);
                      }}
                    />
                  </Tip>
                )}
              </div>
            </div>

            {followError && <p className="mt-3 text-xs text-chili-hi">{followError}</p>}
            {stageError && <p className="mt-3 text-xs text-ember-hi">{stageError}</p>}

            {sponsorShown && (
              <SponsorPanel
                sponsor={sponsorShown}
                quest={sponsoredQuest.quest}
                signedIn={Boolean(user)}
                claiming={sponsoredQuest.claiming}
                error={sponsoredQuest.error}
                onClaim={() => void sponsoredQuest.claim()}
                className="mt-6"
              />
            )}

            <p className="mt-6 flex max-w-[72ch] gap-2 text-[12px] leading-relaxed text-muted-foreground/65">
              <Info size={14} className="mt-[3px] shrink-0" />
              <span>
                Content is creator opinion, not financial advice. Crypto assets
                are volatile — always do your own research. Tips are voluntary
                gifts to the creator, not investments.
              </span>
            </p>

            {/* The host's next broadcasts, with live countdowns. (The top
                gifters moved into the chat, where the room reads them.) */}
            {hostUpcoming.length > 0 && (
              <section aria-labelledby="watch-schedule" className="mt-10 min-w-0">
                <h2 id="watch-schedule" className={SECTION_TITLE}>
                  <CalendarBlank size={17} weight="bold" className="shrink-0 text-muted-foreground" />
                  <span className="truncate">Coming up</span>
                </h2>
                <ScheduleList items={hostUpcoming} />
              </section>
            )}

            {/* Then what this audience also watches — always there, no tab. */}
            <div className="mt-10">
              {alsoLive.length > 0 ? (
                <Shelf
                  id="watch-also"
                  title="Viewers also watch"
                  reason={`People who watch ${streamer.displayName} also watch these channels`}
                >
                  {alsoLive.map((item, slot) => (
                    <StreamCard
                      key={item._id}
                      stream={toCard(item)}
                      variant="badges"
                      impression={{ streamId: item._id, surface: "watch", row: "also-live", slot }}
                    />
                  ))}
                </Shelf>
              ) : (
                <p className="rounded-[16px] bg-surface px-6 py-8 text-center text-sm text-muted-foreground">
                  Nothing else this audience watches is live right now.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Chat sidebar */}
        <div
          className={cn(
            "h-[500px] shrink-0 lg:h-[calc(100vh-3.5rem)] lg:w-80 xl:w-96",
            (theaterMode || chatPlacement === "below") && "lg:hidden"
          )}
        >
          {/* One chat at a time: while fullscreen it lives in the rail inside the player. */}
          {!isFullscreen && (
            <div className="flex h-full flex-col">
              {/* The prediction stacks above chat, never over the video. */}
              {game && !preview.on && <PlayPanel game={game} onChange={setGame} />}
              <div className="min-h-0 flex-1">
                <LiveChat
                  streamId={id}
                  room={roomRef.current}
                  isLive={stream.isLive}
                  initialPinned={stream.pinnedMessage ?? null}
                  topGifters={topGifters}
                  topFans={topFans}
                  myFan={myFan}
                  hostUsername={streamer.username}
                  watchOnly={preview.on}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Report modal */}
      {showReport && (
        <div
          className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 sm:items-start sm:p-6"
          onClick={() => setShowReport(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-title"
            className="w-full rounded-t-[26px] bg-surface-raised p-6 pb-[max(env(safe-area-inset-bottom),24px)] shadow-overlay sm:my-auto sm:max-w-[480px] sm:rounded-[26px] sm:p-7"
            onClick={(e) => e.stopPropagation()}
          >
            {reportDone ? (
              <div className="py-2 text-center">
                <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#173428] text-[#86EFAC]">
                  <Check size={26} weight="bold" />
                </span>
                <h2 id="report-title" className="mt-4 font-wide text-[21px] font-bold tracking-[-0.025em] text-foreground">
                  Report sent
                </h2>
                <p className="mx-auto mt-1.5 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
                  Thanks for helping keep Xtream safe. A moderator will review
                  this stream.
                </p>
                <Pill variant="primary" size="lg" className="mt-6 w-full" onClick={() => setShowReport(false)}>
                  Done
                </Pill>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className={EYEBROW}>{hostName}</p>
                    <h2 id="report-title" className="mt-1 font-wide text-[21px] font-bold tracking-[-0.025em] text-foreground">
                      Report this stream
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Pick the reason that fits best.
                    </p>
                  </div>
                  <IconButton icon={X} label="Close" onClick={() => setShowReport(false)} className="-mt-1 -mr-2 shrink-0" />
                </div>

                <div role="radiogroup" aria-labelledby="report-title" className="mt-5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {REPORT_REASONS.map((r) => {
                    const on = reportReason === r.value;
                    return (
                      <button
                        key={r.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setReportReason(r.value)}
                        className={cn(
                          "press flex items-center justify-between gap-3 rounded-[12px] px-3.5 py-3 text-left text-[13.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ember",
                          on ? "bg-white text-[#0b0708]" : "bg-white/[0.05] text-foreground/85 hover:bg-white/[0.08] hover:text-foreground"
                        )}
                      >
                        {r.label}
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full",
                            on ? "bg-chili" : "shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.25)]"
                          )}
                        >
                          {on && <span className="size-1.5 rounded-full bg-white" />}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4">
                  <Textarea
                    id="report-details"
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="Anything else we should know? (optional)"
                    aria-label="Details"
                  />
                  <p className="mt-1.5 text-right font-mono text-[11px] text-muted-foreground/60 tabular-nums">
                    {reportDetails.length}/500
                  </p>
                </div>

                {reportError && (
                  <p className="mt-1 text-xs text-chili-hi">{reportError}</p>
                )}

                <div className="mt-5 flex gap-2">
                  <Pill variant="glass" size="lg" className="flex-1" onClick={() => setShowReport(false)}>
                    Cancel
                  </Pill>
                  <Pill
                    variant="live"
                    size="lg"
                    className="flex-1"
                    onClick={submitReport}
                    disabled={!reportReason || reportBusy}
                  >
                    {reportBusy ? "Sending…" : "Send report"}
                  </Pill>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {mergeOverlay}
      {endedOverlay}
    </div>
  );
}
