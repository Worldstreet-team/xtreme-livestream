import type { TourScene } from "@/components/app/tour/tour-art";

/**
 * The walkthrough, as data: every tour Xtream plays, its steps, its words
 * and what starts it. The script is the lead's story (owner brief,
 * 2026-09-28): one drawn object that morphs from step to step, a spotlight
 * that glides between the things it names, short plain lines in the second
 * person, and a nudge towards a practice run at the end.
 *
 * Nothing here runs anything. `components/app/tour/tour-host.tsx` reads it
 * to decide what plays and when; `tour-overlay.tsx` draws a step.
 *
 * Targets are `data-tour` names. A step can list several, in order of
 * preference: the first one on screen and visible wins (the rail's Go live
 * on a desktop, the floating one on a phone). A step with no target, or
 * whose targets aren't on screen, plays centred with no cut-out.
 */

export type TourId =
  | "new-look"
  | "browse"
  | "studio-setup"
  | "studio-live"
  | "watch"
  | "wallet"
  | "rewards"
  | "messages"
  | "channel"
  | "gift-keyboard";

/** Things people do that start a tour — see `tourAction` in lib/tour/state.ts. */
export type TourAction = "first-go-live" | "first-live" | "gift-keyboard";

export type TourTrigger =
  /** The first time someone opens the app (after this ships), on any page `where` allows. */
  | { kind: "first-visit" }
  /** The first time someone lands on a matching page. */
  | { kind: "route"; match: RegExp }
  /** The first time someone does the thing. */
  | { kind: "action"; action: TourAction };

/** What a button does. */
export type TourMove =
  | "next"
  | "back"
  /** Snooze the tour for a day. */
  | "later"
  /** Close and mark it seen. */
  | "finish"
  /** Close, mark it seen, and open the studio on a practice run. */
  | "practice";

export interface TourButton {
  label: string;
  move: TourMove;
}

/** Words that change with the screen: the rail is beside you on a desktop, the rings are up top on a phone. */
export interface TourCopy {
  title?: string;
  line?: string;
  target?: string | string[];
}

export interface TourStep {
  /** The drawn object's pose for this step. */
  scene: TourScene;
  /** A second pose it morphs into after a beat (the countdown becoming the rings). */
  then?: TourScene;
  target?: string | string[];
  title: string;
  line: string;
  /** Defaults to Next, or "Got it" on the last step. */
  primary?: TourButton;
  /** Defaults to Back after the first step. When it's something else, Back becomes a small arrow. */
  secondary?: TourButton;
  /** Screens under 768px. */
  phone?: TourCopy;
  /** Screens from 768px. */
  desktop?: TourCopy;
}

export interface Tour {
  id: TourId;
  /** What screen readers hear the dialog called. */
  name: string;
  trigger: TourTrigger[];
  /** Signed-in only, or anyone who can see the page. */
  audience: "signed-in" | "anyone";
  /** Where a first-visit tour may play (a route tour plays where it matches). */
  where?: RegExp;
  /** Only while nothing's on air in this tab (the studio's setup screen). */
  offAir?: boolean;
  /** Also allowed over this dialog (the gift keyboard's tour plays over the keyboard). */
  over?: string;
  /**
   * Plays even with the panel holding this target up — a panel that's part of the screen, not
   * something in the way (the studio's room sheet on a phone, which is up the whole time you're live).
   * Unlike `over`, the tour doesn't need it there to start.
   */
  beside?: string;
  steps: TourStep[];
}

const GO_LIVE = "go-live";
const PRACTICE: TourButton = { label: "Practice run", move: "practice" };

export const TOURS: Tour[] = [
  /* ---- The first visit: Xtream got a new look -------------------------- */
  {
    id: "new-look",
    name: "What's new in Xtream",
    trigger: [{ kind: "first-visit" }],
    audience: "signed-in",
    // Not over a camera, a producer's desk or a phone that's a second camera.
    where: /^\/(?!studio|produce|camera|welcome)/,
    steps: [
      {
        scene: "play",
        title: "Xtream got a new look",
        line: "Same rooms, a lot new. Take 40 seconds and we'll show you around.",
        primary: { label: "Show me", move: "next" },
        secondary: { label: "Later", move: "later" },
      },
      {
        scene: "phone-live",
        target: GO_LIVE,
        title: "Go live in two taps",
        line: "Tap Go live, then the big red button. No title needed; add one while you're live if you like.",
      },
      {
        scene: "rings",
        target: ["live-rings", "live-now"],
        title: "Who's live, right up top",
        line: "A ring means someone's on. Tap one to jump straight in.",
        // On a desktop the rings sit in the rail, beside you, not up top.
        desktop: { title: "Who's live, right beside you", line: "A ring means someone's on. Click one to jump straight in." },
      },
      {
        scene: "gift",
        target: "nav-wallet",
        title: "Back the rooms you love",
        // "calling it" read as phone calls next to the Messages step; predicting is what earns.
        line: "Gifts pay creators real money. Watching, chatting and predicting earn you points: 1,000 points is $1.",
        // A phone keeps the wallet in the menu.
        phone: { target: "account-menu" },
      },
      {
        scene: "bubble",
        target: "nav-messages",
        title: "One inbox, two apps",
        line: "Messages and calls work across Xtream and WorldSpace.",
      },
      {
        scene: "theme",
        target: "account-menu",
        title: "Make it yours",
        line: "Light or dark, your call. Everything else is in the menu.",
        // A desktop keeps light and dark in Settings, not the account menu.
        desktop: { target: "nav-settings", line: "Light or dark, your call. It's in Settings, with everything else." },
      },
      {
        scene: "practice",
        target: GO_LIVE,
        title: "Try it with nobody watching",
        line: "Do a practice run: go live privately, try the studio, end it whenever.",
        primary: PRACTICE,
        secondary: { label: "I'm done", move: "finish" },
      },
    ],
  },

  /* ---- Page explainers: the first visit to each page ------------------- */
  {
    id: "browse",
    name: "Browse, explained",
    trigger: [{ kind: "route", match: /^\/browse$/ }],
    audience: "anyone",
    steps: [
      {
        scene: "rings",
        target: "browse-live",
        title: "Everyone who's on",
        line: "Live channels lists every room that's on right now, the biggest first.",
      },
      {
        scene: "calendar",
        target: "browse-events",
        title: "What's coming up",
        line: "Events are streams people have booked. Set a reminder and you'll be there when they start.",
      },
      {
        scene: "layers",
        target: "browse-categories",
        title: "Every kind of room",
        line: "Games, music, cooking, sport, just chatting. Not just crypto.",
      },
    ],
  },
  {
    id: "studio-setup",
    name: "The studio, explained",
    trigger: [
      { kind: "route", match: /^\/studio$/ },
      { kind: "action", action: "first-go-live" },
    ],
    audience: "signed-in",
    offAir: true,
    steps: [
      {
        scene: "phone-live",
        title: "This is your camera",
        line: "Nothing to fill in. The big button goes live.",
      },
      {
        scene: "more",
        target: "studio-more",
        title: "Everything else is in More",
        line: "Sound and looks, Sets, a second camera, the privacy shield, the run of show, schedule and thumbnail.",
      },
      {
        scene: "second-cam",
        title: "Your phone can be a second camera",
        line: "Scan a code with it and it's another angle. Then pick where it sits in the layout.",
      },
      {
        scene: "practice",
        // The practice switch lives in More (it's only on screen while More is open), so More is what's lit.
        target: ["studio-practice", "studio-more"],
        title: "Not ready? Practice first.",
        line: "A practice run goes live privately: nobody's told, nothing's listed. It's the first thing in More.",
        primary: PRACTICE,
        secondary: { label: "Got it", move: "finish" },
      },
    ],
  },
  {
    id: "studio-live",
    name: "Live in the studio, explained",
    trigger: [{ kind: "action", action: "first-live" }],
    audience: "signed-in",
    // On a phone the room (chat, Guests, Scenes…) is a sheet that's always up while you're live.
    beside: "studio-scenes",
    steps: [
      {
        scene: "countdown",
        then: "rings",
        title: "You're live",
        line: "Your viewers and chat are here.",
      },
      {
        scene: "layers",
        target: "studio-scenes",
        title: "Change the look without stopping",
        line: "Layouts, cards and graphics, all while you're on.",
      },
      {
        scene: "stage",
        target: "studio-stage",
        title: "Bring people up",
        line: "Invite guests on stage, co-live with another host, or start a battle.",
      },
      {
        scene: "vivid",
        target: "studio-vivid",
        title: "Hold V and ask Vivid",
        line: "It can switch scenes, start a prediction or put up a card.",
        // No V key on a phone.
        phone: { title: "Hold the button, ask Vivid" },
      },
      {
        scene: "shield",
        title: "You won't lose the room",
        line: "If you drop, the room holds for 5 minutes. End when you're done.",
      },
    ],
  },
  {
    id: "watch",
    name: "Watching, explained",
    trigger: [{ kind: "route", match: /^\/stream\/[^/]+$/ }],
    audience: "anyone",
    steps: [
      {
        scene: "gift",
        target: "watch-gift",
        title: "Send a gift",
        line: "Gifts are real money for the creator, and everyone in the room sees them land.",
      },
      {
        scene: "podium",
        target: "watch-top-gifters",
        title: "Top gifters, up front",
        line: "The room's biggest backers get their faces on the board.",
      },
      {
        scene: "streak",
        target: "points",
        title: "Points for watching",
        line: "Watching earns points, and coming back each day grows your streak.",
        // A phone's watch page has no points chip (the picture owns the screen): the step plays
        // centred, and says where the points live instead of waiting for a target that won't come.
        phone: { target: [], line: "Watching earns points, and coming back each day grows your streak. They're in Rewards, in the menu." },
      },
      {
        scene: "rings",
        target: "watch-ally",
        title: "Become an Ally",
        line: "Follow and you're an Ally. Their ring lights up for you the moment they go live.",
      },
    ],
  },
  {
    id: "wallet",
    name: "Your wallet, explained",
    trigger: [{ kind: "route", match: /^\/wallet$/ }],
    audience: "signed-in",
    steps: [
      {
        scene: "wallet",
        target: "wallet-balance",
        title: "Your wallet",
        line: "Top it up to send gifts. Gifts people send you land here as dollars.",
      },
      {
        scene: "coin",
        target: "wallet-points",
        title: "Points turn into cash",
        line: "Every 1,000 points you earn is $1. Cash them in from Rewards.",
      },
      {
        scene: "calendar",
        target: "wallet-history",
        title: "Everything, on record",
        line: "Gifts in and out, payouts and points, by date.",
      },
    ],
  },
  {
    id: "rewards",
    name: "Rewards, explained",
    trigger: [{ kind: "route", match: /^\/rewards$/ }],
    audience: "signed-in",
    steps: [
      {
        scene: "streak",
        target: "rewards-streak",
        title: "Keep the streak going",
        line: "Watch a little every day. The longer the streak, the bigger the bonus.",
      },
      {
        scene: "podium",
        target: "rewards-quests",
        title: "Quests pay faster",
        line: "Small daily and weekly goals, each worth points. They lift your level too.",
      },
      {
        scene: "coin",
        target: "rewards-redeem",
        title: "Cash out when you're ready",
        line: "1,000 points is $1, straight into your wallet.",
      },
    ],
  },
  {
    id: "messages",
    name: "Messages, explained",
    trigger: [{ kind: "route", match: /^\/messages(\/|$)/ }],
    audience: "signed-in",
    steps: [
      {
        scene: "bubble",
        target: "messages-inbox",
        title: "One inbox, two apps",
        line: "Chats from Xtream and WorldSpace, together. Reply from either.",
      },
      {
        scene: "call",
        target: "messages-calls",
        title: "Call from any chat",
        line: "Voice or video, right from the thread. It rings in WorldSpace too.",
        // A phone shows the list, not the calls tile: the calls are one tap into any chat.
        phone: { target: "messages-thread", line: "Open any chat: voice and video calls are at the top. It rings in WorldSpace too." },
      },
    ],
  },
  {
    id: "channel",
    name: "Your channel, explained",
    trigger: [{ kind: "route", match: /^\/dashboard$/ }],
    audience: "signed-in",
    steps: [
      {
        scene: "calendar",
        target: "channel-next",
        title: "Next up",
        line: "Book your next stream here. Followers set a reminder and they're in the room when you start.",
      },
      {
        scene: "layers",
        target: "channel-broadcasts",
        title: "Your broadcasts",
        line: "Every stream you've done, with its thumbnail. Change one any time.",
      },
      {
        scene: "rings",
        target: "channel-followers",
        title: "Your people",
        line: "Followers hear the second you go live, and your ring lights up for them.",
      },
    ],
  },

  /* ---- Moments: the first time you do something ------------------------ */
  {
    id: "gift-keyboard",
    name: "Gifts, explained",
    trigger: [{ kind: "action", action: "gift-keyboard" }],
    audience: "signed-in",
    over: "gift-keyboard",
    steps: [
      {
        scene: "gift",
        target: "gift-keyboard",
        title: "Gifts are real money",
        line: "Every gift pays the creator, and it plays on screen for the whole room.",
      },
      {
        scene: "coin",
        target: "gift-keyboard",
        title: "A sword means it counts",
        line: "In a battle, gifts with a sword badge move the score.",
      },
    ],
  },
];

export function tourById(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}

/** A step's words and target for this screen size. */
export function resolveStep(step: TourStep, phone: boolean): { title: string; line: string; targets: string[] } {
  const over = (phone ? step.phone : step.desktop) ?? {};
  const target = over.target ?? step.target;
  return {
    title: over.title ?? step.title,
    line: over.line ?? step.line,
    targets: target === undefined ? [] : Array.isArray(target) ? target : [target],
  };
}

/** The buttons a step shows, with the defaults filled in. */
export function stepButtons(tour: Tour, index: number): { primary: TourButton; secondary: TourButton | null; back: boolean } {
  const step = tour.steps[index];
  const last = index === tour.steps.length - 1;
  const primary = step.primary ?? (last ? { label: "Got it", move: "finish" as const } : { label: "Next", move: "next" as const });
  const secondary = step.secondary ?? (index > 0 ? { label: "Back", move: "back" as const } : null);
  // Back is a word when it's the second button, a small arrow when that seat is taken.
  const back = index > 0 && secondary?.move !== "back";
  return { primary, secondary, back };
}
