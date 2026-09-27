"use client";

import { useEffect, useRef, useState } from "react";
import { Broadcast, Check, Eye, Gift, Heart, HeartBreak, Lightning, ShareNetwork, Sparkle, UsersThree } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  AvatarRingsRow,
  Badge,
  Button,
  CategoryCard,
  Chip,
  ChipRow,
  LiveBadge,
  LowerThird,
  Notice,
  Pill,
  PillTabs,
  StatusBadge,
  StreamCard,
  UserAvatar,
} from "@/components/xtream";
import { Section, Spec, States, StageNote } from "./doc-parts";
import { SAMPLE_CATEGORIES, SAMPLE_RINGS, SAMPLE_STREAMS, STAGE } from "./sample-data";

/* ------------------------------------------------------------------ */
/*  Actions                                                             */
/* ------------------------------------------------------------------ */

/** Go live, through its states — ready, counting in, on air — on a tap. */
function GoLiveDemo() {
  const [state, setState] = useState<"ready" | "count" | "onair">("ready");
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (state !== "onair") return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const run = () => {
    if (state === "onair") {
      setState("ready");
      return;
    }
    if (state === "count") return;
    setState("count");
    setCount(3);
    setSecs(0);
    timers.current = [
      setTimeout(() => setCount(2), 750),
      setTimeout(() => setCount(1), 1500),
      setTimeout(() => setState("onair"), 2250),
    ];
  };
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <button
      type="button"
      onClick={run}
      aria-label={state === "ready" ? "Go live — try it" : state === "count" ? `Going live in ${count}` : "On air — tap to end"}
      className={cn(
        "press inline-flex h-[52px] min-w-[150px] items-center justify-center gap-2.5 rounded-full px-6 text-[15.5px] font-semibold text-white transition-[filter,background-color,box-shadow]",
        state === "ready" && "bg-chili shadow-[inset_0_1px_0_rgba(255,255,255,0.28),var(--glow-chili)] hover:brightness-110",
        state === "count" && "bg-black/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_14px_36px_-12px_rgba(248,88,16,0.55)]",
        state === "onair" && "bg-chili shadow-[inset_0_1px_0_rgba(255,255,255,0.28),var(--glow-chili)]",
      )}
    >
      {state === "ready" && (
        <>
          <Broadcast size={19} weight="fill" /> Go live
        </>
      )}
      {state === "count" && (
        <>
          <span className="relative grid size-8 place-items-center">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full [mask:radial-gradient(circle,transparent_12px,#000_12.5px)] transition-[background] duration-500"
              style={{ background: `conic-gradient(#ffb36b ${((4 - count) / 3) * 360}deg, rgba(255,255,255,0.14) 0)` }}
            />
            <span className="font-wide text-[14px] font-extrabold">{count}</span>
          </span>
          Going live
        </>
      )}
      {state === "onair" && (
        <>
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-white" />
          </span>
          On air <span className="font-mono text-[12.5px] opacity-90">{clock}</span>
        </>
      )}
    </button>
  );
}

/** The follow button's look and burst, without touching anyone's account. */
function FollowDemo() {
  const [following, setFollowing] = useState(false);
  const [hover, setHover] = useState(false);
  const [burst, setBurst] = useState(0);
  const unfollowing = following && hover;
  return (
    <span className="relative inline-flex">
      {burst > 0 && following && (
        <span
          key={burst}
          aria-hidden
          className="pointer-events-none absolute -inset-1.5 rounded-full bg-heat p-[2px] [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)] motion-safe:animate-[xt-ring-burst_.7s_var(--ease-out)_both] motion-reduce:hidden"
        />
      )}
      <Pill
        variant={following ? "soft" : "primary"}
        tone={unfollowing ? "red" : "neutral"}
        aria-pressed={following}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          if (!following) setBurst((b) => b + 1);
          setFollowing(!following);
        }}
        icon={
          following ? (
            unfollowing ? <HeartBreak size={16} weight="fill" /> : <Check size={16} weight="bold" className="text-ember-hi" />
          ) : (
            <Heart size={16} weight="fill" />
          )
        }
      >
        {following ? (unfollowing ? "Unfollow" : "Following") : "Follow"}
      </Pill>
    </span>
  );
}

export function Actions() {
  return (
    <Section
      id="actions"
      act="Components · actions"
      title="Every action is a pill that gives under your thumb."
      intro="One shape and seven tones. Presses spring down to 94% and back on the overshoot curve, and focus is an ember ring. White is the one neutral action on a surface. Chili means live and Go live, heat means a gift, and Ember means energy."
    >
      <Spec
        name="Pill"
        summary="The product's button. Button (the Radix-friendly twin, with a loading state) shares every variant name. Icons go in `icon`, and `PILL_ICON[size]` gives the matching glyph size."
        rules={[
          <>One primary (white) per decision. Everything else is glass.</>,
          <>live is for Go live and being on air. heat is only for gifts.</>,
          <>A label says what happens: “Back Kenzo”, not “Submit”.</>,
        ]}
        wire={`import { Pill, PillLink, Button } from "@/components/xtream";

<Pill variant="primary" icon={<Heart weight="fill" size={16} />}>Follow</Pill>
<Pill variant="glass" size="sm">Share</Pill>
<PillLink href="/browse" variant="glass">Browse</PillLink>
<Button loading={saving}>Save changes</Button>   // same variants
// variant: primary · live · heat · ember · glass · soft(tone) · ghost
// size: sm 32 · md 36 · lg 44 · xl 52`}
      >
        <div className="grid gap-7">
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill variant="primary" icon={<Eye size={16} weight="bold" />}>Watch</Pill>
            <Pill variant="live" icon={<span className="size-1.5 rounded-full bg-white" />}>On air</Pill>
            <Pill variant="live" icon={<Broadcast size={16} weight="fill" />}>Go live</Pill>
            <Pill variant="ember" icon={<Lightning size={16} weight="fill" />}>Join game</Pill>
            <Pill variant="glass" icon={<ShareNetwork size={16} />}>Share</Pill>
            <Pill variant="soft" tone="ember" icon={<Sparkle size={16} weight="fill" />}>Claim 50</Pill>
            <Pill variant="soft" tone="red">Leave stage</Pill>
            <Pill variant="ghost">Not now</Pill>
          </div>
          <States
            items={[
              { label: "Rest", node: <Pill variant="primary">Follow</Pill> },
              { label: "Hover", node: <Pill variant="primary" className="bg-inverse/90">Follow</Pill> },
              { label: "Pressed", node: <Pill variant="primary" className="scale-[0.94]">Follow</Pill> },
              { label: "Busy", node: <Button loading>Saving</Button> },
            ]}
          />
          <div className="flex flex-wrap items-end gap-2.5">
            <Pill size="sm" variant="glass">sm · 32</Pill>
            <Pill size="md" variant="glass">md · 36</Pill>
            <Pill size="lg" variant="glass">lg · 44</Pill>
            <Pill size="xl" variant="glass">xl · 52</Pill>
            <Pill size="md" variant="glass" disabled>Disabled</Pill>
          </div>
        </div>
      </Spec>

      <Spec
        name="Go live"
        summary="Afterglow's signature action, and a home for heat. It counts you in, then turns solid Chili with a pulsing dot and a clock once you're on air. At that point it becomes the way back to your studio. Tap it."
        rules={[<>Heat while it’s an invitation, Chili once you’re live. Never grey.</>, <>One per screen. The top bar owns it on every page.</>]}
        stage={{ picture: STAGE.performer, scrim: "medium", className: "flex items-center justify-center" }}
        wire={`import { GoLiveButton, Pill } from "@/components/xtream";

<GoLiveButton />   // links to /studio; heat → Chili when user.isLive
<Pill variant="live" size="xl" icon={<Broadcast weight="fill" />}>Go live</Pill>`}
      >
        <div className="flex flex-col items-center gap-4">
          <GoLiveDemo />
          <StageNote>Ready → counting in → on air · tap again to end</StageNote>
        </div>
      </Spec>

      <Spec
        name="Follow"
        summary="Allying someone is a moment, so it gets a beat: a heat ring bursts out, then it settles into a quiet pill with an Ember check. Unfollow shows only while you hover, so the destructive path is never the resting state."
        stage={{ className: "flex items-center justify-center bg-heat-soft" }}
        wire={`import { FollowButton } from "@/components/xtream";

<FollowButton username="adaokafor" initialFollowing={false} />
// optimistic; sends signed-out visitors to sign in`}
      >
        <div className="flex flex-col items-center gap-4">
          <FollowDemo />
          <StageNote className="text-muted-foreground">Tap to follow · hover to see unfollow</StageNote>
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Status                                                              */
/* ------------------------------------------------------------------ */

export function Status() {
  return (
    <Section
      id="status"
      act="Components · status"
      title="Labels that read on any frame."
      intro="LIVE is solid Chili with a glow. Everything else on a picture wears the object language, and money wears gold. Off the picture, states are labelled in words as well as colour."
    >
      <Spec
        name="Badges on a picture"
        summary="LIVE, viewers, uptime, a category, a price. They're small, and they always read, however busy the frame behind them."
        stage={{ picture: STAGE.dj, scrim: "light" }}
        wire={`import { LiveBadge, Badge } from "@/components/xtream";

<LiveBadge />                                   // the tally
<Badge variant="glass" icon={<Eye size={12} weight="bold" />}>12.5K</Badge>
<Badge variant="dark">1:42:08</Badge>
<Badge variant="value">$2,500</Badge>           // money
<Badge variant="ember">×2</Badge>               // energy`}
      >
        <div className="flex h-full min-h-[200px] flex-col justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <LiveBadge size="md" />
            <LiveBadge />
            <Badge variant="glass" icon={<Eye size={12} weight="bold" />}>12.5K</Badge>
            <Badge variant="dark">1:42:08</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="glass" size="md">Music</Badge>
            <Badge variant="value" size="md">$2,500</Badge>
            <Badge variant="ember" size="md">×2</Badge>
            <Badge variant="muted" size="md">Ended</Badge>
          </div>
        </div>
      </Spec>

      <Spec
        name="Status and notices"
        summary="For states off the picture: a labelled badge for something that stays, a notice for something that happened. Never colour alone. Ended is neutral, because a stream finishing isn't a failure."
        wire={`import { StatusBadge, Notice } from "@/components/xtream";

<StatusBadge tone="live">Live</StatusBadge>
<StatusBadge tone="ember">Starting soon</StatusBadge>
<Notice tone="warning" title="Connection is unstable">…</Notice>`}
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="live">Live</StatusBadge>
            <StatusBadge tone="ember">Starting soon</StatusBadge>
            <StatusBadge tone="value">Paid out</StatusBadge>
            <StatusBadge tone="success">Connected</StatusBadge>
            <StatusBadge tone="warning">Reconnecting</StatusBadge>
            <StatusBadge>Ended</StatusBadge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Notice tone="success" title="You're allies now">Ada will hear from you when she goes live next.</Notice>
            <Notice tone="warning" title="Connection is unstable">Quality steps down while it recovers. You stay on air.</Notice>
          </div>
        </div>
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  People                                                              */
/* ------------------------------------------------------------------ */

export function People() {
  return (
    <Section
      id="people"
      act="Components · people"
      title="Faces first, in their rings."
      intro="People are the product. A face can wear a heat ring (live now or a fresh story) or a quiet one (seen). On the picture, the lower third names who's on the stage, borrowed from On Air's broadcast flow."
    >
      <Spec
        name="Avatar rings"
        summary="Every UserAvatar can take a ring. The ring sits outside the face, adding 8px, with a 2px gap painted in the colour behind it."
        wire={`import { UserAvatar, AvatarRingsRow } from "@/components/xtream";

<UserAvatar src={u.avatar} name={u.name} size={56} ring="live" />
<UserAvatar … ring="seen" ringGapClassName="bg-card" />
<AvatarRingsRow items={channels} />   // live first, heat rings`}
      >
        <div className="grid gap-7">
          <States
            items={[
              { label: "None", node: <UserAvatar name="Rolo" size={48} /> },
              { label: "Seen", node: <UserAvatar name="Nneka" size={48} ring="seen" /> },
              { label: "Story", node: <UserAvatar name="Kenzo Vale" size={48} ring="story" /> },
              { label: "Live", node: <UserAvatar name="Ada Okafor" size={48} ring="live" /> },
            ]}
          />
          <AvatarRingsRow items={SAMPLE_RINGS} />
        </div>
      </Spec>

      <Spec
        name="Lower third"
        from="On Air"
        summary="Who's on the stage, the way broadcast says it: the face in its ring, the name set wide, the tally, and one line about what's happening. On a phone it sits bottom-left above the chat. On a co-host's tile it names them."
        stage={{ picture: STAGE.rooftop, scrim: "light", className: "flex min-h-[340px] items-end" }}
        wire={`import { LowerThird, FollowButton } from "@/components/xtream";

<LowerThird
  name="Ada Okafor" avatar={a} meta="IRL · rooftop sessions"
  action={<FollowButton username="adaokafor" initialFollowing={false} size="sm" />}
/>`}
      >
        <LowerThird
          name="Ada Okafor"
          meta="IRL · rooftop sessions"
          action={<Pill size="sm" variant="primary" icon={<Heart size={14} weight="fill" />}>Follow</Pill>}
        />
      </Spec>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Discovery                                                           */
/* ------------------------------------------------------------------ */

export function Discovery() {
  const [chip, setChip] = useState("For you");
  const [tab, setTab] = useState<"live" | "categories" | "upcoming">("live");
  return (
    <Section
      id="discovery"
      act="Components · discovery"
      title="The thumbnail is the card."
      intro="No borders, no panels. The picture carries the signal (LIVE, viewers, uptime), and the words sit quietly underneath. Chips and tabs filter it, and whatever is on turns white."
    >
      <Spec
        name="Stream card"
        wide
        summary="Two targets: the picture and title open the stream, and the face and name open the channel. Finished streams show their peak and length. The compact variant is for rails and lists."
        rules={[<>Never nest the whole card in one link.</>, <>A co-live shows overlapping faces and “with Zara”.</>]}
        wire={`import { StreamCard } from "@/components/xtream";

<StreamCard stream={s} />                  // standard
<StreamCard stream={s} variant="large" />  // followed shelf
<StreamCard stream={s} variant="compact" /> // rails, lists`}
      >
        <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
          {SAMPLE_STREAMS.slice(0, 3).map((s) => (
            <StreamCard key={s.id} stream={s} />
          ))}
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <StreamCard stream={SAMPLE_STREAMS[3]} variant="compact" />
          <StreamCard stream={SAMPLE_STREAMS[2]} variant="compact" />
        </div>
        <StageNote className="mt-6 text-muted-foreground">Example content · stills from Xtream&apos;s promo clips</StageNote>
      </Spec>

      <Spec
        name="Chips and tabs"
        summary="Chips filter a feed, and tabs switch a panel. Either way, what's on is white and glows, and everything else is the quiet control. A Chili dot means something's live in there. A count rides along, turning Ember when its chip is on."
        wire={`import { Chip, ChipRow, PillTabs } from "@/components/xtream";

<ChipRow label="Categories">
  <Chip active={cat === "all"} onClick={() => setCat("all")}>For you</Chip>
  <Chip live count={12}>Music</Chip>
</ChipRow>
<PillTabs items={tabs} value={tab} onChange={setTab} label="Browse" />`}
      >
        <div className="grid gap-7">
          <ChipRow label="Example categories" className="mx-0 px-0">
            {[
              ["For you", false, null],
              ["Music", true, 12],
              ["IRL", true, 7],
              ["Just Chatting", true, 31],
              ["Markets", false, null],
              ["Gaming", false, 4],
            ].map(([name, live, count]) => (
              <Chip
                key={name as string}
                active={chip === name}
                live={live as boolean}
                count={count as number | null}
                onClick={() => setChip(name as string)}
              >
                {name as string}
              </Chip>
            ))}
          </ChipRow>
          <PillTabs
            label="Example tabs"
            items={[
              { id: "live" as const, label: "Live channels", icon: UsersThree, count: 16 },
              { id: "categories" as const, label: "Categories", icon: Gift },
              { id: "upcoming" as const, label: "Upcoming", icon: Sparkle },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="grid max-w-md grid-cols-2 gap-4">
            {SAMPLE_CATEGORIES.map((c) => (
              <CategoryCard key={c.category} category={c} />
            ))}
          </div>
        </div>
      </Spec>
    </Section>
  );
}
