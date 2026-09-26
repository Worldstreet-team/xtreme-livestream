"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, MonitorPlay } from "@/components/icons";
import { QrCode } from "@/components/app/qr-code";
import { cn } from "@/lib/utils";

const noSubscribe = () => () => {};

/**
 * Producer mode's way in, from the studio: the console's address, to open
 * on a second device — a laptop beside the phone you stream from — or to
 * send a producer you've named. A link to copy, and a code to scan.
 */
export function ConsoleLink({ username }: { username: string }) {
  // The address as this browser reaches the app; empty on the server's paint.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const url = `${origin}/produce/${username}`;
  const shown = url.replace(/^https?:\/\//, "");
  const [copied, setCopied] = useState(false);
  const [scan, setScan] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // No clipboard (an insecure origin): the address is on screen to type.
    }
  };

  return (
    <div className="rounded-[14px] bg-white/[0.04] p-3.5">
      <p className="flex items-center gap-2 text-[13.5px] font-semibold">
        <MonitorPlay size={16} className="text-ember-hi" />
        Run it from another device
      </p>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Scenes, graphics, the run of show and the stage — on a laptop beside you, or with a producer you&apos;ve named in Settings. It
        watches without being counted.
      </p>
      <div className="mt-3 flex items-center gap-1.5">
        <span className="h-9 min-w-0 flex-1 truncate rounded-full bg-white/[0.06] px-3.5 font-mono text-[12px] leading-9 text-foreground/85" title={url}>
          {shown}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-[12.5px] font-bold text-[#0b0708]"
        >
          {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={() => setScan((s) => !s)}
          aria-pressed={scan}
          aria-expanded={scan}
          className={cn(
            "press h-9 shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
            scan ? "bg-white/[0.14] text-foreground" : "bg-white/[0.07] text-foreground hover:bg-white/[0.11]"
          )}
        >
          Scan
        </button>
      </div>
      {scan && origin && (
        <div className="mt-3 flex items-center gap-3.5">
          <QrCode value={url} label={`QR code for ${shown}`} className="size-28 shrink-0 rounded-[10px]" />
          <p className="text-[12px] leading-snug text-muted-foreground">
            Point the other device&apos;s camera here. It signs in as whoever uses it — you, or your producer.
          </p>
        </div>
      )}
    </div>
  );
}
