"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Eye, SpeakerSlash, X } from "@/components/icons";
import { Pill } from "@/components/xtream";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { viewerViewPath } from "@/lib/viewer-view";

/**
 * "See what viewers see", in the studio's More panel while live: the
 * stream's own watch page in a frame, drawn as a viewer gets it — the
 * layout, the overlays, the chat — with its sound locked off so the host's
 * mic doesn't hear itself back. The frame joins as the host's monitor
 * (`?monitor=1` on the token route, which the watch page asks for when its
 * owner opens it): subscribe-only, never counted, and it doesn't knock the
 * broadcast off the air. `?as=viewer` (lib/viewer-view.ts) hides the host
 * controls and the app chrome inside it.
 *
 * A full-screen sheet on phones; a window on a desk, where the frame can be
 * a phone's width or the full page, since viewers come on both.
 */

const PHONE_QUERY = "(max-width: 767px)";

function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(PHONE_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

export function ViewerView({ streamId, practice = false }: { streamId: string; practice?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press flex h-11 items-center justify-center gap-2 rounded-full bg-white/[0.07] text-[14px] font-semibold text-foreground transition-colors hover:bg-white/[0.11]"
      >
        <Eye size={16} />
        See what viewers see
      </button>
      {open && <ViewerViewSheet streamId={streamId} practice={practice} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ViewerViewSheet({ streamId, practice, onClose }: { streamId: string; practice: boolean; onClose: () => void }) {
  const phone = usePhone();
  const [shown, setShown] = useState(false);
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const [reduce] = useState(prefersReducedMotion);
  const closing = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    setTimeout(onClose, reduce ? DURATION.fade : phone ? DURATION.slideOut : DURATION.fold);
  }, [onClose, phone, reduce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const ease = shown ? EASE.unfold : EASE.fold;
  const time = reduce ? DURATION.fade : phone ? (shown ? DURATION.slide : DURATION.slideOut) : shown ? DURATION.unfold : DURATION.fold;
  const panelStyle: CSSProperties = reduce
    ? { opacity: shown ? 1 : 0, transition: `opacity ${time}ms linear` }
    : phone
      ? { transform: shown ? "none" : "translateY(100%)", transition: `transform ${time}ms ${ease}` }
      : { opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(18px) scale(0.97)", transition: `opacity ${time}ms ${ease}, transform ${time}ms ${ease}` };

  const asPhone = phone || device === "phone";
  const label = practice ? "This is what viewers will see" : "This is what viewers see";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: "var(--layer-dialog)" }}>
      <div aria-hidden onClick={close} className="absolute inset-0 bg-black/75" style={{ opacity: shown ? 1 : 0, transition: `opacity ${time}ms ${ease}` }} />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="viewer-view-title"
        tabIndex={-1}
        style={panelStyle}
        className={cn(
          "relative flex flex-col overflow-hidden bg-surface-raised outline-none",
          phone ? "h-[100dvh] w-full" : "h-[min(900px,calc(100dvh-48px))] w-[min(1280px,calc(100vw-48px))] rounded-[20px] shadow-overlay",
        )}
      >
        <header className="flex shrink-0 items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 md:px-5 md:pt-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-control">
            <Eye size={18} weight="bold" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="viewer-view-title" className="truncate font-wide text-[16px] font-bold tracking-[-0.02em] md:text-[17px]">
              {label}
            </h2>
            <p className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
              <SpeakerSlash size={12} weight="fill" className="shrink-0" />
              Muted here so your mic won&apos;t echo. Viewers hear sound.
            </p>
          </div>
          {!phone && (
            <div role="radiogroup" aria-label="Screen" className="flex shrink-0 rounded-full bg-control p-1">
              {(["phone", "desktop"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={device === d}
                  onClick={() => setDevice(d)}
                  className={cn(
                    "press h-8 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                    device === d ? "bg-inverse text-on-inverse" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d === "phone" ? "Phone" : "Desktop"}
                </button>
              ))}
            </div>
          )}
          <Pill variant="glass" size="md" iconOnly icon={<X size={16} weight="bold" />} aria-label="Close" onClick={close} />
        </header>

        <div className={cn("relative min-h-0 flex-1", !phone && "bg-background px-5 pt-1 pb-5")}>
          <div
            className={cn(
              "relative mx-auto h-full overflow-hidden bg-black",
              phone ? "w-full" : asPhone ? "aspect-[390/844] max-w-full rounded-[28px] outline-8 outline-control" : "w-full rounded-[12px]",
            )}
          >
            <iframe
              src={viewerViewPath(streamId)}
              title={label}
              allow="autoplay; fullscreen; picture-in-picture"
              className="absolute inset-0 size-full border-0"
            />
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
