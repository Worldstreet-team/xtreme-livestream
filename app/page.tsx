import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { Manifesto } from "@/components/landing/manifesto";
import { ChapterGoLive } from "@/components/landing/chapter-go-live";
import { ChapterBacked } from "@/components/landing/chapter-backed";
import { ChapterPaid } from "@/components/landing/chapter-paid";
import { ChapterPelt } from "@/components/landing/chapter-pelt";
import { RewardsBand } from "@/components/landing/rewards-band";
import { ChapterWorldSpace } from "@/components/landing/chapter-worldspace";
import { ChapterVivid } from "@/components/landing/chapter-vivid";
import { ChapterEveryone } from "@/components/landing/chapter-everyone";
import { Closing } from "@/components/landing/closing";
import { Footer } from "@/components/landing/footer";
import { VividVoiceProvider } from "@/components/vivid-provider";
import "@/components/landing/motion.css";
import "@/components/landing/scroll-stage.css";
import { ScrollStage } from "@/components/landing/scroll-stage";
import { PageTransition } from "@/components/landing/page-transition";

/**
 * The landing page: the platform told as a story, in the order a creator
 * lives it. Go live, get backed, get paid, wear the pelt, keep the room on
 * WorldSpace, see what the room gets (rewards), and let Vivid run it, then
 * everyone going live.
 *
 * Vivid's voice stack is mounted here as it is in the app, so Ask Vivid on
 * this page is the real assistant (with the same sign-in hand-off).
 * <ScrollStage> runs the reveals, scrubs and parallax the sections declare,
 * in the direction chosen on the Motion Board (scroll-stage.tsx); the first
 * pass, <ScrollMotion>, is retired (owner, 2026-09-27).
 */
export default function Page() {
  return (
    <VividVoiceProvider>
      <ScrollStage />
      <main className="min-h-screen overflow-x-clip bg-ground">
        <PageTransition />
        <Navbar />
        <Hero />
        <Manifesto />
        <ChapterGoLive />
        <ChapterBacked />
        <ChapterPaid />
        <ChapterPelt />
        <ChapterWorldSpace />
        <RewardsBand />
        <ChapterVivid />
        {/* Tonight ("Every kind of room") is hidden (owner, 2026-09-27); the component stays in components/landing/tonight.tsx. */}
        <ChapterEveryone />
        <Closing />
        <Footer />
      </main>
    </VividVoiceProvider>
  );
}
