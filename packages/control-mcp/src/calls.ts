/**
 * What each tool asks the control API for — a method, a path under the API
 * base and a JSON body — as pure functions, so the mapping can be checked
 * without a server. The shapes are the API's own (packages/contracts:
 * controlDoBodySchema, controlShowBodySchema). The unions are copied from
 * there so this package runs on its own; a test keeps them equal.
 */

/** How the program is laid out (contracts: SCENE_LAYOUTS). */
export const LAYOUTS = ["auto", "solo", "split", "trio", "grid", "screen-face", "chart-face"] as const;
export type Layout = (typeof LAYOUTS)[number];
/** A full-frame card over the program (contracts: SCENE_CARDS). */
export const CARDS = ["starting-soon", "brb", "ending"] as const;
export type Card = (typeof CARDS)[number];
/** The audio desk's pads (lib/audio-desk.ts PADS; contracts: RULE_SOUNDS). */
export const PADS = ["airhorn", "applause", "drumroll", "kaching", "badumtss", "whoosh", "levelup", "sadtrombone"] as const;
export type Pad = (typeof PADS)[number];
/** Graphics a `hide` takes down. */
export const GRAPHICS = ["lower-third", "banner", "countdown"] as const;
export type Graphic = (typeof GRAPHICS)[number];
export const STEPS = ["start", "next", "stop"] as const;
export type Step = (typeof STEPS)[number];

/** A show-rule action, exactly as POST /control/do takes it. */
export type Action =
  | { do: "layout"; layout: Layout }
  | { do: "card"; card: Card | null; seconds?: number | null }
  | { do: "lower_third"; title: string; subtitle?: string; seconds?: number | null }
  | { do: "banner"; text: string; seconds?: number | null }
  | { do: "hide"; graphic: Graphic }
  | { do: "countdown"; minutes: number; label?: string }
  | { do: "sound"; pad: Pad };

export interface ControlCall {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  /** What it does, in words — for "This key can't …". */
  what: string;
}

const press = (actions: Action[], what: string): ControlCall => ({ method: "POST", path: "/control/do", body: { actions }, what });

/** Only what was given goes on the wire: the API's own defaults apply to the rest (8 s for a lower third, 15 s for a banner, a card stays up). */
const given = <T extends Record<string, unknown>>(fields: T) => Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as T;

export const calls = {
  state: (): ControlCall => ({ method: "GET", path: "/control/state", what: "see what's on" }),
  do: (actions: Action[]): ControlCall => press(actions, "do that"),
  show: (step: Step): ControlCall => ({ method: "POST", path: "/control/show", body: { step }, what: "run the show" }),
  fireRule: (id: string): ControlCall => ({ method: "POST", path: `/control/rules/${encodeURIComponent(id)}/fire`, what: "fire a rule" }),
  card: (card: Card | null, seconds?: number): ControlCall =>
    press([given({ do: "card", card, seconds }) as Action], card ? "put a card up" : "take the card down"),
  lowerThird: (title: string, subtitle?: string, seconds?: number): ControlCall =>
    press([given({ do: "lower_third", title, subtitle, seconds }) as Action], "put a lower third up"),
  banner: (text: string, seconds?: number): ControlCall => press([given({ do: "banner", text, seconds }) as Action], "put a banner up"),
  layout: (layout: Layout): ControlCall => press([{ do: "layout", layout }], "change the layout"),
  sound: (pad: Pad): ControlCall => press([{ do: "sound", pad }], "play a sound"),
};

/** The HTTP request a call becomes, against an API base ("http://localhost:3002/api") with a key. */
export function toRequest(base: string, key: string, call: ControlCall) {
  return {
    url: `${base.replace(/\/+$/, "")}${call.path}`,
    method: call.method,
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      ...(call.body ? { "content-type": "application/json" } : {}),
    },
    ...(call.body ? { body: JSON.stringify(call.body) } : {}),
  };
}

/** What to tell the assistant when the API said no: its own words, with a missing scope said for this tool. */
export function failureText(call: ControlCall, status: number, body: unknown) {
  const said = body && typeof body === "object" ? (body as { message?: unknown; code?: unknown }) : {};
  const message = typeof said.message === "string" && said.message ? said.message : `The Xtream API answered ${status}`;
  if (said.code === "CONTROL_KEY_SCOPE") return message.replace("can't do that", `can't ${call.what}`);
  return message;
}
