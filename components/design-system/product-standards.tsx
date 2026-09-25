"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Info } from "@/components/icons";
import { GIFT_CATALOG } from "@/lib/gifts";
import { cn } from "@/lib/utils";
import {
  BattleBar,
  Button,
  ChatBubble,
  CheckboxField,
  Chip,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  DragSheet,
  Empty,
  GiftAlert,
  GiftReceipt,
  GiftToken,
  IconButton,
  Money,
  PeltBoard,
  PillTabs,
  RadioCards,
  SelectField,
  SwitchField,
  TextField,
  Textarea,
  Tooltip,
  type GiftTokenState,
} from "@/components/xtream";
import { Section, Spec, States } from "./doc-parts";
import { SAMPLE_PELT, STAGE, sampleBattle, type BattleMoment } from "./sample-data";
import { sources } from "./catalog";

const gift = (id: string) => GIFT_CATALOG.find((g) => g.id === id)!;
const phoenix = gift("phoenix");

/** False on the server, true in the browser — for demos that read the clock. */
const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

/* ------------------------------------------------------------------ */
/*  Giving                                                              */
/* ------------------------------------------------------------------ */

/** A token you can pick, send, and send again. */
function GiftTokenDemo() {
  const [state, setState] = useState<GiftTokenState>("rest");
  const [combo, setCombo] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <GiftToken
      gift={phoenix}
      state={state}
      combo={combo}
      onClick={() => {
        if (state === "rest") return setState("picked");
        if (state === "sending") return;
        setState("sending");
        timer.current = setTimeout(() => {
          setCombo((c) => c + 1);
          setState("landed");
        }, 520);
      }}
    />
  );
}

export function Giving() {
  const [replay, setReplay] = useState(0);
  return (
    <Section
      id="giving"
      act="Components · giving"
      title="A gift is a moment, and money looks like money."
      intro="Gifts are where Afterglow is loudest: the face floats, a picked gift lights up in heat, a sent one bursts. Money comes from Gold Floor, in thin, wide gold numerals and a receipt with a tear line. Heat for the moment, gold for the value."
    >
      <Spec
        name="Gift token"
        summary="One gift as a sticker, which is the tile the gift keyboard is made of. Four states, each with its own beat. Tap the first one: once to pick it, again to send, and again for a combo."
        wire={`import { GiftToken } from "@/components/xtream";
import { GIFT_CATALOG } from "@/lib/gifts";

<GiftToken gift={g} state={picked ? "picked" : "rest"} onClick={pick} />
<GiftToken gift={g} state="landed" combo={3} />
// states: rest · picked · sending · landed`}
      >
        <States
          items={[
            { label: "Rest", hint: "· tap it", node: <GiftTokenDemo /> },
            { label: "Picked", node: <GiftToken gift={phoenix} state="picked" /> },
            { label: "Sending", node: <GiftToken gift={phoenix} state="sending" /> },
            { label: "Landed", node: <GiftToken gift={phoenix} state="landed" combo={3} /> },
          ]}
        />
      </Spec>

      <Spec
        name="The ladder"
        wide
        summary={`All ${GIFT_CATALOG.length} gifts, from a 50¢ clap to the $10,000 Bank. The faces are Google's Noto animated emoji. Bank and Island are stand-ins until custom art exists.`}
        wire={`{GIFT_CATALOG.map((g) => (
  <GiftToken key={g.id} gift={g} state={g.id === picked ? "picked" : "rest"} onClick={() => setPicked(g.id)} />
))}`}
      >
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pt-3 pb-2 scrollbar-none md:-mx-7 md:px-7">
          {GIFT_CATALOG.map((g) => (
            <GiftToken key={g.id} gift={g} className="w-[88px] shrink-0" />
          ))}
        </div>
      </Spec>

      <Spec
        name="Gift alert"
        summary="The gift arriving on the picture. Small gifts slide in from the corner as a lit pill. Big ones ($10 and up) take the centre with a bloom. GiftOverlay stacks and times them on the player."
        stage={{ picture: STAGE.desk, scrim: "light", className: "min-h-[380px]" }}
        wire={`import { GiftAlert } from "@/components/xtream";

<GiftAlert emoji="🏎️" from="Amara" amountLabel="$2,500" />
<GiftAlert size="big" emoji="🐦‍🔥" from="Amara" amountLabel="$1,500" />`}
      >
        <div key={replay} className="flex h-full min-h-[330px] flex-col items-center justify-between gap-6">
          <div className="motion-safe:animate-[xt-spring-in_.64s_var(--ease-spring)_both]">
            <GiftAlert size="big" art={phoenix.art} emoji={phoenix.emoji} giftName="Phoenix" from="Amara" amountLabel="$1,500" />
          </div>
          <div className="flex w-full items-end justify-between gap-3">
            <div className="motion-safe:animate-[xt-spring-in_.64s_.25s_var(--ease-spring)_both]">
              <GiftAlert art={gift("tsion-car").art} emoji={gift("tsion-car").emoji} giftName="Tsion Car" from="satoshi.w" amountLabel="$2,500" />
            </div>
            <button type="button" onClick={() => setReplay((r) => r + 1)} className="obj press shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white">
              Replay
            </button>
          </div>
        </div>
      </Spec>

      <Spec
        name="Receipt and money"
        from="Gold Floor"
        summary="What a sender sees once a gift goes through, and how a gift reads in a history. A sheen crosses it once. Money is always the Money component: thin, wide, tabular and gold."
        rules={[<>Amounts are cents in, formatted out. Don’t hand-format dollars.</>, <>Compact ($12.5K) only where the row is tight.</>]}
        wire={`import { GiftReceipt, Money } from "@/components/xtream";

<GiftReceipt giftName="Phoenix" emoji="🐦‍🔥" cents={150000} from="Amara" to="Ada" at={new Date()} combo={2} />
<Money cents={balance} size="xl" />       // wallet
<Money cents={1250000} compact size="sm" /> // $12.5K`}
      >
        <div className="flex h-full flex-col items-start justify-center gap-7">
          <GiftReceipt giftName="Phoenix" art={phoenix.art} emoji={phoenix.emoji} cents={phoenix.usdMinor} from="Amara" to="Ada Okafor" at="17:42:08" combo={2} />
          <div className="flex flex-wrap items-end gap-x-7 gap-y-2">
            <Money cents={1284750} size="xl" />
            <Money cents={250000} size="md" />
            <Money cents={1250000} size="sm" compact />
          </div>
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Competing                                                           */
/* ------------------------------------------------------------------ */

function BattleDemo() {
  const mounted = useMounted();
  const [moment, setMoment] = useState<BattleMoment>("live");
  const [now] = useState(() => Date.now());
  return (
    <div className="flex h-full min-h-[330px] flex-col">
      <div className="relative min-h-[210px] flex-1">{mounted && <BattleBar battle={sampleBattle(moment, now)} streamId="ds-dj" className="inset-x-0 top-0 md:inset-x-0 md:top-0" />}</div>
      <PillTabs
        size="sm"
        label="Battle moment"
        items={[
          { id: "live" as const, label: "Live" },
          { id: "closing" as const, label: "Closing · ×2" },
          { id: "final" as const, label: "Final" },
        ]}
        value={moment}
        onChange={setMoment}
        className="self-start bg-black/55"
      />
    </div>
  );
}

export function Competing() {
  return (
    <Section
      id="competing"
      act="Components · competing"
      title="Two sides, one seam, and the lead called out."
      intro="Battles take the best of all three directions: Afterglow's lit pill and white-hot seam, On Air's scoreboard clock, and Gold Floor's money numerals with the lead delta. Leaderboards keep Gold Floor's rank numerals, and the pelt at the top."
    >
      <Spec
        name="Battle bar"
        from="On Air + Gold Floor"
        summary="Chili for the host, Ember for the challenger — the two brand colours, solid — meeting at a seam that burns white. The clock is a white chip, and it turns Ember with ×2 in the closing window. Backing your side is a gift, so it's a heat pill."
        stage={{ picture: STAGE.dj, scrim: "medium" }}
        wire={`import { BattleBar } from "@/components/xtream";

// Inside the player (it positions itself over the picture)
<BattleBar battle={battle} streamId={stream.id} />`}
      >
        <BattleDemo />
      </Spec>

      <Spec
        name="Pelt board"
        from="Gold Floor"
        summary="Any ranking where the number is the point: the Wolf race, a stream's top allies, a battle's backers. The leader wears the pelt, which is the one place foil appears."
        wire={`import { PeltBoard } from "@/components/xtream";

<PeltBoard title="Wolf of WorldStreet · this week" rows={rows} />
<PeltBoard title="Top allies · this stream" unit="Gifted" rows={rows} crown={null} />`}
      >
        <div className="flex h-full items-center">
          <PeltBoard title="Wolf of WorldStreet · this week" rows={SAMPLE_PELT} className="max-w-md" />
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Talking                                                             */
/* ------------------------------------------------------------------ */

export function Talking() {
  return (
    <Section
      id="talking"
      act="Components · talking"
      title="Chat is part of the picture."
      intro="On a phone, chat floats over the stream as lit bubbles, each with a face and a name in its own warm tint. The host is ringed in Ember. A gift in the chat glows, carries its face, and shows its amount in heat."
    >
      <Spec
        name="Chat bubble"
        summary="Four kinds: message, host, gift and system. On a picture it wears the object language. In the studio drawer it drops to a quiet fill (onPicture={false})."
        stage={{ picture: STAGE.rooftop, scrim: "medium", className: "flex min-h-[380px] items-end" }}
        wire={`import { ChatBubble } from "@/components/xtream";

<ChatBubble name="nneka">this is the one 🔥</ChatBubble>
<ChatBubble kind="host" name="Ada">welcome in, drop your city 👇</ChatBubble>
<ChatBubble kind="gift" name="Amara" giftEmoji="🏎️" amountLabel="$2,500">sent the Tsion Car</ChatBubble>
<ChatBubble kind="system" name="">Zara joined the stage</ChatBubble>`}
      >
        <div className="flex w-full flex-col items-start gap-1.5">
          <ChatBubble kind="system" name="">Zara joined the stage</ChatBubble>
          <ChatBubble name="nneka">this is the one 🔥</ChatBubble>
          <ChatBubble kind="host" name="Ada">welcome in, drop your city 👇</ChatBubble>
          <ChatBubble name="satoshi.w">Lagos in the building</ChatBubble>
          <ChatBubble kind="gift" name="Amara" giftArt={gift("tsion-car").art} giftEmoji={gift("tsion-car").emoji} amountLabel="$2,500">
            sent the Tsion Car
          </ChatBubble>
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Forms                                                               */
/* ------------------------------------------------------------------ */

export function Forms() {
  const [title, setTitle] = useState("Golden hour on the roof");
  const [category, setCategory] = useState("irl");
  const [post, setPost] = useState(false);
  const [quality, setQuality] = useState("auto");
  return (
    <Section
      id="forms"
      act="Components · forms"
      title="Fields without the grey box."
      intro="No outlined inputs. A field is a soft warm fill with a hairline edge, and focus draws an Ember line inside it. Labels always sit above, because a placeholder is an example, never the label. Switches and choices light up in Ember."
    >
      <Spec
        name="Fields"
        summary="TextField owns the label, the hint and the error, and keeps what you typed when something fails. SelectField switches itself to a searchable combobox past twelve options."
        wire={`import { TextField, Textarea, SelectField } from "@/components/xtream";

<TextField label="Title" value={t} onChange={…} hint="Say what's happening." required />
<TextField label="Stream key" error="That key has expired — make a new one." />
<SelectField value={c} onChange={setC} options={options} full />`}
      >
        <div className="grid max-w-md gap-5">
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} hint="Say what's happening. It shows on your card." required />
          <div className="grid gap-2">
            <label htmlFor="ds-cat" className="text-label font-medium">Category</label>
            <SelectField
              id="ds-cat"
              value={category}
              onChange={setCategory}
              full
              options={[
                { value: "irl", label: "IRL" },
                { value: "music", label: "Music" },
                { value: "chat", label: "Just Chatting" },
                { value: "markets", label: "Crypto Markets" },
              ]}
            />
          </div>
          <TextField label="Stream key" defaultValue="live_4f2a…9c" error="That key has expired — make a new one in Settings." />
          <Textarea aria-label="About your stream" placeholder="Tell viewers what they're walking into" />
        </div>
      </Spec>

      <Spec
        name="Choices"
        summary="A switch for anything that takes effect straight away, a checkbox for independent choices, and radio cards for picking exactly one. Whatever is on is Ember."
        wire={`import { SwitchField, CheckboxField, RadioCards } from "@/components/xtream";

<SwitchField label="Post to WorldSpace" checked={on} onCheckedChange={setOn} />
<RadioCards label="Video quality" name="q" value={q} onChange={setQ} options={opts} />`}
      >
        <div className="grid max-w-md gap-5">
          <SwitchField label="Post to WorldSpace" description="Stays on Xtream unless this is on." checked={post} onCheckedChange={setPost} />
          <CheckboxField label="Save the replay" description="Keeps chat alongside it." defaultChecked />
          <RadioCards
            label="Video quality"
            name="ds-quality"
            value={quality}
            onChange={setQuality}
            options={[
              { value: "auto", label: "Auto", description: "Best for the connection you have." },
              { value: "1080", label: "1080p", description: "Sharpest. Needs a strong connection." },
            ]}
          />
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Surfaces() {
  return (
    <Section
      id="surfaces"
      act="Components · surfaces"
      title="Sheets that spring, dialogs that don't trap you."
      intro="On a phone, a task comes up as a sheet you can drag: it springs to its stops, folds away to a thumb, and returns on a tap. A decision gets a dialog. Both have 28px corners, a lit top edge, and hand focus back where it came from."
    >
      <Spec
        name="Drag sheet"
        summary="The studio's drawer, reusable anywhere. Heights are fractions of the stage, and collapsible adds a thumb-only stop. The body scrolls, so the thumb and the footer stay put. Drag it or tap the thumb."
        stage={{ picture: STAGE.rooftop, scrim: "light", className: "mx-auto h-[460px] w-full max-w-[300px] rounded-[30px] p-0" }}
        wire={`import { DragSheet } from "@/components/xtream";

<div className="relative h-full">   {/* the stage it measures */}
  <DragSheet label="Your room" collapsible detents={[0.4, 0.84]} header={tabs}>
    {body}
  </DragSheet>
</div>`}
      >
        <DragSheet
          label="Example sheet"
          collapsible
          detents={[0.44, 0.84]}
          header={
            <div className="flex gap-1.5 px-3 pb-2">
              <Chip active>Chat</Chip>
              <Chip>Gifts</Chip>
              <Chip>Stage</Chip>
            </div>
          }
        >
          <div className="grid grid-cols-3 gap-2 px-3 pb-4">
            {["clap", "heart", "fire", "rocket", "crown", "phoenix"].map((id) => (
              <GiftToken key={id} gift={gift(id)} size="sm" />
            ))}
          </div>
        </DragSheet>
      </Spec>

      <Spec
        name="Dialog, sheet and tooltip"
        summary="Radix underneath: focus is trapped, Escape closes it, and focus returns to the trigger. The sheet variant anchors to the bottom for phone tasks. Tooltips add help but are never the only place something is said."
        wire={`import { Dialog, DialogTrigger, DialogContent, DialogClose, Tooltip } from "@/components/xtream";

<Dialog>
  <DialogTrigger asChild><Button variant="secondary">Stream details</Button></DialogTrigger>
  <DialogContent title="Stream details" description="…" variant="sheet">…</DialogContent>
</Dialog>`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open a dialog</Button>
            </DialogTrigger>
            <DialogContent title="End the stream?" description="Your viewers see the replay card. Chat stays up for an hour.">
              <div className="flex flex-wrap gap-2">
                <DialogClose asChild>
                  <Button variant="live">End stream</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="secondary">Keep going</Button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open a sheet</Button>
            </DialogTrigger>
            <DialogContent variant="sheet" title="Playback" description="Quality steps down on its own if the connection dips.">
              <DialogClose asChild>
                <Button className="w-full">Done</Button>
              </DialogClose>
            </DialogContent>
          </Dialog>
          <Tooltip label="Save this stream to watch later">
            <IconButton icon={Info} label="What does saving do?" />
          </Tooltip>
        </div>
      </Spec>

      <Spec
        name="Empty"
        summary="An empty screen is an invitation, so it always offers Go live, with the page's own way out beside it as the quieter button. The illustration is optional and transparent."
        wire={`import { Empty } from "@/components/xtream";

<Empty title="Nobody's live right now" body="…" action={{ label: "Browse categories", href: "/browse" }} />
<Empty title="…" goLive={false} />   // on someone else's channel`}
      >
        <Empty
          title="Nobody's live in IRL right now"
          body="Which makes this a good minute to be the one on air."
          action={{ label: "Browse categories", onClick: () => {} }}
          className="py-6 md:py-8"
        />
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Rules                                                               */
/* ------------------------------------------------------------------ */

export function Rules() {
  const block = "rounded-panel bg-surface p-5 shadow-[inset_0_0_0_1px_rgba(255,236,230,0.08)] md:p-6";
  return (
    <Section
      id="rules"
      act="Appendix · rules"
      title="The rules that keep it Afterglow."
      intro="The short version, for review and for anyone wiring a new screen. The token source is app/design-system.css, the long version is docs/design-system.md, and the one import is @/components/xtream."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className={block}>
          <h3 className="font-wide text-[18px] font-bold tracking-[-0.02em]">Colour</h3>
          <dl className="mt-4 grid gap-3 text-[14px]">
            {[
              ["Chili", "Live and action: LIVE, on air, recording, counts."],
              ["Ember", "Energy and choice: focus, selected, switched on, progress, links, streaks."],
              ["White", "The one neutral primary. Whatever is on in chips and tabs."],
              ["Heat", "Rings, Go live, gift moments. Nowhere else."],
              ["Gold", "Money only. Foil for the pelt only."],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
                <dt className={cn("font-semibold", k === "Chili" && "text-chili-hi", k === "Ember" && "text-ember-hi", k === "Heat" && "text-heat", k === "Gold" && "text-value")}>{k}</dt>
                <dd className="text-foreground/75">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className={block}>
          <h3 className="font-wide text-[18px] font-bold tracking-[-0.02em]">Borrowed flows</h3>
          <ul className="mt-4 grid gap-3 text-[14px] text-foreground/75">
            <li><b className="text-foreground">From On Air:</b> the tally, the lower third, the scoreboard clock, and wipes for broadcast graphics.</li>
            <li><b className="text-foreground">From Gold Floor:</b> thin wide money numerals, the receipt, the lead delta, the pelt board, and sheens for value.</li>
            <li><b className="text-foreground">Everything else is Afterglow:</b> lit objects, warm light, pills and orbs, and springs.</li>
          </ul>
        </div>
        <div className={block}>
          <h3 className="font-wide text-[18px] font-bold tracking-[-0.02em]">Access</h3>
          <ul className="mt-4 grid gap-3 text-[14px] text-foreground/75">
            <li>Targets are 44px, or 36px only for dense pointer tools. Focus is always a visible Ember ring.</li>
            <li>White on Chili measures 4.8:1, and ink on Ember 5.9:1. Chili-hi (6.6:1) and Ember-hi (8.6:1) are the text colours on the ground.</li>
            <li>Fields rely on their fill and a visible label. Their edge is a hairline by choice, so never drop the label.</li>
            <li>With reduced motion, every spring, burst and sheen lands instantly and the state still reads.</li>
            <li>State is never colour alone. LIVE says live, and an error says what went wrong and how to fix it.</li>
          </ul>
        </div>
        <div className={block}>
          <h3 className="font-wide text-[18px] font-bold tracking-[-0.02em]">Wiring a screen</h3>
          <ol className="mt-4 grid list-decimal gap-2 pl-5 text-[14px] text-foreground/75 marker:text-ember-hi">
            <li>Import from @/components/xtream. Never copy a component’s classes.</li>
            <li>Use roles, not hex: bg-control, text-chili-hi, text-value.</li>
            <li>Put the thing on a picture if that’s where it lives, and check it on a busy frame.</li>
            <li>Design every state, including empty, loading, error, pressed and the moment itself.</li>
            <li>Check 375, 768 and 1440 wide, and check reduced motion. Then run lint and a typecheck.</li>
          </ol>
        </div>
      </div>
      <details className="rounded-panel bg-surface p-5 shadow-[inset_0_0_0_1px_rgba(255,236,230,0.08)] md:p-6">
        <summary className="cursor-pointer font-wide text-[16px] font-bold tracking-[-0.02em]">Research behind the rules</summary>
        <ul className="mt-4 grid gap-3 text-[13.5px]">
          {sources.map((s) => (
            <li key={s.href} className="grid gap-0.5">
              <a href={s.href} target="_blank" rel="noreferrer" className="font-semibold text-ember-hi hover:underline">
                {s.title}
              </a>
              <span className="text-foreground/70">{s.decision}</span>
            </li>
          ))}
        </ul>
      </details>
    </Section>
  );
}
