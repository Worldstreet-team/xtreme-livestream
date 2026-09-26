"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MAX_RULES,
  MIN_CHAT_RULE_COOLDOWN,
  RULE_COOLDOWNS,
  RULE_SOUNDS,
  RULE_TRIGGERS,
  type RuleAction,
  type RuleTrigger,
  type RuleWhen,
  type ShowRuleDraft,
  type ShowRuleView,
} from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";
import { CARDS, LAYOUTS } from "@/lib/scene";
import { PADS, type PadId } from "@/lib/audio-desk";

/**
 * Show rules on the client (Phase 3): the creator's "when X happens, do Y"
 * list, the words for it, and a few to start from. The API runs them
 * (services/api/src/rules.ts).
 */

export type { RuleAction, RuleTrigger, RuleWhen, ShowRuleDraft, ShowRuleView };
export { MAX_RULES, MIN_CHAT_RULE_COOLDOWN, RULE_COOLDOWNS, RULE_SOUNDS, RULE_TRIGGERS };

// The rules' sounds are the audio desk's pads, both ways round.
const _soundsArePads: readonly PadId[] = RULE_SOUNDS;
const _padsAreSounds: readonly (typeof RULE_SOUNDS)[number][] = PADS.map((p) => p.id);
void _soundsArePads;
void _padsAreSounds;

export const TRIGGER_LABELS: Record<RuleTrigger, { label: string; phrase: string; words: string[] }> = {
  gift: { label: "A gift", phrase: "a gift", words: ["user", "amount", "gift"] },
  ally: { label: "A new ally", phrase: "someone allies with you", words: ["user"] },
  guest_join: { label: "A guest joins", phrase: "a guest joins your stage", words: ["user"] },
  goal_reached: { label: "Goal reached", phrase: "your goal is reached", words: ["goal"] },
  battle_won: { label: "Battle won", phrase: "you win a battle", words: ["opponent"] },
  battle_lost: { label: "Battle lost", phrase: "you lose a battle", words: ["opponent"] },
  chat_word: { label: "A chat word", phrase: "someone types a word", words: ["user"] },
};

/** "$20" from cents. */
export const dollars = (minor: number) => `$${(minor / 100).toFixed(minor % 100 ? 2 : 0)}`;

/** The rule's "when", as a sentence's start: "When a gift of $20 or more lands". */
export function describeWhen(when: RuleWhen) {
  switch (when.kind) {
    case "gift":
      return `When a gift of ${dollars(when.minMinor)} or more lands`;
    case "chat_word":
      return `When someone types ${when.word}`;
    default:
      return `When ${TRIGGER_LABELS[when.kind].phrase}`;
  }
}

const stays = (seconds: number | null | undefined) => (seconds ? ` for ${seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`}` : "");

/** One action, in a few words: "Lower third “Thanks {user}” for 8 s". */
export function describeAction(a: RuleAction) {
  switch (a.do) {
    case "layout":
      return `Layout: ${LAYOUTS.find((l) => l.id === a.layout)?.label ?? a.layout}`;
    case "card":
      return a.card ? `${CARDS.find((c) => c.id === a.card)?.title ?? a.card} card${stays(a.seconds)}` : "Take the card down";
    case "lower_third":
      return `Lower third “${a.title}”${stays(a.seconds)}`;
    case "banner":
      return `Banner “${a.text}”${stays(a.seconds)}`;
    case "hide":
      return `Take the ${a.graphic === "lower-third" ? "lower third" : a.graphic} down`;
    case "countdown":
      return `${a.minutes}-minute countdown`;
    case "sound": {
      const pad = PADS.find((p) => p.id === a.pad);
      return pad ? `${pad.emoji} ${pad.label}` : a.pad;
    }
  }
}

/** A few to start from — the ones most channels want first. */
export const RULE_TEMPLATES: { id: string; title: string; body: ShowRuleDraft }[] = [
  {
    id: "big-gift",
    title: "Thank a big gift",
    body: {
      name: "Big gift",
      on: true,
      when: { kind: "gift", minMinor: 2000 },
      then: [
        { do: "lower_third", title: "Thank you, {user}!", subtitle: "{gift} · {amount}", seconds: 8 },
        { do: "sound", pad: "kaching" },
      ],
      cooldownSec: 10,
    },
  },
  {
    id: "new-ally",
    title: "Welcome new allies",
    body: {
      name: "New ally",
      on: true,
      when: { kind: "ally" },
      then: [{ do: "banner", text: "Welcome to the crew, {user}!", seconds: 10 }],
      cooldownSec: 30,
    },
  },
  {
    id: "battle-won",
    title: "Celebrate a battle win",
    body: {
      name: "Battle won",
      on: true,
      when: { kind: "battle_won" },
      then: [
        { do: "sound", pad: "applause" },
        { do: "banner", text: "We beat {opponent}! Thank you all", seconds: 15 },
      ],
      cooldownSec: 0,
    },
  },
  {
    id: "goal",
    title: "Mark a goal reached",
    body: {
      name: "Goal reached",
      on: true,
      when: { kind: "goal_reached" },
      then: [
        { do: "sound", pad: "levelup" },
        { do: "lower_third", title: "Goal reached!", subtitle: "{goal}", seconds: 8 },
      ],
      cooldownSec: 0,
    },
  },
];

type Envelope<T> = { success: boolean; data: T };

/** The creator's rules, and the ways to change them. `null` rules while loading. */
export function useShowRules(enabled = true) {
  const [rules, setRules] = useState<ShowRuleView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    apiFetch<Envelope<{ rules: ShowRuleView[] }>>("/api/users/me/rules")
      .then((r) => alive && setRules(r.data.rules))
      .catch(() => alive && setError("Couldn't load your rules — try again in a moment."));
    return () => {
      alive = false;
    };
  }, [enabled]);

  const create = useCallback(async (body: ShowRuleDraft) => {
    const r = await apiFetch<Envelope<{ rule: ShowRuleView }>>("/api/users/me/rules", { method: "POST", body: JSON.stringify(body) });
    setRules((cur) => [...(cur ?? []), r.data.rule]);
    return r.data.rule;
  }, []);

  const update = useCallback(async (id: string, body: ShowRuleDraft) => {
    const r = await apiFetch<Envelope<{ rule: ShowRuleView }>>(`/api/users/me/rules/${id}`, { method: "PUT", body: JSON.stringify(body) });
    setRules((cur) => (cur ?? []).map((x) => (x.id === id ? r.data.rule : x)));
    return r.data.rule;
  }, []);

  const remove = useCallback(async (id: string) => {
    setRules((cur) => (cur ?? []).filter((x) => x.id !== id));
    await apiFetch(`/api/users/me/rules/${id}`, { method: "DELETE" });
  }, []);

  /** Do what it does, now, on the live stream (the API says "go live first" otherwise). */
  const tryRule = useCallback(async (id: string) => {
    await apiFetch(`/api/users/me/rules/${id}/try`, { method: "POST" });
  }, []);

  return { rules, error, create, update, remove, tryRule };
}

/** A rule as the body that saves it. */
export function toBody(rule: ShowRuleView): ShowRuleDraft {
  return { name: rule.name, on: rule.on, when: rule.when, then: rule.then, cooldownSec: rule.cooldownSec as ShowRuleDraft["cooldownSec"] };
}
