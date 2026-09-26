"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { EASE, done, ghost, play, receive, reducedMotion, type Box } from "./motion";

/**
 * The thread's choreography, run after every change to the list:
 *
 *  - nothing jumps: rows that moved slide from where they were, and when
 *    the thread scrolls to make room it glides there
 *  - your words launch from the field into their bubble, which grows from
 *    its corner around them; "Sent" pops once they've landed
 *  - their typing bubble becomes their message: the dots fade and the same
 *    bubble stretches to fit the words
 *  - their face follows the foot of their run, gliding rather than jumping
 *  - her face under your message pops in when she reads it, and hops down
 *    to a newer one when she reads that too
 *  - the first paint rises with a stagger you almost don't see
 *
 * It reads the content's children that carry data-row. A message row also
 * carries data-msg, data-from, data-mine and data-client-key; its bubble
 * data-bubble, its words data-words; faces data-face.
 */

/** The words the composer sent, and where they left from. */
export interface Launch {
  from: Box;
  text: string;
}
export const launchKey = (clientKey: string) => `launch:${clientKey}`;

/** How long the next change's slides take (unsend closes its gap faster). */
export const SLIDE_MS_KEY = "thread:slide-ms";

/** When a launched message lands, so "Sent" can wait for it. */
const landings = new Map<string, number>();

type Mem = {
  first: boolean;
  firstRow: string | null;
  firstTop: number;
  tops: Map<string, number>;
  known: Set<string>;
  typing: { box: Box; radius: string; from: string | null } | null;
  faces: Map<string, { el: Element; top: number }>;
  seen: { key: string; box: Box } | null;
  status: { key: string; text: string } | null;
  readers: Set<string>;
};

/** A box within `root` from layout alone: a running animation doesn't count. */
function layoutBox(el: HTMLElement, root: HTMLElement): Box {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
}

/** How far a running move still holds `el` from its place. */
function heldOffset(el: HTMLElement): number {
  if (!el.getAnimations().length) return 0;
  return new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
}

/** Slide `el` from `dy` off its place to it, picking up any move already under way. */
function slide(el: HTMLElement, dy: number, ms: number) {
  const from = dy + heldOffset(el);
  el.getAnimations().forEach((a) => a.cancel());
  if (Math.abs(from) < 0.5) return;
  play(el, [{ transform: `translateY(${from}px)` }, { transform: "none" }], ms, EASE.out);
}

/** From (dx, dy) home along an arc, swelling at the top of it. */
function hopFrames(dx: number, dy: number, lift: number, swell: number, n = 16): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bump = 4 * t * (1 - t);
    frames.push({ offset: t, transform: `translate(${dx * (1 - t)}px, ${dy * (1 - t) - lift * bump}px) scale(${1 + (swell - 1) * bump})` });
  }
  return frames;
}

const POP: Keyframe[] = [{ transform: "scale(0)" }, { transform: "scale(1.2)", offset: 0.6 }, { transform: "none" }];

/**
 * Your words leave the field and land in their bubble, which grows in
 * around them. `drift` is how far a glide already under way still holds
 * the thread off its place: the words aim for where the bubble will rest.
 */
function launchInto(row: HTMLElement, launch: Launch, clientKey: string, drift: number): boolean {
  const bubble = row.querySelector<HTMLElement>("[data-bubble]");
  const words = row.querySelector<HTMLElement>("[data-words]");
  if (!bubble || !words || reducedMotion()) return false;
  const seen = words.getBoundingClientRect();
  const to = { left: seen.left, top: seen.top - drift, width: seen.width, height: seen.height };
  // A paragraph in the air reads as a glitch: long words spring up instead.
  if (to.height > 90 || launch.text.length > 280) return false;

  const g = ghost(words, { left: launch.from.left, top: launch.from.top, width: to.width, height: to.height });
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim() || "#f6f1ee";
  const landed = getComputedStyle(words).color;
  words.style.visibility = "hidden";
  const flight = play(
    g,
    [
      { transform: "translate(0, 0)", color: ink },
      { transform: `translate(${to.left - launch.from.left}px, ${to.top - launch.from.top}px)`, color: landed },
    ],
    360,
    EASE.glide,
    0,
    { fill: "both" },
  );
  bubble.style.transformOrigin = "100% 100%";
  play(bubble, [{ transform: "scale(0.3)", opacity: 0 }, { transform: "none", opacity: 1 }], 360, EASE.glide, 40);
  landings.set(clientKey, performance.now() + 400);
  void done(flight).then(() => {
    words.style.visibility = "";
    g.remove();
  });
  return true;
}

/** Their dots bubble becomes their message: the dots fade, the bubble stretches to fit, the words fade in. */
function morphFromTyping(row: HTMLElement, from: { box: Box; radius: string }, content: HTMLElement): boolean {
  const bubble = row.querySelector<HTMLElement>("[data-bubble]");
  if (!bubble || reducedMotion()) return false;
  const to = layoutBox(bubble, content);
  const cs = getComputedStyle(bubble);
  const bare = cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor === "transparent";

  // A skin under the words wears the bubble's colour while it changes shape
  // (a scale would squash the corners and the dots).
  const skin = document.createElement("span");
  skin.setAttribute("aria-hidden", "true");
  skin.innerHTML = '<span class="msg-dots msg-wave"><span></span><span></span><span></span></span>';
  Object.assign(skin.style, {
    position: "absolute",
    zIndex: "-1",
    display: "flex",
    alignItems: "center",
    paddingLeft: "16px",
    boxSizing: "border-box",
    overflow: "hidden",
    pointerEvents: "none",
    color: "var(--muted-foreground)",
    background: bare ? "var(--control)" : cs.backgroundColor,
  });
  bubble.style.isolation = "isolate";
  if (!bare) bubble.style.backgroundColor = "transparent";
  bubble.prepend(skin);

  const x = from.box.left - to.left;
  const y = from.box.top - to.top;
  const stretch = play(
    skin,
    [
      { left: `${x}px`, top: `${y}px`, width: `${from.box.width}px`, height: `${from.box.height}px`, borderRadius: from.radius, opacity: 1 },
      { left: "0px", top: "0px", width: `${to.width}px`, height: `${to.height}px`, borderRadius: cs.borderRadius, opacity: bare ? 0 : 1 },
    ],
    300,
    EASE.glide,
    60,
    { fill: "both" },
  );
  play(skin.firstElementChild, [{ opacity: 1 }, { opacity: 0 }], 100, EASE.in, 0, { fill: "both" });
  for (const child of bubble.children) {
    if (child !== skin) play(child, [{ opacity: 0 }, { opacity: 1 }], 160, EASE.out, 110);
  }
  void done(stretch).then(() => {
    skin.remove();
    bubble.style.isolation = "";
    bubble.style.backgroundColor = "";
  });
  return true;
}

export function useThreadMotion({
  listRef,
  contentRef,
  movedRef,
  loaded,
  version,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  /** How far the list just scrolled to keep you at the bottom (the scroll effect writes it). */
  movedRef: RefObject<number>;
  loaded: boolean;
  /** Changes whenever the rows can: the entries, the typing row, the receipts. */
  version: unknown;
}) {
  const mem = useRef<Mem>({
    first: true,
    firstRow: null,
    firstTop: 0,
    tops: new Map(),
    known: new Set(),
    typing: null,
    faces: new Map(),
    seen: null,
    status: null,
    readers: new Set(),
  });

  /** Note where everything is, so the next change moves from here. */
  const remember = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const m = mem.current;
    const rows = rowsOf(content);
    m.tops = new Map(rows.map((r) => [r.dataset.row!, r.offsetTop]));
    m.firstRow = rows[0]?.dataset.row ?? null;
    m.firstTop = rows[0]?.offsetTop ?? 0;
    m.known = new Set(rows.filter((r) => r.dataset.msg).map((r) => r.dataset.row!));

    const typingBubble = content.querySelector<HTMLElement>("[data-typing-bubble]");
    const typingRow = typingBubble?.closest<HTMLElement>("[data-row]");
    m.typing =
      typingBubble && typingRow
        ? { box: layoutBox(typingBubble, content), radius: getComputedStyle(typingBubble).borderRadius, from: typingRow.dataset.from ?? null }
        : null;

    m.faces = new Map();
    content.querySelectorAll<HTMLElement>("[data-face]").forEach((f) => m.faces.set(f.dataset.face!, { el: f, top: layoutBox(f, content).top }));

    const seen = content.querySelector<HTMLElement>("[data-seen-face]");
    m.seen = seen ? { key: seen.dataset.seenFace!, box: layoutBox(seen, content) } : null;
    const status = content.querySelector<HTMLElement>("[data-status]");
    m.status = status ? { key: status.dataset.statusFor!, text: status.dataset.status! } : null;
    m.readers = new Set([...content.querySelectorAll<HTMLElement>("[data-reader]")].map((r) => r.dataset.reader!));
  }, [contentRef]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const list = listRef.current;
    const moved = movedRef.current;
    movedRef.current = 0;
    if (!content || !list) return;
    const m = mem.current;
    const rows = rowsOf(content);

    if (!loaded) {
      remember();
      return;
    }

    if (m.first) {
      // First paint: the conversation rises in behind whatever opened it,
      // row by row, so close together it reads as one breath.
      m.first = false;
      const top = list.scrollTop;
      const bottom = top + list.clientHeight;
      rows
        .filter((r) => r.offsetTop + r.offsetHeight > top && r.offsetTop < bottom)
        .slice(-14)
        .forEach((r, i) => play(r, [{ transform: "translateY(10px)", opacity: 0 }, { transform: "none", opacity: 1 }], 260, EASE.out, 40 + i * 10));
      remember();
      return;
    }

    const ms = receive<number>(SLIDE_MS_KEY) ?? 240;
    // A glide from the last change may still be carrying the thread.
    const drift = heldOffset(content);

    // Older history went in above: the scroll held your place, nothing below slides.
    const fromTop = !rows.length || rows[0].dataset.row !== m.firstRow || rows[0].offsetTop !== m.firstTop;

    const seenEl = content.querySelector<HTMLElement>("[data-seen-face]");
    const hop = Boolean(seenEl && m.seen && m.seen.key !== seenEl.dataset.seenFace);

    // 1. Rows that moved slide from where they were.
    if (!fromTop) {
      const viewTop = list.scrollTop - 240;
      const viewBottom = list.scrollTop + list.clientHeight + 240;
      for (const r of rows) {
        const was = m.tops.get(r.dataset.row!);
        if (was === undefined) continue;
        const now = r.offsetTop;
        if (Math.abs(was - now) < 0.5 || now + r.offsetHeight < viewTop || now > viewBottom) continue;
        // Her face is hopping out of this row on its own path; don't carry it twice.
        if (hop && seenEl && r.contains(seenEl)) continue;
        slide(r, was - now, ms);
      }
    }

    // 2. Their face follows the foot of their run.
    const following = new Set<Element>();
    for (const [who, was] of m.faces) {
      if (was.el.isConnected) continue;
      const faces = content.querySelectorAll<HTMLElement>(`[data-face="${CSS.escape(who)}"]`);
      const now = faces[faces.length - 1];
      if (!now) continue;
      const dy = was.top - layoutBox(now, content).top;
      if (Math.abs(dy) >= 480) continue;
      following.add(now);
      if (Math.abs(dy) > 0.5) play(now, [{ transform: `translateY(${dy}px)` }, { transform: "none" }], 280, EASE.glide);
    }

    // 3. Arrivals at the foot of the thread.
    const arrivals: HTMLElement[] = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!r.dataset.msg) continue;
      if (m.known.has(r.dataset.row!)) break;
      arrivals.unshift(r);
    }
    const typingNow = content.querySelector("[data-typing-bubble]");
    let morphed = false;
    for (const r of arrivals) {
      const bubble = r.querySelector<HTMLElement>("[data-bubble]");
      if (r.dataset.mine) {
        const key = r.dataset.clientKey;
        const launch = key ? receive<Launch>(launchKey(key)) : null;
        if (launch && key && launchInto(r, launch, key, drift)) continue;
        // Photos, voice notes, words too long to fly: up from the composer on the spring.
        if (bubble) {
          bubble.style.transformOrigin = "100% 100%";
          play(bubble, [{ transform: "translateY(20px) scale(0.94)", opacity: 0 }, { transform: "none", opacity: 1 }], 300, EASE.spring);
        }
        continue;
      }
      if (!morphed && m.typing && !typingNow && (!m.typing.from || r.dataset.from === m.typing.from)) {
        morphed = morphFromTyping(r, m.typing, content);
        if (morphed) continue;
      }
      // Theirs rises in quietly: no overshoot for something you didn't do.
      if (bubble) {
        bubble.style.transformOrigin = "0 100%";
        play(bubble, [{ transform: "translateY(8px) scale(0.96)", opacity: 0 }, { transform: "none", opacity: 1 }], 280, EASE.out);
      }
      const face = r.querySelector("[data-face]");
      if (face && !following.has(face)) play(face, [{ transform: "translateY(8px)", opacity: 0 }, { transform: "none", opacity: 1 }], 280, EASE.out);
    }

    // 4. Seen: her face pops in, or hops down to the newer message she just read.
    if (seenEl && hop && m.seen) {
      const to = layoutBox(seenEl, content);
      const dx = m.seen.box.left - to.left;
      const dy = m.seen.box.top - to.top;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) play(seenEl, hopFrames(dx, dy, 9, 1.18), 440, EASE.glide);
    } else if (seenEl && !m.seen) {
      play(seenEl, POP, 420, EASE.spring);
    }
    content.querySelectorAll<HTMLElement>("[data-reader]").forEach((f) => {
      if (!m.readers.has(f.dataset.reader!)) play(f, POP, 420, EASE.spring);
    });

    // 5. "Sent" pops, after the words have landed when they flew.
    const status = content.querySelector<HTMLElement>("[data-status]");
    const was = m.status;
    if (status?.dataset.status === "Sent" && was && was.key === status.dataset.statusFor && was.text === "Sending") {
      const key = status.dataset.clientKey;
      const at = key ? landings.get(key) : undefined;
      if (key) landings.delete(key);
      const wait = at ? Math.max(0, at - performance.now()) : 0;
      play(status, [{ transform: "scale(0.4)", opacity: 0 }, { transform: "scale(1.2)", opacity: 1, offset: 0.6 }, { transform: "none", opacity: 1 }], 280, EASE.spring, wait);
    }

    // 6. The list scrolled to keep you at the bottom: glide there (last, so
    // everything above measured the thread where it will rest).
    if (Math.abs(moved) > 0.5 && Math.abs(moved) < list.clientHeight * 0.9) slide(content, moved, ms);

    remember();
  }, [contentRef, listRef, movedRef, loaded, version, remember]);

  return { remember };
}

function rowsOf(content: HTMLElement): HTMLElement[] {
  return [...content.children].filter((el): el is HTMLElement => el instanceof HTMLElement && Boolean(el.dataset.row));
}

/** Unsend, part one: the bubble shrinks to 92% and fades, accelerating away. */
export async function shrinkAway(messageId: string) {
  const row = document.getElementById(`m-${messageId}`);
  const bubble = row?.querySelector<HTMLElement>("[data-bubble]") ?? row;
  if (!row || !bubble) return;
  bubble.style.transformOrigin = row.dataset.mine ? "100% 50%" : "0 50%";
  await done(play(bubble, [{ transform: "none", opacity: 1 }, { transform: "scale(0.92)", opacity: 0 }], 180, EASE.in, 0, { fill: "forwards" }));
}

/** The composer's hand-off to the thread: the words it just sent, and where they sat. */
export const COMPOSER_LAUNCH = "composer:launch";

/** The thread glides after its own height changes (a reply bar, the keyboard). */
export function glideContent(el: HTMLElement | null, moved: number, ms = 280) {
  if (!el || reducedMotion()) return;
  slide(el, moved, ms);
}
