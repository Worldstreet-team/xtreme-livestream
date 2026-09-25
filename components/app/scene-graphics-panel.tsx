"use client";

import { useRef, useState, type ReactNode } from "react";
import { ImageSquare, Trash } from "@/components/icons";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-utils";
import { useNow } from "@/lib/use-now";
import {
  ACCENTS,
  LOGO_CORNER_LABELS,
  LOWER_THIRDS,
  formatCountdown,
  layerOf,
  withLayer,
  type Brand,
  type BrandAccent,
  type LogoCorner,
  type LowerThirdStyle,
  type SceneLayer,
} from "@/lib/scene";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
const FIELD =
  "h-10 w-full rounded-full bg-white/[0.06] px-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:bg-white/[0.09]";
const COUNTDOWN_MINUTES = [1, 3, 5, 10, 15, 30];

export type BrandPatch = { accent?: BrandAccent; lowerThird?: LowerThirdStyle; logo?: string };

/**
 * The studio's graphics: what's on the picture now (lower third, banner,
 * ticker, countdown, logo), and the brand kit they're drawn in.
 *
 * Each graphic keeps a draft while you type; "Show" puts it on screen,
 * "Update" swaps in what you've changed since, "Hide" takes it down and
 * keeps the words for next time. Until you type, the lower third offers
 * your name and the stream's title.
 */
export function SceneGraphicsPanel({
  layers,
  brand,
  hostName,
  streamTitle,
  carded,
  battle,
  onLayers,
  onBrand,
}: {
  layers: SceneLayer[];
  brand: Brand;
  hostName: string;
  streamTitle: string;
  /** A card is up: the lower third and banner wait under it. */
  carded: boolean;
  /** A battle has the top of the picture. */
  battle: boolean;
  /** Put a new set of graphics on air. */
  onLayers: (layers: SceneLayer[]) => void;
  /** Save part of the brand kit; rejects with a message worth showing. */
  onBrand: (patch: BrandPatch) => Promise<void>;
}) {
  const lowerThird = layerOf(layers, "lower-third");
  const banner = layerOf(layers, "banner");
  const ticker = layerOf(layers, "ticker");
  const countdown = layerOf(layers, "countdown");
  const logo = layerOf(layers, "logo");

  // Drafts: null until typed in, so they follow what's on air (a resumed
  // stream's graphics) and the defaults until then.
  const [ltTitle, setLtTitle] = useState<string | null>(null);
  const [ltSubtitle, setLtSubtitle] = useState<string | null>(null);
  const [bannerText, setBannerText] = useState<string | null>(null);
  const [tickerText, setTickerText] = useState<string | null>(null);
  const [cdLabel, setCdLabel] = useState<string | null>(null);
  const [cdMinutes, setCdMinutes] = useState(5);
  const [corner, setCorner] = useState<LogoCorner | null>(null);

  const title = (ltTitle ?? lowerThird?.title ?? hostName).slice(0, 48);
  const subtitle = (ltSubtitle ?? lowerThird?.subtitle ?? streamTitle).slice(0, 72);
  const bannerDraft = bannerText ?? banner?.text ?? "";
  const tickerDraft = tickerText ?? ticker?.text ?? "";
  const cdLabelDraft = cdLabel ?? countdown?.label ?? "";
  const cornerDraft = corner ?? logo?.corner ?? "top-right";

  const put = (layer: SceneLayer) => onLayers(withLayer(layers, layer.kind, layer));
  const take = (kind: SceneLayer["kind"]) => onLayers(withLayer(layers, kind, null));

  const lowerThirdLayer = (): SceneLayer => ({ kind: "lower-third", title: title.trim(), subtitle: subtitle.trim() });
  const countdownEnds = () => new Date(Date.now() + cdMinutes * 60_000).toISOString();

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="scenes-graphics">
        <p id="scenes-graphics" className={LABEL}>Graphics</p>
        <div className="mt-2.5 flex flex-col gap-2">
          <GraphicCard
            title="Lower third"
            on={Boolean(lowerThird)}
            canShow={Boolean(title.trim())}
            dirty={Boolean(lowerThird) && (lowerThird!.title !== title.trim() || lowerThird!.subtitle !== subtitle.trim())}
            onShow={() => put(lowerThirdLayer())}
            onHide={() => take("lower-third")}
          >
            <input
              value={title}
              onChange={(e) => setLtTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && title.trim() && put(lowerThirdLayer())}
              maxLength={48}
              placeholder="Your name, a guest's, a topic"
              aria-label="Lower third title"
              className={FIELD}
            />
            <input
              value={subtitle}
              onChange={(e) => setLtSubtitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && title.trim() && put(lowerThirdLayer())}
              maxLength={72}
              placeholder="A line under it (optional)"
              aria-label="Lower third subtitle"
              className={FIELD}
            />
          </GraphicCard>

          <GraphicCard
            title="Banner"
            on={Boolean(banner)}
            canShow={Boolean(bannerDraft.trim())}
            dirty={Boolean(banner) && banner!.text !== bannerDraft.trim()}
            onShow={() => put({ kind: "banner", text: bannerDraft.trim() })}
            onHide={() => take("banner")}
          >
            <input
              value={bannerDraft}
              onChange={(e) => setBannerText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && bannerDraft.trim() && put({ kind: "banner", text: bannerDraft.trim() })}
              maxLength={100}
              placeholder="Giveaway at 100 allies"
              aria-label="Banner text"
              className={FIELD}
            />
          </GraphicCard>

          <GraphicCard
            title="Ticker"
            on={Boolean(ticker)}
            canShow={Boolean(tickerDraft.trim())}
            dirty={Boolean(ticker) && ticker!.text !== tickerDraft.trim()}
            onShow={() => put({ kind: "ticker", text: tickerDraft.trim() })}
            onHide={() => take("ticker")}
          >
            <input
              value={tickerDraft}
              onChange={(e) => setTickerText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && tickerDraft.trim() && put({ kind: "ticker", text: tickerDraft.trim() })}
              maxLength={240}
              placeholder="Next stream Friday at 8 · Follow so you don't miss it"
              aria-label="Ticker text"
              className={FIELD}
            />
          </GraphicCard>

          <GraphicCard
            title="Countdown"
            on={Boolean(countdown)}
            canShow
            showLabel="Start"
            hideLabel="Stop"
            status={countdown ? <CountdownStatus endsAt={countdown.endsAt} /> : undefined}
            dirty={Boolean(countdown) && countdown!.label !== cdLabelDraft.trim()}
            onUpdate={() => countdown && put({ ...countdown, label: cdLabelDraft.trim() })}
            onShow={() => put({ kind: "countdown", label: cdLabelDraft.trim(), endsAt: countdownEnds() })}
            onHide={() => take("countdown")}
          >
            <input
              value={cdLabelDraft}
              onChange={(e) => setCdLabel(e.target.value)}
              maxLength={40}
              placeholder="What it's counting to (optional)"
              aria-label="Countdown label"
              className={FIELD}
            />
            {!countdown && (
              <div role="radiogroup" aria-label="How long" className="flex flex-wrap gap-1.5">
                {COUNTDOWN_MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={cdMinutes === m}
                    onClick={() => setCdMinutes(m)}
                    className={cn(
                      "press h-8 rounded-full px-3 text-[12px] font-semibold tabular-nums transition-colors",
                      cdMinutes === m ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
                    )}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            )}
          </GraphicCard>

          <GraphicCard
            title="Logo"
            on={Boolean(logo)}
            canShow={Boolean(brand.logoUrl)}
            onShow={() => put({ kind: "logo", corner: cornerDraft })}
            onHide={() => take("logo")}
          >
            {brand.logoUrl ? (
              <div className="flex items-center gap-3">
                <CornerPicker
                  value={cornerDraft}
                  onChange={(c) => {
                    setCorner(c);
                    // On screen already: it moves at once.
                    if (logo) put({ kind: "logo", corner: c });
                  }}
                />
                <span className="text-[12px] leading-snug text-muted-foreground">
                  {LOGO_CORNER_LABELS[cornerDraft]}
                  {cornerDraft === "top-right" && " — it moves left while your camera's in that corner"}
                </span>
              </div>
            ) : (
              <p className="text-[12px] leading-snug text-muted-foreground">Add your logo under Brand, below.</p>
            )}
          </GraphicCard>
        </div>
        <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
          {battle
            ? "A battle has the top of the picture — the banner and countdown come back when it ends."
            : carded
              ? "A card is up: the lower third and banner wait under it. The ticker, countdown and logo stay on top."
              : "Graphics draw sharp on every screen, whatever the viewer's connection."}
        </p>
      </section>

      <BrandKit
        brand={brand}
        onBrand={onBrand}
        onLogoRemoved={() => logo && take("logo")}
      />
    </div>
  );
}

/** One graphic: its name, whether it's on screen, and its fields. */
function GraphicCard({
  title,
  on,
  canShow,
  dirty = false,
  status,
  showLabel = "Show",
  hideLabel = "Hide",
  onShow,
  onUpdate,
  onHide,
  children,
}: {
  title: string;
  on: boolean;
  canShow: boolean;
  dirty?: boolean;
  status?: ReactNode;
  showLabel?: string;
  hideLabel?: string;
  onShow: () => void;
  /** Defaults to showing again, which replaces what's up. */
  onUpdate?: () => void;
  onHide: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-[12px] p-3 transition-colors", on ? "bg-white/[0.07]" : "bg-white/[0.04]")}>
      <div className="flex min-h-8 items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold">{title}</span>
          {on && (
            <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-medium text-ember-hi">
              <span aria-hidden className="size-1.5 rounded-full bg-ember" />
              {status ?? "On screen"}
            </span>
          )}
        </span>
        {on && dirty && (
          <button
            type="button"
            onClick={onUpdate ?? onShow}
            className="press h-8 shrink-0 rounded-full bg-white px-3.5 text-[12px] font-bold text-[#0b0708]"
          >
            Update
          </button>
        )}
        <button
          type="button"
          onClick={on ? onHide : onShow}
          disabled={!on && !canShow}
          className={cn(
            "press h-8 shrink-0 rounded-full px-3.5 text-[12px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-40",
            on ? "bg-white/[0.08] text-foreground hover:bg-white/[0.12]" : "bg-white text-[#0b0708]"
          )}
        >
          {on ? hideLabel : showLabel}
        </button>
      </div>
      <div className="mt-2.5 flex flex-col gap-2">{children}</div>
    </div>
  );
}

function CountdownStatus({ endsAt }: { endsAt: string }) {
  const now = useNow();
  const left = Date.parse(endsAt) - now;
  return <span className="tabular-nums">{left > 0 ? `${formatCountdown(left)} left` : "Done — on screen for a minute more"}</span>;
}

/** The picture drawn small, with a dot in each corner to put the logo in. */
function CornerPicker({ value, onChange }: { value: LogoCorner; onChange: (c: LogoCorner) => void }) {
  const corners: LogoCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
  return (
    <div role="radiogroup" aria-label="Logo corner" className="grid h-[46px] w-[80px] shrink-0 grid-cols-2 grid-rows-2 rounded-[8px] bg-black/50 p-1">
      {corners.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={LOGO_CORNER_LABELS[c]}
          onClick={() => onChange(c)}
          className={cn(
            "press flex p-0.5",
            c.startsWith("top") ? "items-start" : "items-end",
            c.endsWith("left") ? "justify-start" : "justify-end"
          )}
        >
          <span className={cn("h-2.5 w-4 rounded-[3px] transition-colors", value === c ? "bg-ember" : "bg-white/20 hover:bg-white/35")} />
        </button>
      ))}
    </div>
  );
}

/**
 * The brand kit: the accent every graphic wears, the lower third's shape,
 * and the logo. Saved to the channel, so it carries to every stream.
 */
function BrandKit({
  brand,
  onBrand,
  onLogoRemoved,
}: {
  brand: Brand;
  onBrand: (patch: BrandPatch) => Promise<void>;
  onLogoRemoved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accent = ACCENTS[brand.accent];

  const save = async (patch: BrandPatch) => {
    setError(null);
    try {
      await onBrand(patch);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that — try again.");
      return false;
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|webp|jpeg|svg\+xml)$/.test(file.type)) {
      setError("Use a PNG, WebP, JPEG or SVG.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("That file is over 5 MB.");
      return;
    }
    setBusy(true);
    try {
      // WebP keeps the transparency a logo needs; a busy one gets a second, smaller pass.
      let uri = await compressImage(file, 512, 0.9, "image/webp");
      if (uri.length > 190_000) uri = await compressImage(file, 320, 0.8, "image/webp");
      await onBrand({ logo: uri });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't use that image — try another.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="scenes-brand">
      <p id="scenes-brand" className={LABEL}>Brand</p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-foreground/85">Accent</span>
        <div role="radiogroup" aria-label="Accent" className="flex gap-2">
          {(Object.keys(ACCENTS) as BrandAccent[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={brand.accent === key}
              aria-label={ACCENTS[key].label}
              title={ACCENTS[key].label}
              onClick={() => brand.accent !== key && void save({ accent: key })}
              className={cn(
                "press size-7 rounded-full outline-offset-2 transition-[outline-color]",
                brand.accent === key ? "outline-2 outline-white" : "outline-2 outline-transparent hover:outline-white/25"
              )}
              style={{ background: ACCENTS[key].fill }}
            />
          ))}
        </div>
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-foreground/85">Lower third</span>
        <div role="radiogroup" aria-label="Lower third style" className="flex gap-1.5">
          {LOWER_THIRDS.map((s) => {
            const on = brand.lowerThird === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => !on && void save({ lowerThird: s.id })}
                className={cn(
                  "press flex h-9 items-center gap-2 rounded-full pr-3.5 pl-2 text-[12px] font-semibold transition-colors",
                  on ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
                )}
              >
                {/* The shape drawn small, in your accent. */}
                <span aria-hidden className={cn("flex items-center bg-[#0b0708]", s.id === "pill" ? "h-4 w-7 rounded-full p-[2px]" : "h-4 w-7 flex-col items-start justify-center gap-[2px] rounded-[3px] p-[2px]")}>
                  <span className={cn(s.id === "pill" ? "h-full w-3 rounded-full" : "h-[5px] w-4 rounded-[1px]")} style={{ background: accent.fill }} />
                  {s.id === "bar" && <span className="h-[3px] w-5 rounded-[1px] bg-white/60" />}
                </span>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <span className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-black/50 p-1.5">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the host's own logo, served versioned by the API
            <img src={brand.logoUrl} alt="Your logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageSquare size={20} className="text-muted-foreground" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="press flex h-9 items-center rounded-full bg-white/[0.07] px-3.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-white/[0.11] disabled:opacity-50"
          >
            {busy ? "Saving…" : brand.logoUrl ? "Replace logo" : "Upload logo"}
          </button>
          {brand.logoUrl && !busy && (
            <button
              type="button"
              onClick={async () => {
                if (await save({ logo: "" })) onLogoRemoved();
              }}
              aria-label="Remove logo"
              className="press flex size-9 items-center justify-center rounded-full bg-white/[0.07] text-muted-foreground transition-colors hover:bg-white/[0.11] hover:text-foreground"
            >
              <Trash size={15} />
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/webp,image/jpeg,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            void uploadLogo(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {error && <p className="mt-2.5 rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12px] text-chili-hi">{error}</p>}
      <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
        Saved to your channel: every stream&apos;s graphics wear these. A transparent PNG or SVG logo looks best.
      </p>
    </section>
  );
}
