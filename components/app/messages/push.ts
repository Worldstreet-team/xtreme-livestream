"use client";

import { EASE, done, ghost, handOff, play, receive, reducedMotion, type Box, boxOf } from "./motion";

/**
 * Opening a thread where one pane shows at a time (the owner's pick, open
 * C: push + hero). The inbox you tapped recedes 28% and dims while the
 * thread slides in from the right, and the row's face and name fly into
 * the thread's header, becoming it. Back runs the push in reverse.
 *
 * Only for your own taps: a browser back or a deep link simply arrives
 * (iOS already animates its own swipe back). The screen that leaves is a
 * still copy, so the real page can change underneath it at once.
 */

const PUSH = "messages:push";
const BACK = "messages:back";
const SLIDE_MS = 360;
const HERO_MS = 440;

/** Below lg the inbox and a thread take turns on screen. */
export function oneAtATime(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023.98px)").matches;
}

type Still = { layer: HTMLElement; dim: HTMLElement; box: Box };

/**
 * A still of `els` exactly where they are, above the page. Scroll positions
 * are copied across, since a copy starts scrolled to the top.
 */
function still(els: HTMLElement[], z: number): Still | null {
  const shown = els.filter((el) => el.offsetWidth && el.offsetHeight);
  if (!shown.length) return null;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  Object.assign(layer.style, { position: "fixed", inset: "0", zIndex: String(z), pointerEvents: "none", overflow: "hidden" });
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const scrolled: [HTMLElement, HTMLElement][] = [];
  for (const el of shown) {
    const r = el.getBoundingClientRect();
    const copy = el.cloneNode(true) as HTMLElement;
    copy.removeAttribute("id");
    copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    Object.assign(copy.style, {
      position: "absolute",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      margin: "0",
      background: "var(--background)",
    });
    layer.append(copy);
    const from = [el, ...el.querySelectorAll<HTMLElement>("*")];
    const to = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
    from.forEach((f, i) => f.scrollTop && to[i] && scrolled.push([f, to[i]]));
    top = Math.min(top, Math.max(0, r.top));
    left = Math.min(left, Math.max(0, r.left));
    right = Math.max(right, Math.min(window.innerWidth, r.right));
    bottom = Math.max(bottom, Math.min(window.innerHeight, r.bottom));
  }
  // The shade that falls over a screen as it goes behind another.
  const dim = document.createElement("div");
  Object.assign(dim.style, { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`, background: "#000", opacity: "0" });
  layer.append(dim);
  document.body.append(layer);
  for (const [f, t] of scrolled) t.scrollTop = f.scrollTop;
  // A copy is new to the page, so its entrances would play again: a still stays still.
  layer.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  return { layer, dim, box: { left, top, width: right - left, height: bottom - top } };
}

/** What leaves with the inbox on a phone: its top bar and tab bar go too. */
function phoneChrome(): HTMLElement[] {
  if (window.matchMedia("(min-width: 768px)").matches) return [];
  return [...document.querySelectorAll<HTMLElement>('[data-app-chrome], nav[aria-label="Primary"]')];
}

type Push = { id: string; still: Still; avatar: HTMLElement | null; name: HTMLElement | null; from: { avatar: Box | null; name: Box | null } };

/** A row was tapped: freeze the inbox as it looks, and lift the row's face and name. */
export function beginPush(id: string, inbox: HTMLElement | null, row: HTMLElement | null) {
  if (!inbox || !oneAtATime() || reducedMotion()) return;
  const s = still([inbox, ...phoneChrome()], 45);
  if (!s) return;
  const face = row?.querySelector<HTMLElement>("[data-hero-avatar]") ?? null;
  const name = row?.querySelector<HTMLElement>("[data-hero-name]") ?? null;
  // The face and name leave the row: copies take off from exactly there.
  const avatar = face ? ghost(face) : null;
  const title = name ? ghost(name) : null;
  // A long name is cut where the row cut it, not spilled across the screen.
  const room = name?.parentElement?.getBoundingClientRect().width;
  if (title && room) Object.assign(title.style, { width: `${Math.min(room, name!.getBoundingClientRect().width)}px`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
  const copyRow = s.layer.querySelector<HTMLElement>(`[data-hero-row="${CSS.escape(id)}"]`);
  copyRow?.querySelectorAll<HTMLElement>("[data-hero-avatar], [data-hero-name]").forEach((el) => (el.style.visibility = "hidden"));
  handOff<Push>(PUSH, { id, still: s, avatar, name: title, from: { avatar: face ? boxOf(face) : null, name: name ? boxOf(name) : null } });
  // A route that never arrives mustn't leave a still over the page.
  setTimeout(() => {
    if (!s.layer.isConnected || s.layer.dataset.playing) return;
    s.layer.remove();
    avatar?.remove();
    title?.remove();
  }, 1600);
}

/** The thread has rendered: slide it in over the receding inbox, and land the face and name in its header. */
export function playPush(id: string, section: HTMLElement | null) {
  const p = receive<Push>(PUSH, 1500);
  if (!p) return;
  const drop = () => {
    p.still.layer.remove();
    p.avatar?.remove();
    p.name?.remove();
  };
  if (p.id !== id || !section) return drop();
  p.still.layer.dataset.playing = "1";

  // Where the face and name will rest, measured before anything moves.
  const toAvatar = section.querySelector<HTMLElement>("[data-hero-avatar]");
  const toName = section.querySelector<HTMLElement>("[data-hero-name]");
  const land = (flier: HTMLElement | null, from: Box | null, to: HTMLElement | null) => {
    if (!flier || !from || !to) return flier?.remove();
    const end = to.getBoundingClientRect();
    to.style.visibility = "hidden";
    const scale = from.height ? end.height / from.height : 1;
    const flight = play(flier, [{ transform: "none" }, { transform: `translate(${end.left - from.left}px, ${end.top - from.top}px) scale(${scale})` }], HERO_MS, EASE.glide, 0, {
      fill: "forwards",
    });
    void done(flight).then(() => {
      to.style.visibility = "";
      flier.remove();
    });
  };
  land(p.avatar, p.from.avatar, toAvatar);
  land(p.name, p.from.name, toName);

  // The rest of the tapped row fades under its departing face and name.
  const copyRow = p.still.layer.querySelector<HTMLElement>(`[data-hero-row="${CSS.escape(id)}"]`);
  if (copyRow) play(copyRow, [{ opacity: 1 }, { opacity: 0 }], 160, EASE.std, 0, { fill: "forwards" });

  Object.assign(section.style, { position: "relative", zIndex: "46", background: "var(--background)" });
  const slide = play(section, [{ transform: "translateX(100%)" }, { transform: "none" }], SLIDE_MS, EASE.glide);
  play(p.still.layer, [{ transform: "none" }, { transform: "translateX(-28%)" }], SLIDE_MS, EASE.glide, 0, { fill: "forwards" });
  play(p.still.dim, [{ opacity: 0 }, { opacity: 0.5 }], SLIDE_MS, EASE.glide, 0, { fill: "forwards" });
  void done(slide).then(() => {
    p.still.layer.remove();
    Object.assign(section.style, { position: "", zIndex: "", background: "" });
  });
}

type Back = { still: Still };

/** Back from a thread: freeze it as it looks, to slide away once the inbox is under it. */
export function beginBack(thread: HTMLElement | null) {
  if (!thread || !oneAtATime() || reducedMotion()) return;
  const s = still([thread], 46);
  if (!s) return;
  handOff<Back>(BACK, { still: s });
  setTimeout(() => {
    if (s.layer.isConnected && !s.layer.dataset.playing) s.layer.remove();
  }, 1600);
}

/** The inbox is back: it comes forward from behind as the thread slides off to the right. */
export function playBack(inbox: HTMLElement | null) {
  const b = receive<Back>(BACK, 1500);
  if (!b) return;
  if (!inbox) return void b.still.layer.remove();
  b.still.layer.dataset.playing = "1";
  // The thread's still covers the whole screen; a shade under it lifts off the inbox.
  const shade = document.createElement("div");
  Object.assign(shade.style, { position: "fixed", inset: "0", zIndex: "45", pointerEvents: "none", background: "#000", opacity: "0" });
  document.body.append(shade);
  const back = [inbox, ...phoneChrome()];
  const out = play(b.still.layer, [{ transform: "none" }, { transform: "translateX(100%)" }], 320, EASE.glide, 0, { fill: "forwards" });
  back.forEach((el) => play(el, [{ transform: "translateX(-28%)" }, { transform: "none" }], 320, EASE.glide));
  play(shade, [{ opacity: 0.5 }, { opacity: 0 }], 320, EASE.glide, 0, { fill: "forwards" });
  void done(out).then(() => {
    b.still.layer.remove();
    shade.remove();
  });
}
