"use client";

import { Fragment, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MessagingRealtime, SendMessageInput, UserEvent } from "@worldstreet/messaging-sdk";
import { ArrowBendUpLeft, ArrowDown, ChatCircleDots, Check, Copy, PencilSimple, Trash, UsersThree } from "@/components/icons";
import { Dialog, DialogClose, DialogContent, Notice, Pill, UserAvatar } from "@/components/xtream";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import {
  EDIT_WINDOW_MS,
  UNSEND_WINDOW_MS,
  describeMessage,
  getMessagingSession,
  lastSeenLabel,
  messaging,
  messagingFailure,
  needsStamp,
  nudgeUnread,
  personName,
  senderIdOf,
  stampLabel,
  systemEventCopy,
  threadAvatar,
  threadTitle,
  useMessagingEvents,
  type MessagingFailure,
} from "@/lib/messaging";
import type { CallPeer } from "@/lib/call-manager";
import { useCall } from "@/components/app/calls/call-provider";
import { useMessages } from "@/components/app/messages/messages-context";
import { MessageBubble, TypingBubble, type ThreadMessage } from "@/components/app/messages/message-bubble";
import { ActionSheet, type MessageAction } from "@/components/app/messages/message-actions";
import { Composer, MAX_ATTACHMENTS, type Attachment } from "@/components/app/messages/composer";
import { ThreadMenu, type MuteChoice } from "@/components/app/messages/thread-menu";
import { ThreadHeader } from "@/components/app/messages/thread-header";
import { ThreadDetails } from "@/components/app/messages/thread-details";
import { ThreadSearch } from "@/components/app/messages/thread-search";
import { CallLogRow } from "@/components/app/messages/call-log-row";
import { MediaViewer, type ViewerItem } from "@/components/app/messages/media-viewer";
import type { VoiceClip } from "@/components/app/messages/voice-recorder";

/**
 * One thread — the conversation, and everything WorldSpace threads can do.
 *
 * Reading: stamps only across real gaps, an Unread line where you left off,
 * runs that group, albums, voice notes, polls, calls logged as cards with a
 * way to call back, "Seen" under your latest. Writing: text, several photos
 * or clips at once, voice notes, replies, edits within fifteen minutes,
 * reactions, unsend. Calling: voice or video from the header, Join when a
 * group call is on. All live — messages, edits, reactions, votes, read
 * marks, typing and recording arrive without a refresh.
 *
 * Keyed on the thread id, so opening another thread starts fresh.
 */
export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Thread key={id} id={id} />;
}

const PAGE = 50;
/** Messages this close together from one person read as one run. */
const RUN_GAP_MS = 5 * 60_000;
/** Within this of the bottom, new messages keep you pinned there. */
const NEAR_BOTTOM_PX = 140;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const isRow = (m: ThreadMessage) => m.type === "system" || m.type === "call";
const isPicture = (m: ThreadMessage) => (m.type === "image" || m.type === "video") && Boolean(m.mediaUrl) && !m.removedBy;
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message) || fallback;

type Entry =
  | { type: "stamp"; key: string; iso: string }
  | { type: "unread"; key: string }
  | { type: "system"; key: string; m: ThreadMessage }
  | { type: "call"; key: string; m: ThreadMessage; mine: boolean }
  | {
      type: "msg";
      key: string;
      m: ThreadMessage;
      album?: ThreadMessage[];
      mine: boolean;
      groupedAbove: boolean;
      groupedBelow: boolean;
    };

/** The thread as rows: stamps across gaps, the unread line, runs, albums. */
function buildEntries(messages: ThreadMessage[], meId: string | null, firstUnreadId: string | null): Entry[] {
  const out: Entry[] = [];
  let prev: ThreadMessage | undefined;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const breaks = needsStamp(prev?.createdAt, m.createdAt);
    if (breaks) out.push({ type: "stamp", key: `s-${m._id}`, iso: m.createdAt });
    if (m._id === firstUnreadId) out.push({ type: "unread", key: "unread" });
    const mine = Boolean(meId) && senderIdOf(m.sender) === meId;

    if (m.type === "system") out.push({ type: "system", key: m._id, m });
    else if (m.type === "call") out.push({ type: "call", key: m._id, m, mine });
    else {
      // Pictures sent together (one groupKey) paint as one album.
      let album: ThreadMessage[] | undefined;
      if (m.groupKey && isPicture(m)) {
        let j = i;
        while (
          j + 1 < messages.length &&
          messages[j + 1].groupKey === m.groupKey &&
          isPicture(messages[j + 1]) &&
          senderIdOf(messages[j + 1].sender) === senderIdOf(m.sender)
        )
          j++;
        if (j > i) {
          album = messages.slice(i, j + 1);
          i = j;
        }
      }
      const last = out[out.length - 1];
      const groupedAbove =
        last?.type === "msg" &&
        !breaks &&
        senderIdOf(last.m.sender) === senderIdOf(m.sender) &&
        new Date(m.createdAt).getTime() - new Date((last.album?.at(-1) ?? last.m).createdAt).getTime() < RUN_GAP_MS;
      out.push({ type: "msg", key: m._id, m, album, mine, groupedAbove, groupedBelow: false });
    }
    prev = messages[i];
  }
  for (let k = 0; k < out.length - 1; k++) {
    const a = out[k];
    const b = out[k + 1];
    if (a.type === "msg" && b.type === "msg" && b.groupedAbove) a.groupedBelow = true;
  }
  return out;
}

function Thread({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const call = useCall();
  const { rows, meId, reload, patchRow, removeRow } = useMessages();
  const row = rows?.find((r) => r._id === id) ?? null;
  const isInvite = Boolean(row?.isInvite);
  const isGroup = row?.kind === "group";
  const owner = row?.myRole === "owner";

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<MessagingFailure | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** The first message you hadn't read when you opened the thread. */
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  /** A message's open actions: the floating strip or menu, or the phone sheet.
   *  `at` is when it opened — the edit and unsend windows are measured from
   *  that tap, which keeps render free of the clock. */
  const [active, setActive] = useState<{ id: string; kind: "react" | "menu" | "sheet"; below: boolean; at: number } | null>(null);
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);

  const [peerState, setPeerState] = useState<"typing" | "recording" | null>(null);
  const [peerHere, setPeerHere] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const [flash, setFlash] = useState<{ text: string; tone: "info" | "danger" } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<ReturnType<MessagingRealtime["thread"]> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTypingSent = useRef(0);
  const pinned = useRef(true);
  const initialScrollDone = useRef(false);
  /** Scroll height before older messages went in above, to hold position. */
  const anchor = useRef<number | null>(null);
  /** Each optimistic send: what to send, its local preview, and how to upload first if it must. */
  const sends = useRef(new Map<string, { input: SendMessageInput; previewUrl?: string; upload?: () => Promise<string> }>());
  const objectUrls = useRef<string[]>([]);
  const rowRef = useRef(row);
  useEffect(() => {
    rowRef.current = row;
  }, [row]);

  const say = useCallback((text: string, tone: "info" | "danger" = "info") => {
    setFlash({ text, tone });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3200);
  }, []);

  /** Read marks only while you're actually looking. */
  const markRead = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void messaging.messages
      .markRead(id)
      .then(() => {
        patchRow(id, { unreadCount: 0 });
        nudgeUnread();
      })
      .catch(() => {});
  }, [id, patchRow]);

  /* ---------------- Load, and the live signal channel ---------------- */

  useEffect(() => {
    // An invite isn't a membership yet: there's nothing to read until you join.
    if (!user || isInvite) return;
    let cancelled = false;
    let stopSignals: (() => void) | null = null;
    let stopPresence: (() => void) | null = null;

    void (async () => {
      try {
        const [page, session] = await Promise.all([messaging.messages.list(id, { limit: PAGE }), getMessagingSession()]);
        if (cancelled) return;
        // Where you left off: the oldest of the unread, counted from the end.
        const unread = rowRef.current?.unreadCount ?? 0;
        if (unread > 0) {
          let seen = 0;
          for (let i = page.length - 1; i >= 0; i--) {
            if (isRow(page[i]) || senderIdOf(page[i].sender) === session.me.id) continue;
            seen++;
            if (seen === unread) {
              setFirstUnreadId(page[i]._id);
              break;
            }
          }
        }
        setMessages(page);
        setHasMore(page.length === PAGE);
        setLoadError(null);
        setLoaded(true);
        markRead();

        const thread = session.live.thread(id);
        threadRef.current = thread;
        void thread.enter();
        stopSignals = thread.onSignal((name, signal) => {
          if (name === "typing" || name === "recording") {
            setPeerState(name);
            if (typingTimer.current) clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setPeerState(null), name === "recording" ? 6000 : 4000);
          } else if (name === "typing:stop") {
            setPeerState(null);
          } else if (name === "reaction" && signal?.messageId && signal.reactions) {
            setMessages((cur) => cur.map((m) => (m._id === signal.messageId ? { ...m, reactions: signal.reactions } : m)));
          }
        });
        // "Active now" follows them in and out of the thread.
        const checkPresence = () => void thread.peerPresent().then((here) => !cancelled && setPeerHere(here));
        checkPresence();
        stopPresence = thread.onPresence(checkPresence);
      } catch (err) {
        if (!cancelled) {
          setLoadError(messagingFailure(err, "This conversation"));
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      stopSignals?.();
      stopPresence?.();
      void threadRef.current?.leave();
      threadRef.current = null;
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [user, id, isInvite, reloadKey, markRead]);

  // Coming back to the tab reads what arrived while you were away.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  // Blob previews, the toast timer and a recording beat live until the thread closes.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (recordingTimer.current) clearInterval(recordingTimer.current);
    };
  }, []);

  /* ---------------- Live events for this thread ---------------- */

  const onEvent = useCallback(
    (event: UserEvent) => {
      if (!("conversationId" in event) || event.conversationId !== id) return;
      switch (event.type) {
        case "message:new": {
          const msg = event.message;
          setMessages((cur) => {
            if (cur.some((m) => m._id === msg._id)) return cur;
            // My own send coming back over the socket: swap the optimistic copy.
            const mine = msg.clientKey ? cur.findIndex((m) => m.clientKey === msg.clientKey) : -1;
            if (mine >= 0) {
              const next = [...cur];
              next[mine] = { ...msg, mediaUrl: msg.mediaUrl?.includes("://") ? msg.mediaUrl : cur[mine].mediaUrl };
              return next;
            }
            return [...cur, msg];
          });
          if (senderIdOf(msg.sender) !== meId) {
            setPeerState(null);
            markRead();
            if (!pinned.current) setNewBelow((n) => n + 1);
          }
          return;
        }
        case "message:edited":
          setMessages((cur) =>
            cur.map((m) =>
              m._id !== event.messageId
                ? m
                : m.type === "poll" && m.poll
                  ? { ...m, poll: { ...m.poll, question: event.content }, editedAt: event.editedAt }
                  : { ...m, content: event.content, editedAt: event.editedAt },
            ),
          );
          return;
        case "message:unsent":
          setMessages((cur) => cur.filter((m) => m._id !== event.messageId));
          return;
        case "message:removed":
          // An admin removed it for everyone: it stays as a tombstone.
          setMessages((cur) =>
            cur.map((m) =>
              m._id === event.messageId ? { ...m, removedBy: event.by, content: "", mediaUrl: undefined, reactions: [], poll: undefined } : m,
            ),
          );
          return;
        case "message:read": {
          const { readerId, readUpTo } = event;
          // Object ids sort by time, so "up to" is a plain comparison.
          setMessages((cur) =>
            cur.map((m) =>
              !m.pending && m._id <= readUpTo && !(m.readBy ?? []).includes(readerId) ? { ...m, readBy: [...(m.readBy ?? []), readerId] } : m,
            ),
          );
          return;
        }
        case "poll:updated":
          setMessages((cur) =>
            cur.map((m) => {
              if (m._id !== event.messageId || !m.poll) return m;
              // Your own picks ride along when the poll isn't anonymous, so a
              // vote cast from another device shows here too.
              const mine = event.votes && meId ? event.votes.filter((v) => v.profile === meId).map((v) => v.option) : m.poll.mine;
              return { ...m, poll: { ...m.poll, counts: event.counts, total: event.total, votes: event.votes ?? m.poll.votes, mine } };
            }),
          );
          return;
        case "conversation:removed":
        case "conversation:deleted":
          router.replace("/messages");
          return;
      }
    },
    [id, meId, markRead, router],
  );
  useMessagingEvents(onEvent);

  /* ---------------- Scrolling ---------------- */

  const entries = useMemo(() => buildEntries(messages, meId, firstUnreadId), [messages, meId, firstUnreadId]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (anchor.current !== null) {
      // Older messages went in above: keep the ones you were reading still.
      el.scrollTop += el.scrollHeight - anchor.current;
      anchor.current = null;
      return;
    }
    // First paint: open at the Unread line when there's a screenful to catch up on.
    if (!initialScrollDone.current && loaded && messages.length) {
      initialScrollDone.current = true;
      const line = el.querySelector<HTMLElement>("[data-unread-line]");
      if (line && el.scrollHeight - line.offsetTop > el.clientHeight) {
        el.scrollTop = Math.max(0, line.offsetTop - 12);
        pinned.current = false;
        return;
      }
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, peerState, loaded]);

  // Pictures and clips size themselves after they load; at the bottom, stay there.
  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!list || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  /** One page further back. Resolves to what arrived. */
  const fetchOlder = useCallback(async (): Promise<ThreadMessage[]> => {
    const oldest = messages.find((m) => !m.pending)?._id;
    if (!oldest) return [];
    const older = await messaging.messages.list(id, { limit: PAGE, before: oldest });
    anchor.current = listRef.current?.scrollHeight ?? null;
    setMessages((cur) => [...older.filter((o) => !cur.some((m) => m._id === o._id)), ...cur]);
    setHasMore(older.length === PAGE);
    return older;
  }, [messages, id]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    try {
      await fetchOlder();
    } catch {
      say("Couldn't load earlier messages", "danger");
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, fetchOlder, say]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (pinned.current && newBelow) setNewBelow(0);
    if (el.scrollTop < 80 && hasMore && !loadingOlder) void loadOlder();
    if (active && active.kind !== "sheet") setActive(null);
  };

  const toBottom = () => {
    const el = listRef.current;
    if (!el) return;
    pinned.current = true;
    setNewBelow(0);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  /** Take me to a message: scroll there and light it; page back if it isn't loaded yet. */
  const jumpTo = useCallback(
    async (messageId: string) => {
      setSearching(false);
      let el = document.getElementById(`m-${messageId}`);
      if (!el && hasMore) {
        say("Finding it…");
        try {
          for (let tries = 0; tries < 8 && !document.getElementById(`m-${messageId}`); tries++) {
            const older = await fetchOlder();
            if (older.length < PAGE) break;
            await new Promise((r) => requestAnimationFrame(() => r(null)));
          }
        } catch {
          /* fall through to the not-found line */
        }
        await new Promise((r) => setTimeout(r, 60));
        el = document.getElementById(`m-${messageId}`);
      }
      if (!el) return say("That message is too far back to reach from here");
      pinned.current = false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlight(messageId);
      setTimeout(() => setHighlight((h) => (h === messageId ? null : h)), 1200);
    },
    [hasMore, fetchOlder, say],
  );

  /* ---------------- Writing ---------------- */

  const onDraft = (value: string) => {
    setDraft(value);
    if (editingId) return;
    const now = Date.now();
    if (value && now - lastTypingSent.current > 2500) {
      lastTypingSent.current = now;
      void threadRef.current?.send("typing");
    }
  };

  const onRecording = (activeNow: boolean) => {
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    recordingTimer.current = null;
    if (activeNow) {
      void threadRef.current?.send("recording");
      recordingTimer.current = setInterval(() => void threadRef.current?.send("recording"), 2500);
    } else void threadRef.current?.send("typing:stop");
  };

  const deliver = useCallback(
    async (clientKey: string) => {
      const entry = sends.current.get(clientKey);
      if (!entry) return;
      try {
        // A voice note uploads first; a retry re-uploads if that step failed.
        if (entry.upload && !entry.input.mediaUrl) entry.input.mediaUrl = await entry.upload();
        const saved = await messaging.messages.send(entry.input);
        // The gateway may answer with the storage key rather than a URL:
        // keep the local preview until a real URL arrives.
        const mediaUrl = saved.mediaUrl?.includes("://") ? saved.mediaUrl : (entry.previewUrl ?? saved.mediaUrl);
        setMessages((cur) =>
          cur.filter((m) => m._id !== saved._id || m.clientKey === clientKey).map((m) => (m.clientKey === clientKey ? { ...saved, mediaUrl } : m)),
        );
        sends.current.delete(clientKey);
        // Replying to a request accepts it (the gateway's rule).
        if (rowRef.current?.isRequestForMe) patchRow(id, { isRequestForMe: false, status: "accepted" });
      } catch {
        setMessages((cur) => cur.map((m) => (m.clientKey === clientKey ? { ...m, pending: false, failed: true } : m)));
      }
    },
    [id, patchRow],
  );

  /** Put an optimistic row in the thread and send it. */
  const queue = (input: Omit<SendMessageInput, "conversationId" | "clientKey">, local: Partial<ThreadMessage>, extra?: { previewUrl?: string; upload?: () => Promise<string> }) => {
    const clientKey = crypto.randomUUID();
    const full: SendMessageInput = { conversationId: id, clientKey, ...input };
    sends.current.set(clientKey, { input: full, previewUrl: extra?.previewUrl, upload: extra?.upload });
    const optimistic = {
      _id: `local-${clientKey}`,
      conversationId: id,
      sender: meId ?? "",
      content: input.content ?? "",
      type: input.type ?? "text",
      createdAt: new Date().toISOString(),
      clientKey,
      pending: true,
      ...local,
    } as ThreadMessage;
    pinned.current = true;
    setMessages((cur) => [...cur, optimistic]);
    return clientKey;
  };

  const send = async () => {
    if (editingId) return void saveEdit();
    const content = draft.trim();
    const ready = attachments.filter((a) => a.key);
    if (!content && !ready.length) return;

    const quoted = replyTo && typeof replyTo.sender !== "string" && !replyTo.pending ? replyTo : null;
    const replyRef = quoted
      ? {
          replyTo: {
            _id: quoted._id,
            content: quoted.content,
            type: quoted.type,
            mediaUrl: quoted.mediaUrl,
            sender: quoted.sender as Exclude<ThreadMessage["sender"], string>,
          },
        }
      : {};
    const replyId = replyTo && !replyTo.pending ? { replyTo: replyTo._id } : {};

    setDraft("");
    setReplyTo(null);
    setAttachments([]);
    void threadRef.current?.send("typing:stop");

    if (!ready.length) {
      void deliver(queue({ content, type: "text", ...replyId }, replyRef));
      return;
    }
    // Several pictures share one groupKey and arrive as one album; the words
    // ride on the first, the way WorldSpace sends them.
    const groupKey = ready.length > 1 ? crypto.randomUUID() : undefined;
    const keys = ready.map((a, i) =>
      queue(
        {
          type: a.kind,
          mediaUrl: a.key!,
          ...(i === 0 && content ? { content } : {}),
          ...(i === 0 ? replyId : {}),
          ...(groupKey ? { groupKey } : {}),
          ...(a.width && a.height ? { width: a.width, height: a.height } : {}),
        },
        { mediaUrl: a.previewUrl, groupKey, width: a.width, height: a.height, ...(i === 0 ? replyRef : {}) },
        { previewUrl: a.previewUrl },
      ),
    );
    // In order, so the album lands the way it was picked.
    for (const k of keys) await deliver(k);
  };

  const sendVoice = (clip: VoiceClip) => {
    const previewUrl = URL.createObjectURL(clip.blob);
    objectUrls.current.push(previewUrl);
    const ext = clip.mimeType.includes("mp4") ? "m4a" : clip.mimeType.includes("ogg") ? "ogg" : "webm";
    const file = new File([clip.blob], `voice-${Date.now()}.${ext}`, { type: clip.mimeType });
    const durationSec = Math.max(1, Math.round(clip.durationSec));
    const replyId = replyTo && !replyTo.pending ? { replyTo: replyTo._id } : {};
    setReplyTo(null);
    const key = queue(
      { type: "audio", durationSec, peaks: clip.peaks, ...replyId },
      { mediaUrl: previewUrl, durationSec, peaks: clip.peaks },
      { previewUrl, upload: async () => (await messaging.media.upload(file, id)).key },
    );
    void deliver(key);
  };

  const retry = (m: ThreadMessage) => {
    if (!m.clientKey) return;
    setMessages((cur) => cur.map((x) => (x.clientKey === m.clientKey ? { ...x, failed: false, pending: true } : x)));
    void deliver(m.clientKey);
  };

  const pickFiles = (files: File[]) => {
    const room = MAX_ATTACHMENTS - attachments.length;
    if (files.length > room) say(`Up to ${MAX_ATTACHMENTS} at a time`, "danger");
    for (const file of files.slice(0, Math.max(0, room))) {
      const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
      if (!kind) {
        say("Photos and clips only", "danger");
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        say(`${file.name} is over 50 MB`, "danger");
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.push(previewUrl);
      const att: Attachment = { id: crypto.randomUUID(), file, previewUrl, kind, key: null };
      setAttachments((cur) => [...cur, att]);
      // Its shape, so the thread holds the right space before it loads.
      if (kind === "image") {
        const img = new Image();
        img.onload = () => setAttachments((cur) => cur.map((a) => (a.id === att.id ? { ...a, width: img.naturalWidth, height: img.naturalHeight } : a)));
        img.src = previewUrl;
      }
      messaging.media
        .upload(file, id)
        .then((res) => setAttachments((cur) => cur.map((a) => (a.id === att.id ? { ...a, key: res.key } : a))))
        .catch(() => setAttachments((cur) => cur.map((a) => (a.id === att.id ? { ...a, failed: true } : a))));
    }
  };

  const startEdit = (m: ThreadMessage) => {
    setReplyTo(null);
    setEditingId(m._id);
    setDraft(m.content);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };
  const saveEdit = async () => {
    const content = draft.trim();
    if (!content || !editingId) return;
    setSavingEdit(true);
    try {
      const res = await messaging.messages.edit(editingId, content);
      setMessages((cur) => cur.map((m) => (m._id === editingId ? { ...m, content, editedAt: res.editedAt } : m)));
      cancelEdit();
    } catch (err) {
      say(errorText(err, "Couldn't save your edit"), "danger");
    } finally {
      setSavingEdit(false);
    }
  };

  const react = async (m: ThreadMessage, emoji: string) => {
    try {
      const res = await messaging.messages.react(m._id, emoji);
      setMessages((cur) => cur.map((x) => (x._id === m._id ? { ...x, reactions: res.reactions } : x)));
      // Reactions travel on the thread channel so the other side updates live.
      void threadRef.current?.send("reaction", { messageId: m._id, reactions: res.reactions });
    } catch {
      say("Couldn't add that reaction", "danger");
    }
  };

  const vote = async (m: ThreadMessage, optionIds: string[]) => {
    try {
      const res = await messaging.messages.vote(m._id, optionIds);
      setMessages((cur) => cur.map((x) => (x._id === m._id ? { ...x, poll: res.poll } : x)));
    } catch (err) {
      say(errorText(err, "Couldn't count that vote"), "danger");
    }
  };

  const copy = async (m: ThreadMessage) => {
    try {
      await navigator.clipboard.writeText(m.content);
      say("Copied");
    } catch {
      say("Couldn't copy — select the text instead", "danger");
    }
  };

  const unsend = async (m: ThreadMessage, scope: "everyone" | "me") => {
    try {
      await messaging.messages.unsend(m._id, scope);
      setMessages((cur) => cur.filter((x) => x._id !== m._id));
      if (replyTo?._id === m._id) setReplyTo(null);
    } catch (err) {
      say(errorText(err, "Couldn't delete that message"), "danger");
    }
  };

  /** The actions a message offers, measured from when it was opened. */
  const actionsFor = (m: ThreadMessage, at: number): MessageAction[] => {
    const mine = Boolean(meId) && senderIdOf(m.sender) === meId;
    const age = at - new Date(m.createdAt).getTime();
    const scope: "everyone" | "me" = mine && age < UNSEND_WINDOW_MS ? "everyone" : "me";
    const out: MessageAction[] = [{ key: "reply", label: "Reply", icon: ArrowBendUpLeft, onSelect: () => (setEditingId(null), setReplyTo(m)) }];
    if (m.content && m.type !== "poll") out.push({ key: "copy", label: "Copy text", icon: Copy, onSelect: () => void copy(m) });
    if (mine && m.type === "text" && age < EDIT_WINDOW_MS) out.push({ key: "edit", label: "Edit", icon: PencilSimple, onSelect: () => startEdit(m) });
    out.push({
      key: "unsend",
      label: scope === "everyone" ? "Unsend" : "Delete for me",
      icon: Trash,
      confirm: scope === "everyone" ? "Unsend for everyone?" : "Delete it for you?",
      onSelect: () => void unsend(m, scope),
    });
    return out;
  };

  /* ---------------- Media ---------------- */

  const mediaItems = useMemo<ViewerItem[]>(
    () =>
      messages
        .filter((m) => isPicture(m) && !m.pending)
        .map((m) => ({
          id: m._id,
          url: m.mediaUrl!,
          type: m.type as "image" | "video",
          who: senderIdOf(m.sender) === meId ? "You" : typeof m.sender === "string" ? "Them" : personName(m.sender),
          at: m.createdAt,
          caption: m.content || undefined,
        })),
    [messages, meId],
  );
  const openMedia = (messageId: string) => {
    const index = mediaItems.findIndex((it) => it.id === messageId);
    if (index >= 0) setViewer({ items: mediaItems, index });
  };

  /* ---------------- The thread itself ---------------- */

  const goToInbox = () => {
    removeRow(id);
    router.replace("/messages");
  };

  const accept = async () => {
    setBusy(true);
    try {
      await messaging.conversations.accept(id);
      patchRow(id, { isRequestForMe: false, status: "accepted" });
    } catch {
      say("Couldn't accept — try again", "danger");
    } finally {
      setBusy(false);
    }
  };

  const joinGroup = async () => {
    setBusy(true);
    try {
      await messaging.groups.join(id);
      // The row turns from an invite into the group; its messages load next.
      setLoadError(null);
      setLoaded(false);
      await reload();
    } catch (err) {
      say(errorText(err, "Couldn't join the group"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const declineInvite = async () => {
    if (!meId) return;
    setBusy(true);
    try {
      await messaging.groups.withdrawInvite(id, meId);
      goToInbox();
    } catch (err) {
      setBusy(false);
      say(errorText(err, "Couldn't decline the invite"), "danger");
    }
  };

  // A DM goes for both people; a group goes for everyone (owner only);
  // anyone else in a group leaves it instead.
  const deleteOrLeave = async () => {
    setBusy(true);
    try {
      if (isGroup && !owner) {
        if (!meId) throw new Error("Messaging isn't ready yet — try again");
        await messaging.groups.leave(id, meId);
      } else {
        await messaging.conversations.remove(id);
      }
      goToInbox();
    } catch (err) {
      setBusy(false);
      setConfirmDelete(false);
      say(errorText(err, isGroup && !owner ? "Couldn't leave the group" : "Couldn't delete this conversation"), "danger");
    }
  };

  const mute = async (until: MuteChoice | null): Promise<boolean> => {
    try {
      await messaging.conversations.mute(id, until);
      if (until === null && isGroup && row?.notifyLevel && row.notifyLevel !== "all") {
        await messaging.conversations.notifications(id, "all");
        patchRow(id, { notifyLevel: "all" });
      }
      say(
        until === null
          ? "Notifications are on"
          : until === "8h"
            ? "Muted for 8 hours"
            : until === "1w"
              ? "Muted for a week"
              : "Muted until you turn it back on",
      );
      return true;
    } catch {
      say("Couldn't change notifications", "danger");
      return false;
    }
  };

  const mentionsOnly = async () => {
    try {
      await messaging.conversations.notifications(id, "mentions");
      patchRow(id, { notifyLevel: "mentions" });
      say("You'll hear about mentions only");
    } catch {
      say("Couldn't change notifications", "danger");
    }
  };

  // Archived threads keep their row (the inbox shelves them), so this only
  // flips the flag; archiving also takes you back to the inbox.
  const archive = async () => {
    const next = !row?.archived;
    try {
      await messaging.conversations.archive(id, next);
      patchRow(id, { archived: next });
      if (next) router.replace("/messages");
      else say("Moved back to your inbox");
    } catch {
      say(next ? "Couldn't archive this conversation" : "Couldn't move it back to your inbox", "danger");
    }
  };

  /* ---------------- Calls ---------------- */

  const title = threadTitle(row);
  const other = row?.otherParticipant;
  const peer: CallPeer = isGroup
    ? { id, name: title, avatar: threadAvatar(row), username: "" }
    : { id: other?._id ?? id, name: title, avatar: other?.avatar ?? "", username: other?.username ?? "" };
  const callHere = call.status !== "idle" && call.conversationId === id;
  const canCall = call.ready && call.status === "idle" && Boolean(row) && !isInvite && !loadError;
  const startCall = (isVideo: boolean) => call.startCall({ conversationId: id, peer, isVideo, isGroup });
  const groupCall = isGroup && row?.call && !callHere ? { video: row.call.video } : null;

  /* ---------------- What the header says ---------------- */

  const online = !isGroup && (peerHere || lastSeenLabel(other?.lastSeenAt) === "Active now");
  let status: string;
  let statusTone: "typing" | "active" | "muted" = "muted";
  if (peerState) {
    status = peerState === "recording" ? "recording a voice note" : "typing";
    statusTone = "typing";
  } else if (isInvite) status = "Group invite";
  else if (row?.isRequestForMe) status = "Message request";
  else if (isGroup) status = `${row?.memberCount ?? row?.participants.length ?? 0} members`;
  else if (online) {
    status = "Active now";
    statusTone = "active";
  } else status = lastSeenLabel(other?.lastSeenAt) ?? (other ? `@${other.username}` : "");

  // "Seen" under your latest, when your latest is the thread's last word.
  const lastMsg = [...entries].reverse().find((e) => e.type === "msg");
  let receipt: { key: string; text: string; seen: boolean } | null = null;
  if (lastMsg?.type === "msg" && lastMsg.mine && !lastMsg.m.failed) {
    const m = lastMsg.album?.at(-1) ?? lastMsg.m;
    const readers = (m.readBy ?? []).filter((r) => r !== meId).length;
    receipt = {
      key: lastMsg.key,
      text: m.pending ? "Sending" : readers ? (isGroup ? `Seen by ${readers}` : "Seen") : "Sent",
      seen: readers > 0,
    };
  }

  const replyName = replyTo
    ? senderIdOf(replyTo.sender) === meId
      ? "yourself"
      : typeof replyTo.sender === "string"
        ? "them"
        : personName(replyTo.sender)
    : "";

  const confirmCopy =
    isGroup && !owner
      ? { title: "Leave this group?", body: "You'll stop getting its messages. Someone in it can add you back.", action: "Leave" }
      : isGroup
        ? { title: "Delete this group?", body: "It's deleted for everyone in it. You can restore it from WorldSpace for 30 days.", action: "Delete" }
        : {
            title: "Delete this conversation?",
            body: "It's deleted for both of you — here, in WorldSpace and in the app. This can't be undone.",
            action: "Delete",
          };

  const inviter = row?.invite && typeof row.invite.by !== "string" ? personName(row.invite.by) : null;
  const adminsOnlyLock = isGroup && row?.adminsOnly && row.myRole === "member" ? "Only admins can send messages in this group." : null;
  const activeMessage = active ? messages.find((m) => m._id === active.id) : undefined;
  const detailsSubtitle = isGroup
    ? `${row?.memberCount ?? 0} members`
    : online
      ? "Active now"
      : (lastSeenLabel(other?.lastSeenAt) ?? (other ? `@${other.username}` : ""));

  return (
    <div className="relative flex h-dvh min-h-0 md:h-[calc(100dvh-4rem)]">
      <div className="relative flex min-w-0 flex-1 flex-col">
        {flash && (
          <div
            role="status"
            className="msg-lift pointer-events-none absolute top-[calc(env(safe-area-inset-top)+4.75rem)] left-1/2 z-30 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full px-4 py-2 text-center text-[13px] font-medium shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]"
            style={{ background: flash.tone === "danger" ? "var(--chili)" : "var(--surface-raised)", color: "#fff" }}
          >
            {flash.text}
          </div>
        )}

        <ThreadHeader
          title={row || loaded ? title : ""}
          avatar={threadAvatar(row)}
          status={status}
          statusTone={statusTone}
          online={online}
          context={row?.context ?? null}
          canCall={canCall}
          inCall={callHere ? { startedAt: call.startedAt } : null}
          groupCall={groupCall}
          detailsOpen={detailsOpen}
          onBack={() => router.push("/messages")}
          onVoiceCall={() => startCall(false)}
          onVideoCall={() => startCall(true)}
          onJoinCall={() => row?.call && call.joinCall({ conversationId: id, peer, isVideo: row.call.video })}
          onReturnToCall={() => call.setMinimized(false)}
          onToggleDetails={() => row && !isInvite && setDetailsOpen((o) => !o)}
          menu={
            row && !isInvite ? (
              <ThreadMenu
                isGroup={isGroup}
                owner={owner}
                archived={Boolean(row.archived)}
                onMute={(until) => void mute(until)}
                onMentionsOnly={() => void mentionsOnly()}
                onUnmute={() => void mute(null)}
                onArchive={() => void archive()}
                onDelete={() => setConfirmDelete(true)}
              />
            ) : null
          }
        />

        {searching && <ThreadSearch conversationId={id} onPick={(mid) => void jumpTo(mid)} onClose={() => setSearching(false)} />}

        {isInvite && row ? (
          // Asked into a group: say who asked and what it is, then join or don't.
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
            <UserAvatar src={threadAvatar(row)} name={title} size={96} ring="story" className="size-24" />
            <p className="mt-6 text-[11.5px] font-semibold tracking-[0.16em] text-ember-hi uppercase">Group invite</p>
            <p className="mt-2 font-wide text-[26px] leading-tight font-bold tracking-[-0.02em] text-foreground">{title}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[14px] text-muted-foreground">
              <UsersThree size={16} aria-hidden />
              {row.memberCount === 1 ? "1 member" : `${row.memberCount ?? 0} members`}
            </p>
            <p className="mt-5 max-w-xs text-[14.5px] leading-relaxed text-foreground/85">
              {inviter ? `${inviter} invited you in.` : "You've been invited in."} It&apos;s shared with WorldSpace, so it follows you there too.
            </p>
            <div className="mt-7 flex gap-2">
              <Pill variant="primary" onClick={() => void joinGroup()} disabled={busy} className="shadow-none!">
                Join group
              </Pill>
              <Pill variant="glass" onClick={() => void declineInvite()} disabled={busy}>
                Decline
              </Pill>
            </div>
          </div>
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
              <div
                ref={listRef}
                onScroll={onScroll}
                className="msg-scroll h-full overflow-y-auto overscroll-contain px-3 pt-2 pb-4 md:px-6"
              >
                <div ref={contentRef} className="mx-auto max-w-[52rem]">
                  {hasMore && (
                    <div className="flex justify-center py-2">
                      <Pill size="sm" variant="ghost" onClick={() => void loadOlder()} disabled={loadingOlder}>
                        {loadingOlder ? "Loading…" : "Earlier messages"}
                      </Pill>
                    </div>
                  )}

                  {!loaded && <ThreadSkeleton />}

                  {loaded && loadError && (
                    <div className="mx-auto max-w-md pt-10">
                      <Notice
                        tone="danger"
                        title={loadError.title}
                        action={
                          <Pill
                            size="sm"
                            variant="glass"
                            onClick={() => {
                              setLoadError(null);
                              setLoaded(false);
                              setReloadKey((k) => k + 1);
                            }}
                          >
                            Try again
                          </Pill>
                        }
                      >
                        {loadError.detail}
                      </Notice>
                    </div>
                  )}

                  {/* The start of it all: who this is with, and where it began. */}
                  {loaded && !loadError && !hasMore && (
                    <div className="msg-lift flex flex-col items-center px-6 pt-10 pb-6 text-center">
                      <UserAvatar src={threadAvatar(row)} name={title} size={80} className="size-20" />
                      <p className="mt-4 font-wide text-[22px] leading-tight font-bold tracking-[-0.02em] text-foreground">{title}</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {isGroup ? `${row?.memberCount ?? 0} members` : other ? `@${other.username} · on WorldSpace` : ""}
                      </p>
                      <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
                        {messages.length === 0
                          ? isGroup
                            ? "Nothing's been said yet. Start it off."
                            : `Say hi to ${title.split(" ")[0]}. It lands in WorldSpace and the app too.`
                          : row?.context?.title
                            ? `This conversation started from “${row.context.title}”.`
                            : "This is the beginning of your conversation."}
                      </p>
                    </div>
                  )}

                  {entries.map((e) => {
                    if (e.type === "stamp")
                      return (
                        <p key={e.key} className="mt-6 mb-2 text-center text-[11.5px] font-semibold text-muted-foreground/80 tabular-nums">
                          {stampLabel(e.iso)}
                        </p>
                      );
                    if (e.type === "unread")
                      return (
                        <div key={e.key} data-unread-line className="my-4 flex items-center gap-3" role="separator" aria-label="Unread messages">
                          <span aria-hidden className="h-px flex-1 bg-chili/40" />
                          <span className="text-[11px] font-bold tracking-[0.14em] text-chili-hi uppercase">Unread</span>
                          <span aria-hidden className="h-px flex-1 bg-chili/40" />
                        </div>
                      );
                    if (e.type === "system") {
                      const sender = typeof e.m.sender === "string" ? undefined : personName(e.m.sender);
                      const line = e.m.systemEvent ? systemEventCopy(e.m.systemEvent, sender, meId) : "";
                      // A kind this copy doesn't know yet stays out rather than reading "Update".
                      if (!line) return null;
                      return (
                        <p key={e.key} className="mx-auto my-3 max-w-sm text-center text-[12.5px] leading-snug text-muted-foreground">
                          {line}
                        </p>
                      );
                    }
                    if (e.type === "call")
                      return (
                        <CallLogRow
                          key={e.key}
                          content={e.m.content}
                          at={e.m.createdAt}
                          mine={e.mine}
                          onCallBack={canCall ? (video) => startCall(video) : undefined}
                        />
                      );

                    const m = e.m;
                    const isOpen = active?.id === m._id && active.kind !== "sheet" ? active.kind : null;
                    return (
                      <Fragment key={e.key}>
                        <MessageBubble
                          m={m}
                          album={e.album}
                          mine={e.mine}
                          groupedAbove={e.groupedAbove}
                          groupedBelow={e.groupedBelow}
                          showName={isGroup && !e.mine && !e.groupedAbove}
                          meId={meId}
                          highlighted={highlight === m._id}
                          open={isOpen}
                          placeBelow={Boolean(active?.below)}
                          actions={active?.id === m._id ? actionsFor(m, active.at) : []}
                          onOpen={(kind, below) => setActive({ id: m._id, kind, below, at: Date.now() })}
                          onClose={() => setActive((a) => (a?.id === m._id ? null : a))}
                          onReact={(emoji) => void react(m, emoji)}
                          onReply={() => {
                            setEditingId(null);
                            setReplyTo(m);
                          }}
                          onRetry={() => retry(m)}
                          onJumpTo={(mid) => void jumpTo(mid)}
                          onVote={(ids) => void vote(m, ids)}
                          onOpenMedia={openMedia}
                        />
                        {receipt?.key === e.key && (
                          <p
                            className={cn(
                              "msg-fade mt-1.5 flex items-center justify-end gap-1 px-1.5 text-[11.5px] font-medium",
                              receipt.seen ? "text-ember-hi" : "text-muted-foreground",
                            )}
                          >
                            {receipt.seen && <Check size={12} weight="bold" aria-hidden />}
                            {receipt.text}
                          </p>
                        )}
                      </Fragment>
                    );
                  })}

                  {peerState && <TypingBubble recording={peerState === "recording"} />}
                </div>
              </div>

              {newBelow > 0 && (
                <button
                  type="button"
                  onClick={toBottom}
                  className="msg-press msg-pop absolute bottom-3 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-[#0b0708] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]"
                >
                  <ArrowDown size={14} weight="bold" aria-hidden />
                  {newBelow === 1 ? "1 new message" : `${newBelow} new messages`}
                </button>
              )}
            </div>

            {/* Someone you don't ally with wrote first: decide before (or by) answering. */}
            {row?.isRequestForMe && (
              <div className="msg-lift mx-3 mb-1 flex flex-col gap-3 rounded-panel bg-surface-raised p-4 sm:flex-row sm:items-center md:mx-5">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <ChatCircleDots size={20} className="mt-0.5 shrink-0 text-ember-hi" aria-hidden />
                  <p className="text-[14px] leading-snug text-foreground/90">
                    <span className="font-semibold text-foreground">{title}</span> wants to message you. They won&apos;t know you&apos;ve seen it until
                    you accept or reply.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Pill size="sm" variant="primary" onClick={() => void accept()} disabled={busy} className="shadow-none!">
                    Accept
                  </Pill>
                  <Pill size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy} className="text-chili-hi">
                    Delete
                  </Pill>
                </div>
              </div>
            )}

            <div className="mx-auto w-full max-w-[56rem]">
              <Composer
                draft={draft}
                onDraft={onDraft}
                onSend={() => void send()}
                sending={savingEdit}
                replyingTo={replyTo ? { name: replyName, snippet: describeMessage(replyTo) } : null}
                onCancelReply={() => setReplyTo(null)}
                editing={Boolean(editingId)}
                onCancelEdit={cancelEdit}
                attachments={attachments}
                onPickFiles={pickFiles}
                onRemoveAttachment={(aid) => setAttachments((cur) => cur.filter((a) => a.id !== aid))}
                onSendVoice={sendVoice}
                onRecording={onRecording}
                placeholder={row?.isRequestForMe ? "Reply to accept" : isGroup ? `Message ${title}` : `Message ${title.split(" ")[0] || ""}`.trim()}
                disabled={!loaded || Boolean(loadError)}
                locked={adminsOnlyLock}
              />
            </div>
          </>
        )}
      </div>

      {detailsOpen && row && (
        <div className="fixed inset-0 z-40 md:absolute md:inset-y-0 md:right-0 md:left-auto md:w-[360px] md:shadow-[-30px_0_80px_-40px_rgba(0,0,0,0.9)] xl:static xl:z-auto xl:w-[340px] xl:shrink-0 xl:shadow-[inset_1px_0_0_rgba(255,236,230,0.06)]">
          <ThreadDetails
            conversationId={id}
            title={title}
            avatar={threadAvatar(row)}
            subtitle={detailsSubtitle}
            online={online}
            isGroup={isGroup}
            owner={owner}
            archived={Boolean(row.archived)}
            context={row.context ?? null}
            canCall={canCall}
            onVoiceCall={() => startCall(false)}
            onVideoCall={() => startCall(true)}
            onSearch={() => {
              setDetailsOpen(false);
              setSearching(true);
            }}
            onMute={(until) => mute(until)}
            onArchive={() => void archive()}
            onDelete={() => setConfirmDelete(true)}
            onOpenMedia={(items, index) => setViewer({ items, index })}
            onClose={() => setDetailsOpen(false)}
          />
        </div>
      )}

      {active?.kind === "sheet" && activeMessage && (
        <ActionSheet
          preview={{
            who: senderIdOf(activeMessage.sender) === meId ? "You" : typeof activeMessage.sender === "string" ? title : personName(activeMessage.sender),
            text: describeMessage(activeMessage),
          }}
          mineEmoji={activeMessage.reactions?.find((r) => senderIdOf(r.profile) === meId)?.emoji ?? null}
          onReact={(emoji) => void react(activeMessage, emoji)}
          items={actionsFor(activeMessage, active.at)}
          onClose={() => setActive(null)}
        />
      )}

      {viewer && (
        <MediaViewer
          items={viewer.items}
          index={viewer.index}
          onIndex={(index) => setViewer((v) => (v ? { ...v, index } : v))}
          onClose={() => setViewer(null)}
        />
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent title={confirmCopy.title} description={confirmCopy.body}>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Pill variant="glass">Cancel</Pill>
            </DialogClose>
            <Pill variant="live" onClick={() => void deleteOrLeave()} disabled={busy}>
              {confirmCopy.action}
            </Pill>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Loading: the thread's shape, not a spinner. */
function ThreadSkeleton() {
  const widths = ["w-40", "w-56", "w-32", "w-64", "w-44", "w-52"];
  return (
    <div className="space-y-3 pt-8" aria-label="Loading the conversation">
      {widths.map((w, i) => (
        <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start gap-2")}>
          {i % 2 === 0 && <span className="size-7 shrink-0 animate-pulse rounded-full bg-white/[0.05]" />}
          <span className={cn("h-10 animate-pulse rounded-[22px] bg-white/[0.05]", w)} style={{ animationDelay: `${i * 90}ms` }} />
        </div>
      ))}
    </div>
  );
}
