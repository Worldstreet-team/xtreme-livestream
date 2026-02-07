"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Lightning, Play } from "@phosphor-icons/react";
import { WebcamPixelGrid } from "@/components/ui/webcam-pixel-grid";

export function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Webcam pixel grid background */}
      <div className="absolute inset-0">
        <WebcamPixelGrid
          gridCols={60}
          gridRows={40}
          maxElevation={50}
          motionSensitivity={0.25}
          elevationSmoothing={0.2}
          colorMode="webcam"
          backgroundColor="#030303"
          mirror={true}
          gapRatio={0.05}
          invertColors={false}
          darken={0.6}
          borderColor="#ffffff"
          borderOpacity={0.06}
          className="w-full h-full"
        />
      </div>

      {/* Gradient overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

      {/* Red accent glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[600px] rounded-full bg-primary/15 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 size-[400px] rounded-full bg-primary/10 blur-[100px] pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8 pt-16">
        {/* Live badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary backdrop-blur-sm">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Live Now — 2.4K+ Streamers Online
        </div>

        {/* Heading */}
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl leading-[1.1]">
          Your Bags Are{" "}
          <span className="bg-gradient-to-r from-primary via-red-400 to-orange-400 bg-clip-text text-transparent">
            Pumping.
          </span>
          <br />
          <span className="text-foreground/90">Your Stream Should Be Too.</span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
          Go live, flex your alpha, and get tipped in crypto — all while the
          charts do the talking. Welcome to the degen side of streaming.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="h-12 gap-2 rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/80 hover:shadow-primary/40 transition-all"
          >
            <Link href="/studio">
              <Lightning size={20} weight="fill" />
              Start Streaming
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-12 gap-2 rounded-xl border-white/10 bg-white/5 px-8 text-base font-semibold backdrop-blur-sm hover:bg-white/10 hover:border-white/20 transition-all"
          >
            <Link href="/explore">
              <Play size={20} weight="fill" />
              Explore Streams
            </Link>
          </Button>
        </div>

        {/* Stats row */}
        <div className="mt-16 flex flex-wrap items-center justify-center gap-8 sm:gap-12">
          {[
            { value: "50K+", label: "Active Streamers" },
            { value: "1.2M+", label: "Monthly Viewers" },
            { value: "$4.8M", label: "Creator Earnings" },
            { value: "24/7", label: "Live Content" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold text-foreground sm:text-3xl">
                {stat.value}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
}
