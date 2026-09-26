import type mongoose from "mongoose";
import type { RuleAction, RuleWhen, ShowRuleView } from "@xtreme/contracts";
import { sceneView } from "./featured.js";
import { sendRoomData, sendRoomDataTo, setRoomScene } from "./livekit.js";
import { ShowRule, Stream, type IShowRule } from "./models.js";

/**
 * Show rules (Phase 3): "when X happens, do Y" — OBS's Advanced Scene
 * Switcher, for a phone and a browser. Things that happen on a stream are
 * handed here as they happen (a gift, an ally, a guest, a goal, a battle's
 * result, a chat word); the creator's rules that match fire once per
 * cooldown and change the scene the way a hand on the controls would. A
 * sound goes to the host's studio, whose audio desk plays it.
 *
 * Firing never throws into what triggered it: a gift is a gift whether or
 * not the lower third made it up.
 */

type Id = mongoose.Types.ObjectId;

export type ShowEvent =
  | { kind: "gift"; minor: number; user: string; gift: string }
  | { kind: "ally"; user: string }
  | { kind: "guest_join"; user: string }
  | { kind: "goal_reached"; goal: string }
  | { kind: "battle_won" | "battle_lost"; opponent: string }
  | { kind: "chat_word"; text: string; user: string };

type Layer = Record<string, unknown> & { kind: string };
type Scene = ReturnType<typeof sceneView>;

/** "$12" or "$12.50". */
const money = (minor: number) => `$${(minor / 100).toFixed(minor % 100 ? 2 : 0)}`;

export function matchesRule(when: RuleWhen, event: ShowEvent) {
  if (when.kind !== event.kind) return false;
  if (when.kind === "gift" && event.kind === "gift") return event.minor >= when.minMinor;
  if (when.kind === "chat_word" && event.kind === "chat_word") {
    const first = event.text.trim().split(/\s+/)[0] ?? "";
    return first.toLowerCase() === when.word.toLowerCase();
  }
  return true;
}

/** The words an event lends a rule's text. */
export function varsOf(event: ShowEvent): Record<string, string> {
  switch (event.kind) {
    case "gift":
      return { user: event.user, amount: money(event.minor), gift: event.gift };
    case "ally":
    case "guest_join":
    case "chat_word":
      return { user: event.user };
    case "goal_reached":
      return { goal: event.goal };
    case "battle_won":
    case "battle_lost":
      return { opponent: event.opponent };
  }
}

/** The words a rule is filled with when it's run by hand (Try, a Stream Deck button): what a real event would bring. */
export const SAMPLE_WORDS = { user: "a viewer", amount: "$20", gift: "Rose", goal: "the goal", opponent: "your opponent" };

/** "Thanks {user}!" → "Thanks ada!". A word the event doesn't have stays as written. */
export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole).trim();
}

const sameLayer = (a: Layer, b: Layer) => JSON.stringify(a) === JSON.stringify(b);
const withLayer = (layers: Layer[], layer: Layer) => [...layers.filter((l) => l.kind !== layer.kind), layer];

/** Something a rule puts up for a while: taken down after, if it's still the one it put up. */
export type TakeDown = { after: number } & ({ kind: "card"; card: string } | { kind: "layer"; layer: Layer });

/**
 * What a run of actions does to the scene: the fields it changes, the
 * sounds for the studio, and what to take down when. Pure — `fireRules`
 * writes it.
 */
export function planActions(scene: Scene, actions: RuleAction[], vars: Record<string, string>, now: number) {
  let { layout, card, chart } = scene;
  let layers = scene.layers as Layer[];
  let changed = false;
  const sounds: string[] = [];
  const takeDowns: TakeDown[] = [];
  for (const a of actions) {
    switch (a.do) {
      case "layout":
        layout = a.layout;
        // Chart + face with no market yet shows Bitcoin, as the studio's button does.
        if (layout === "chart-face" && !chart) chart = { symbol: "BTC-USD", interval: "5m" };
        changed = true;
        break;
      case "card":
        card = a.card;
        changed = true;
        if (a.card && a.seconds) takeDowns.push({ kind: "card", card: a.card, after: a.seconds * 1000 });
        break;
      case "lower_third": {
        const layer = { kind: "lower-third", title: fill(a.title, vars).slice(0, 48) || "…", subtitle: fill(a.subtitle, vars).slice(0, 72) };
        layers = withLayer(layers, layer);
        changed = true;
        if (a.seconds) takeDowns.push({ kind: "layer", layer, after: a.seconds * 1000 });
        break;
      }
      case "banner": {
        const layer = { kind: "banner", text: fill(a.text, vars).slice(0, 100) || "…" };
        layers = withLayer(layers, layer);
        changed = true;
        if (a.seconds) takeDowns.push({ kind: "layer", layer, after: a.seconds * 1000 });
        break;
      }
      case "hide":
        if (layers.some((l) => l.kind === a.graphic)) {
          layers = layers.filter((l) => l.kind !== a.graphic);
          changed = true;
        }
        break;
      case "countdown":
        layers = withLayer(layers, {
          kind: "countdown",
          label: fill(a.label, vars).slice(0, 40),
          endsAt: new Date(now + a.minutes * 60_000).toISOString(),
        });
        changed = true;
        break;
      case "sound":
        sounds.push(a.pad);
        break;
    }
  }
  return { set: changed ? { "scene.layout": layout, "scene.card": card, "scene.chart": chart, "scene.layers": layers } : null, sounds, takeDowns };
}

/**
 * Write scene fields if nobody else changed the scene since `version`, and
 * tell the room. Null when the scene moved under us (read again and retry).
 */
async function writeScene(streamId: Id | string, version: number, set: Record<string, unknown>) {
  const updated = await Stream.findOneAndUpdate(
    { _id: streamId, isLive: true, "scene.version": version },
    { $set: set, $inc: { "scene.version": 1 } },
    { new: true, select: "scene livekitRoomName" },
  ).lean();
  if (!updated) return null;
  const scene = sceneView(updated.scene);
  await setRoomScene(updated.livekitRoomName, scene);
  void sendRoomData(updated.livekitRoomName, { __evt: "scene", scene });
  return scene;
}

/** Read, change, write — again if the scene moved in between (a host's tap, another rule). */
async function changeScene(streamId: Id | string, change: (scene: Scene) => Record<string, unknown> | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stream = await Stream.findOne({ _id: streamId, isLive: true }).select("scene").lean();
    if (!stream) return null;
    const scene = sceneView(stream.scene);
    const set = change(scene);
    if (!set) return null;
    const written = await writeScene(streamId, scene.version, set);
    if (written) return written;
  }
  return null;
}

async function takeDown(streamId: Id | string, what: TakeDown) {
  await changeScene(streamId, (scene) => {
    if (what.kind === "card") return scene.card === what.card ? { "scene.card": null } : null;
    const layers = scene.layers as Layer[];
    return layers.some((l) => sameLayer(l, what.layer)) ? { "scene.layers": layers.filter((l) => !sameLayer(l, what.layer)) } : null;
  });
}

/* ---- The creator's rules, cached a moment per creator ---- */

const CACHE_MS = 15_000;
const cache = new Map<string, { rules: IShowRule[]; at: number }>();

/** Forget a creator's cached rules — they just changed them. */
export function forgetRules(ownerId: unknown) {
  cache.delete(String(ownerId));
}

async function rulesOf(ownerId: Id | string, now: number) {
  const key = String(ownerId);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.rules;
  const rules = (await ShowRule.find({ ownerId, on: true }).lean()) as unknown as IShowRule[];
  cache.set(key, { rules, at: now });
  return rules;
}

/**
 * Something happened on a live stream: fire the creator's rules that match.
 * Each rule claims its cooldown atomically, so it fires once however many
 * instances see the event. Resolves to the rules that fired.
 */
export async function fireRules(
  stream: { _id: Id | string; streamerId: Id | string; livekitRoomName?: string },
  event: ShowEvent,
  now = Date.now(),
): Promise<string[]> {
  try {
    const matching = (await rulesOf(stream.streamerId, now)).filter((r) => matchesRule(r.when as RuleWhen, event));
    if (matching.length === 0) return [];
    const fired: IShowRule[] = [];
    for (const rule of matching) {
      const claimed = await ShowRule.updateOne(
        {
          _id: rule._id,
          on: true,
          $or: [{ firedAt: null }, { firedAt: { $lte: new Date(now - rule.cooldownSec * 1000) } }],
        },
        { $set: { firedAt: new Date(now) }, $inc: { fires: 1 } },
      );
      if (claimed.modifiedCount) fired.push(rule);
    }
    if (fired.length === 0) return [];
    await runActions(stream, fired.flatMap((r) => r.then as RuleAction[]), varsOf(event), now);
    return fired.map((r) => String(r._id));
  } catch (err) {
    console.error("show rules failed:", err);
    return [];
  }
}

/** Do what fired rules say: one scene write for the lot, the sounds to the studio, take-downs later. */
export async function runActions(
  stream: { _id: Id | string; streamerId: Id | string; livekitRoomName?: string },
  actions: RuleAction[],
  vars: Record<string, string>,
  now = Date.now(),
) {
  let plan: ReturnType<typeof planActions> | null = null;
  await changeScene(stream._id, (scene) => {
    plan = planActions(scene, actions, vars, now);
    return plan.set;
  });
  // The scene may not have changed (a sound alone): plan from what's stored.
  if (!plan) {
    const s = await Stream.findOne({ _id: stream._id, isLive: true }).select("scene livekitRoomName").lean();
    if (!s) return;
    plan = planActions(sceneView(s.scene), actions, vars, now);
    stream = { ...stream, livekitRoomName: stream.livekitRoomName ?? s.livekitRoomName };
  }
  const { sounds, takeDowns } = plan as ReturnType<typeof planActions>;
  if (sounds.length > 0) {
    const room = stream.livekitRoomName ?? (await Stream.findById(stream._id).select("livekitRoomName").lean())?.livekitRoomName;
    if (room) void sendRoomDataTo(room, [String(stream.streamerId)], { __evt: "rule_fire", sounds }).catch(() => {});
  }
  for (const t of takeDowns) {
    const timer = setTimeout(() => void takeDown(stream._id, t).catch(() => {}), t.after);
    timer.unref?.();
  }
}

/**
 * A run-of-show segment's cues as actions, for going to it without a studio
 * (the control API). A sponsor cue is left out and named — a sponsor card
 * goes up through the scene route, which keeps campaigns' on-screen time.
 */
export function cueActions(segment: { title: string; seconds: number; cues?: Array<Record<string, unknown> & { do: string }> }) {
  const actions: RuleAction[] = [];
  const skipped: string[] = [];
  for (const cue of segment.cues ?? []) {
    switch (cue.do) {
      case "layout":
        actions.push({ do: "layout", layout: cue.layout as Extract<RuleAction, { do: "layout" }>["layout"] });
        break;
      case "card":
        actions.push({ do: "card", card: cue.card as Extract<RuleAction, { do: "card" }>["card"], seconds: null });
        break;
      case "clear-card":
        actions.push({ do: "card", card: null, seconds: null });
        break;
      case "lower-third":
        actions.push({ do: "lower_third", title: String(cue.title ?? ""), subtitle: String(cue.subtitle ?? ""), seconds: null });
        break;
      case "hide-lower-third":
        actions.push({ do: "hide", graphic: "lower-third" });
        break;
      case "banner":
        actions.push({ do: "banner", text: String(cue.text ?? ""), seconds: null });
        break;
      case "hide-banner":
        actions.push({ do: "hide", graphic: "banner" });
        break;
      case "countdown":
        // To the segment's planned end, to the second (minutes may be a fraction here).
        actions.push({ do: "countdown", minutes: segment.seconds / 60, label: segment.title.slice(0, 40) });
        break;
      default:
        skipped.push(cue.do);
    }
  }
  return { actions, skipped };
}

export function ruleView(rule: Pick<IShowRule, "_id" | "name" | "on" | "when" | "then" | "cooldownSec" | "fires" | "firedAt">): ShowRuleView {
  return {
    id: String(rule._id),
    name: rule.name ?? "",
    on: Boolean(rule.on),
    when: rule.when as RuleWhen,
    then: rule.then as RuleAction[],
    cooldownSec: rule.cooldownSec ?? 10,
    fires: rule.fires ?? 0,
    firedAt: rule.firedAt ? new Date(rule.firedAt).toISOString() : null,
  };
}
