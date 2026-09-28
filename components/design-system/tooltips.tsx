"use client";

import { useState } from "react";
import {
  ChatCircle,
  CornersOut,
  Flag,
  MonitorPlay,
  PictureInPicture,
  Prohibit,
  PushPin,
  Rows,
  SpeakerHigh,
  SpeakerSlash,
  Timer,
  Trash,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { Tip, TipBubble, type TipSide } from "@/components/ui/tip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Section, Spec, StageNote } from "./doc-parts";
import { STAGE } from "./sample-data";

/**
 * Tooltips: the word an icon can't say. The live demos are the real Tip —
 * hover, tab to them, or long-press on a phone; the anatomy draws tips
 * still, so they can be seen without a hover.
 */

/** A player control over the picture, as the watch page draws them. */
function PlayerButton({ label, hint, onClick, pressed, children }: { label: string; hint?: string; onClick?: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <Tip label={label} hint={hint}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className="press flex size-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-ember focus-visible:outline-none"
      >
        {children}
      </button>
    </Tip>
  );
}

function PlayerBar() {
  const [muted, setMuted] = useState(false);
  const [theater, setTheater] = useState(false);
  const [chat, setChat] = useState(true);
  return (
    <div className="flex h-full flex-col justify-end">
      <div className="flex items-center gap-1 rounded-full bg-black/45 p-1">
        <PlayerButton label={muted ? "Unmute" : "Mute"} hint="M" pressed={muted} onClick={() => setMuted((m) => !m)}>
          {muted ? <SpeakerSlash size={20} /> : <SpeakerHigh size={20} />}
        </PlayerButton>
        <span className="flex-1" />
        <PlayerButton label="Pop out the player" hint="P">
          <PictureInPicture size={20} />
        </PlayerButton>
        <PlayerButton label={theater ? "Exit theater mode" : "Theater mode"} hint="T" pressed={theater} onClick={() => setTheater((t) => !t)}>
          <Rows size={20} />
        </PlayerButton>
        <PlayerButton label={chat ? "Hide chat" : "Show chat"} hint="C" pressed={chat} onClick={() => setChat((c) => !c)}>
          <ChatCircle size={20} weight={chat ? "fill" : "regular"} />
        </PlayerButton>
        <PlayerButton label="Go fullscreen" hint="F">
          <CornersOut size={20} />
        </PlayerButton>
      </div>
    </div>
  );
}

/** A chat line with its hover tools held open, as a moderator sees it. */
function ChatTools() {
  const [featured, setFeatured] = useState(false);
  const tool = (label: string, icon: React.ReactNode, tone: "plain" | "danger" | "on" = "plain", onClick?: () => void) => (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          "flex size-7 items-center justify-center rounded-[8px] transition-colors",
          tone === "danger" ? "text-chili-hi hover:bg-chili/15" : tone === "on" ? "bg-ember/[0.16] text-ember-hi hover:bg-ember/25" : "text-muted-foreground hover:bg-tint/10 hover:text-foreground",
        )}
      >
        {icon}
      </button>
    </Tip>
  );
  return (
    <div className="mx-auto w-full max-w-[420px] rounded-panel bg-background p-2 pt-10">
      <div className="group relative flex gap-2 rounded-[8px] bg-tint/[0.035] px-2 py-[5px]">
        <UserAvatar src="" name="nneka" size={20} className="mt-[2px] size-5 shrink-0" />
        <p className="min-w-0 flex-1 pr-40 text-[13px] leading-[1.45] text-foreground/90">
          <span className="mr-1.5 font-semibold text-ember-hi">nneka</span>
          that drop at 2:14 was unreal
        </p>
        <div className="absolute -top-1 right-1 z-10 flex items-center gap-0.5 rounded-[10px] bg-popover p-0.5 shadow-popover">
          {featured
            ? tool("Take it off the screen", <MonitorPlay size={13} weight="fill" />, "on", () => setFeatured(false))
            : tool("Put this comment on screen", <MonitorPlay size={13} />, "plain", () => setFeatured(true))}
          {tool("Pin in chat", <PushPin size={13} />)}
          {tool("Delete this message", <Trash size={13} />)}
          {tool("Time out for 10 minutes", <Timer size={13} />)}
          {tool("Ban from this stream", <Prohibit size={13} />, "danger")}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 px-2 py-[5px]">
        <UserAvatar src="" name="kenzo" size={20} className="size-5 shrink-0" />
        <p className="min-w-0 flex-1 text-[13px] text-foreground/90">
          <span className="mr-1.5 font-semibold text-chili-hi">kenzo</span>
          run it back
        </p>
        <Tip label="Report this message" side="bottom">
          <button type="button" aria-label="Report this message" className="flex size-7 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-tint/10 hover:text-foreground">
            <Flag size={13} />
          </button>
        </Tip>
      </div>
    </div>
  );
}

const SIDES: { side: TipSide; label: string; hint?: string }[] = [
  { side: "top", label: "Mute", hint: "M" },
  { side: "right", label: "Your channel" },
  { side: "bottom", label: "Notifications" },
  { side: "left", label: "Add a guest" },
];

/** A still tip beside a stand-in trigger, for each side. */
function Anatomy() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 py-2 sm:grid-cols-4">
      {SIDES.map(({ side, label, hint }) => {
        const dot = <span aria-hidden className="size-9 shrink-0 rounded-full bg-control shadow-[inset_0_0_0_1px_var(--hairline-color)]" />;
        const bubble = <TipBubble still side={side} label={label} hint={hint} />;
        return (
          <div key={side} className="flex min-w-0 flex-col items-center gap-3">
            <div
              className={cn(
                "flex min-h-[92px] items-center justify-center gap-[9px]",
                side === "top" && "flex-col",
                side === "bottom" && "flex-col-reverse",
                side === "left" && "flex-row",
                side === "right" && "flex-row-reverse",
              )}
            >
              {bubble}
              {dot}
            </div>
            <StageNote>{side}</StageNote>
          </div>
        );
      })}
    </div>
  );
}

export function Tooltips() {
  return (
    <Section
      id="tooltips"
      act="Components · tooltips"
      title="A word when an icon needs one."
      intro="Icons carry the product, but an icon alone can't always say what it does. A tip names the action in plain words and points at the thing it names. It grows out of its arrow and leaves quicker than it came. It's help, never the only place something is said: every icon button keeps its own aria-label."
    >
      <Spec
        name="Tip"
        summary="Wrap one focusable control. Hover it for a beat, tab to it, or long-press it on a phone. Sweep along the bar and the next tip opens at once, like a desktop toolbar. The player's tips show the key that does the same thing."
        stage={{ picture: STAGE.dj, scrim: "light", className: "min-h-[260px]" }}
        rules={[
          "Label with a plain verb phrase: “Pin in chat”, “Put this comment on screen”, “Add a guest”. For a toggle, say what the click will do.",
          "Show a hint only when a key really does it (M, F, T, C, Hold V, H, ⌘K).",
          "Mouse: shows after 350 ms at rest, and right away for 450 ms after another tip. Keyboard: on focus. Touch: on a 450 ms long-press, and a tap is never held up.",
          "Pressing the control, Escape, leaving and blur all close it. Only one tip is ever open.",
          "It flips to the other side when there's no room, slides to stay 8 px inside the screen, and keeps its arrow on the trigger's centre.",
          "Motion: grows from the arrow's point (0.92 to 1), fades, and travels 5 px away on EASE.tip in 240 ms. It leaves on EASE.tipOut in 110 ms. With reduced motion it only fades.",
        ]}
        wire={`import { Tip } from "@/components/xtream";

<Tip label={muted ? "Unmute" : "Mute"} hint="M">
  <IconButton icon={SpeakerHigh} label="Mute" onClick={toggleMute} />
</Tip>

<Tip label="Collapse the sidebar" side="right" disabled={!narrow}>…</Tip>`}
      >
        <PlayerBar />
      </Spec>

      <Spec
        name="In the chat"
        summary="A moderator's tools appear when you hover a line: five small icons, each with its own name. The tip sits above the tool and points at the one under the cursor, even at the end of the row."
        rules={[
          "Tools inside a hover bar keep their aria-labels. The tip adds the same words for people who can see.",
          "A tip never covers what it names. It sits above the bar, and drops below when the line is at the top of the chat.",
        ]}
        wire={`const tool = (label: string, icon: ReactNode, onClick: () => void) => (
  <Tip label={label}>
    <button type="button" aria-label={label} onClick={onClick}>{icon}</button>
  </Tip>
);`}
      >
        <ChatTools />
      </Spec>

      <Spec
        name="Anatomy"
        summary="A solid inverse chip: light on the dark theme, ink on the light one. It has 8px corners, 12.5px medium type, and an arrow on the side facing its trigger. A shortcut sits in a quiet key cap. There's no blur and no glow, just a short soft shadow."
        rules={["bg-inverse / text-on-inverse, radius 8px, padding 5 × 10px, 260px wide at most before it wraps.", "Rendered in a portal at --layer-tooltip (70), above sheets and dialogs. In fullscreen it goes inside the fullscreen element."]}
        wire={`import { TipBubble } from "@/components/ui/tip";

// A still tip, for documentation only. It's hidden from assistive tech.
<TipBubble still side="top" label="Mute" hint="M" />`}
        wide
      >
        <Anatomy />
      </Spec>
    </Section>
  );
}
