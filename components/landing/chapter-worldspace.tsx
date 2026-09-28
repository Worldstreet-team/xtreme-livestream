import Image from "next/image";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  ChatCircle,
  DotsThree,
  Heart,
  PaperPlaneRight,
  Phone,
  PhoneX,
  Play,
  ShareFat,
  VideoCamera,
} from "@/components/icons";
import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";
import { BoxPattern } from "./box-pattern";
import { ChapterHead, GUTTER, INK_MUTED, Illustration, PAPER, SECTION_Y, delay } from "./story-ui";

const WORLDSPACE_URL = "https://social.worldstreetgold.com";

/**
 * Chapter 05: how Xtream sits inside WorldSpace, WorldStreet's social
 * network. Three things the code actually does, one picture each: a stream
 * posts to the feed, messaging runs on the WorldSpace gateway (every thread
 * says where it came from), and calls ring across both apps.
 *
 * WorldSpace keeps its own brand (the cloud, "WorldSpace." in Poppins with
 * the full stop in its cyan), so it's drawn in its grammar, not ours.
 */
function Via() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#67DCF0]/[0.12] px-2 py-[3px] text-[11px] font-semibold text-[#67DCF0]">
      <Image src="/images/worldspace-mark-dark.png" alt="" width={12} height={12} className="size-3 object-contain" unoptimized />
      via WorldSpace
    </span>
  );
}

function Column({ title, body, label, className, children }: { title: string; body: string; label: string; className?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <Illustration label={label} reveal={false} className={cn("flex h-[30rem] flex-col overflow-hidden rounded-overlay bg-[#111112] p-5 text-foreground", className)}>
        {children}
      </Illustration>
      <div className="flex flex-col gap-2 px-1">
        <h3 className="text-[19px] font-semibold">{title}</h3>
        <p className={cn("text-[15px] leading-[1.55]", INK_MUTED)}>{body}</p>
      </div>
    </div>
  );
}

function FeedPost() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <Image src="/images/stage/dj.webp" alt="" width={40} height={40} className="size-10 rounded-full object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold">DJ LETHAL</span>
          <span className="block text-[12px] text-muted-foreground">was live on Xtream · 2h</span>
        </span>
        <DotsThree size={18} className="text-muted-foreground" />
      </div>
      <p className="text-[14px] leading-[1.5]">Friday warm-up done, the whole room showed up 🔥 replay&apos;s below, rematch next week.</p>
      <div className="relative isolate flex flex-1 flex-col justify-between overflow-hidden rounded-panel p-3">
        <Image src="/images/stage/dj.webp" alt="" fill sizes="400px" className="-z-10 object-cover" />
        <div className="flex justify-between">
          <span className="rounded-full bg-black/55 px-2.5 py-1 font-mono text-[11px]">REPLAY · 2:14:07</span>
          <span className="flex items-center gap-1.5 rounded-full bg-black/55 py-1 pr-2.5 pl-1.5 text-[11px] font-bold">
            <BrandMark size={12} /> Xtream
          </span>
        </div>
        <span className="flex size-11 items-center justify-center rounded-full bg-white text-[#0b0708]">
          <Play size={18} weight="fill" className="ml-0.5" />
        </span>
      </div>
      <div className="flex items-center gap-5 text-[13px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Heart size={17} /> 4.2K
        </span>
        <span className="flex items-center gap-1.5">
          <ChatCircle size={17} /> 318
        </span>
        <span className="flex items-center gap-1.5">
          <ShareFat size={17} /> 96
        </span>
      </div>
    </div>
  );
}

function Thread() {
  const bubble = (me: boolean, text: string) => (
    <div className={cn("flex", me ? "justify-end" : "justify-start")}>
      <p className={cn("max-w-[15.5rem] rounded-[18px] px-3.5 py-2.5 text-[14px] leading-[1.4]", me ? "bg-white text-[#0b0708]" : "bg-control")}>{text}</p>
    </div>
  );
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2.5 border-b border-hairline pb-3.5">
        <Image src="/images/stage/p-performer.webp" alt="" width={40} height={40} className="size-10 rounded-full object-cover" />
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="text-[14px] font-bold">Nneka Beats</span>
          <Via />
        </span>
        {[Phone, VideoCamera].map((Icon, i) => (
          <span key={i} className="flex size-9 items-center justify-center rounded-full bg-control">
            <Icon size={16} />
          </span>
        ))}
      </div>
      <p className="text-center text-[12px] text-muted-foreground">Nneka Beats started following you</p>
      {bubble(false, "That battle was crazy 😭 rematch Friday?")}
      {bubble(true, "Bet. Same time, 9pm. Bring the whole pack")}
      {bubble(false, "Posting it on WorldSpace now 🔥")}
      <div className="mt-auto flex items-center justify-between rounded-full bg-white/[0.06] px-4 py-3 text-[14px] text-muted-foreground">
        Message…
        <PaperPlaneRight size={16} />
      </div>
    </div>
  );
}

function IncomingCall() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-5">
      <Image src="/images/stage/film.webp" alt="" fill sizes="400px" className="-z-10 object-cover opacity-35" />
      <span className="caps font-mono text-[11px] text-foreground/70">Incoming voice call</span>
      <span className="rounded-full bg-heat p-[5px]">
        <Image src="/images/stage/film.webp" alt="" width={120} height={120} className="size-[120px] rounded-full object-cover ring-4 ring-[#111112]" />
      </span>
      <span className="flex flex-col items-center gap-2">
        <span className="font-wide text-[32px] leading-none font-bold tracking-[-0.04em]">Zara</span>
        <Via />
      </span>
      <div className="flex gap-14 pt-5">
        {[
          { Icon: PhoneX, label: "Decline", cls: "bg-chili" },
          { Icon: Phone, label: "Accept", cls: "bg-[#2EB872]" },
        ].map(({ Icon, label, cls }) => (
          <span key={label} className="flex flex-col items-center gap-2 text-[13px] text-foreground/80">
            <span className={cn("flex size-[60px] items-center justify-center rounded-full text-white", cls)}>
              <Icon size={24} weight="fill" />
            </span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ChapterWorldSpace() {
  return (
    <section id="worldspace" aria-labelledby="worldspace-title" className={cn("relative isolate scroll-mt-16 overflow-hidden", PAPER, SECTION_Y)}>
      <BoxPattern theme="feed" corner="br" />
      <div className={cn("mx-auto flex max-w-[90rem] flex-col gap-16 lg:gap-20", GUTTER)}>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <ChapterHead
            id="worldspace"
            onPaper
            eyebrow="05 / Keep the room"
            title={["The room after", "the room."]}
          />
          <div data-reveal="up" style={delay(250)} className="flex max-w-[28rem] flex-col gap-6">
            <span className="flex items-center gap-2.5">
              <Image src="/images/worldspace-mark-light.png" alt="" width={40} height={40} className="size-10 object-contain" unoptimized />
              <span className="font-poppins text-[24px] font-bold tracking-tight">
                WorldSpace<span className="text-[#1BA9C2]">.</span>
              </span>
            </span>
            <p className={cn("text-[17px] leading-[1.55]", INK_MUTED)}>
              Xtream is built on WorldSpace, WorldStreet&apos;s social network, with one account for both. Every stream posts to your feed, messages
              and calls ring across both apps, and your allies follow you from one to the other.
            </p>
            {/* A button, not the bare address (owner, 2026-09-27). */}
            <a
              href={WORLDSPACE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="press inline-flex h-12 w-fit items-center gap-2 rounded-full bg-[#0b0708] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#0b0708]/85"
            >
              Open WorldSpace
              <ArrowUpRight size={16} weight="bold" />
            </a>
          </div>
        </div>

        <div data-stage="rise" className="grid gap-12 lg:grid-cols-3 lg:gap-6">
          <Column
            title="Every stream posts to the feed"
            body="Go live and your WorldSpace followers see it. When you're done, the replay stays on the feed and the conversation keeps going."
            label="A WorldSpace post from a creator who was live on Xtream, with the stream's replay attached."
          >
            <FeedPost />
          </Column>
          <Column
            title="One inbox, two apps"
            body="Messages live on WorldSpace, so a DM sent from Xtream lands in both. Every thread says where it came from."
            label="A direct-message thread marked 'via WorldSpace', with a follow notice and three messages."
          >
            <Thread />
          </Column>
          <Column
            title="Calls ring both ways"
            body="Voice and video calls placed from Xtream ring on WorldSpace, and back again. Pick up wherever you are."
            label="An incoming voice call via WorldSpace with Decline and Accept buttons."
            className="isolate"
          >
            <IncomingCall />
          </Column>
        </div>
      </div>
    </section>
  );
}
