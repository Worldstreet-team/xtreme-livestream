"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, ImageSquare, Trash, Warning, X } from "@/components/icons";
import { QrCode } from "@/components/app/qr-code";
import { MakeACall } from "@/components/app/make-a-call";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/api-client";
import { compressImage } from "@/lib/image-utils";
import { useNow } from "@/lib/use-now";
import { serverNow, serverOffset } from "@/lib/server-clock";
import {
  ACCENTS,
  BRAND_FONT_CLASS,
  BRAND_FONT_LABELS,
  CHART_MARKETS,
  LOGO_CORNER_LABELS,
  LOWER_THIRDS,
  MARKET_SYMBOL,
  formatCountdown,
  layerOf,
  shortUrl,
  withLayer,
  type Brand,
  type BrandAccent,
  type BrandFont,
  type BrandPreset,
  type LogoCorner,
  type LowerThirdStyle,
  type SceneLayer,
} from "@/lib/scene";
import { MAX_BRAND_PRESETS, MAX_PRICE_SYMBOLS } from "@xtreme/contracts";
import { centsToDollars } from "@/lib/gifts";
import { marketBase } from "@/lib/market";
import type { CampaignView, SponsorView } from "@/lib/sponsors";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
const FIELD =
  "h-10 w-full rounded-full bg-white/[0.06] px-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:bg-white/[0.09]";
const COUNTDOWN_MINUTES = [1, 3, 5, 10, 15, 30];

export type BrandPatch = {
  accent?: BrandAccent;
  lowerThird?: LowerThirdStyle;
  font?: BrandFont;
  logo?: string;
  presets?: BrandPreset[];
};

/** A web address someone typed, as one the QR can carry ("shop.example.com" works too). */
function normalizeUrl(raw: string) {
  const t = raw.trim();
  if (!t) return "";
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString() : "";
  } catch {
    return "";
  }
}

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
  people = [],
  carded,
  battle,
  sponsors = null,
  brandKit = true,
  streamId = null,
  onLayers,
  onBrand,
}: {
  layers: SceneLayer[];
  brand: Brand;
  hostName: string;
  streamTitle: string;
  /** Who's on stage with the host — a tap puts their name in the lower third. */
  people?: { name: string; username?: string }[];
  /** A card is up: the lower third and banner wait under it. */
  carded: boolean;
  /** A battle has the top of the picture. */
  battle: boolean;
  /** The creator's own sponsors and the campaigns they've joined; null while loading. */
  sponsors?: { own: SponsorView[]; campaigns: CampaignView[] } | null;
  /** The brand kit under the graphics — the creator's own; a producer uses it as it is. */
  brandKit?: boolean;
  /** The live stream, which a market call is made on (call receipts). Unset, there's no Make a call. */
  streamId?: string | null;
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
  const cta = layerOf(layers, "cta");
  const sponsorUp = layerOf(layers, "sponsor");
  const prices = layerOf(layers, "prices");
  const callUp = layerOf(layers, "call");

  // Drafts: null until typed in, so they follow what's on air (a resumed
  // stream's graphics) and the defaults until then.
  const [ltTitle, setLtTitle] = useState<string | null>(null);
  const [ltSubtitle, setLtSubtitle] = useState<string | null>(null);
  const [bannerText, setBannerText] = useState<string | null>(null);
  const [tickerText, setTickerText] = useState<string | null>(null);
  const [cdLabel, setCdLabel] = useState<string | null>(null);
  const [cdMinutes, setCdMinutes] = useState(5);
  const [corner, setCorner] = useState<LogoCorner | null>(null);
  const [ctaTitle, setCtaTitle] = useState<string | null>(null);
  const [ctaUrl, setCtaUrl] = useState<string | null>(null);
  const [sponsorPick, setSponsorPick] = useState<string | null>(null);
  const [priceSymbols, setPriceSymbols] = useState<string[] | null>(null);
  const [pairDraft, setPairDraft] = useState("");

  const title = (ltTitle ?? lowerThird?.title ?? hostName).slice(0, 48);
  const subtitle = (ltSubtitle ?? lowerThird?.subtitle ?? streamTitle).slice(0, 72);
  const bannerDraft = bannerText ?? banner?.text ?? "";
  const tickerDraft = tickerText ?? ticker?.text ?? "";
  const cdLabelDraft = cdLabel ?? countdown?.label ?? "";
  const cornerDraft = corner ?? logo?.corner ?? "top-right";
  const ctaTitleDraft = ctaTitle ?? cta?.title ?? "";
  const ctaUrlDraft = ctaUrl ?? cta?.url ?? "";
  const ctaUrlClean = normalizeUrl(ctaUrlDraft);

  // The price strip's markets: the usual ones as chips, plus any pair typed
  // in (it gets a chip too, so it can be taken off again).
  const priceList = priceSymbols ?? prices?.symbols ?? [];
  const priceFull = priceList.length >= MAX_PRICE_SYMBOLS;
  const priceChoices = [...CHART_MARKETS, ...priceList.filter((s) => !(CHART_MARKETS as readonly string[]).includes(s))];
  const typedPair = pairDraft.trim().toUpperCase();
  const pairLooksRight = MARKET_SYMBOL.test(typedPair);
  const pairAddable = pairLooksRight && !priceList.includes(typedPair) && !priceFull;
  const togglePrice = (symbol: string) => {
    if (priceList.includes(symbol)) setPriceSymbols(priceList.filter((s) => s !== symbol));
    else if (!priceFull) setPriceSymbols([...priceList, symbol]);
  };

  // Presets: kept with the brand kit, a row per kind under its fields.
  const presets = brand.presets ?? [];
  const presetsFull = presets.length >= MAX_BRAND_PRESETS;
  const samePreset = (a: BrandPreset, b: BrandPreset) => JSON.stringify(a) === JSON.stringify(b);
  const savePreset = (preset: BrandPreset) => {
    if (presets.some((p) => samePreset(p, preset)) || presetsFull) return;
    void onBrand({ presets: [...presets, preset] }).catch(() => {});
  };
  const dropPreset = (preset: BrandPreset) => void onBrand({ presets: presets.filter((p) => !samePreset(p, preset)) }).catch(() => {});

  // Sponsors: your own deals and the campaigns you're in, one list to pick from.
  const sponsorOptions: SponsorOption[] = [
    ...(sponsors?.campaigns ?? [])
      .filter((c) => c.joined && c.status === "live")
      .map((c): SponsorOption => ({ key: `campaign:${c.id}`, source: "campaign", id: c.id, name: c.name, line: c.line, url: c.url, code: c.code, logoUrl: c.logoUrl, restricted: c.restricted, campaign: c })),
    ...(sponsors?.own ?? []).map((o): SponsorOption => ({ key: `own:${o.id}`, source: "own", id: o.id, name: o.name, line: o.line, url: o.url, code: o.code, logoUrl: o.logoUrl, restricted: o.restricted, campaign: null })),
  ];
  const upKey = sponsorUp ? `${sponsorUp.source}:${sponsorUp.sponsorId}` : null;
  const pickedKey = sponsorPick ?? upKey ?? sponsorOptions[0]?.key ?? null;
  const picked = sponsorOptions.find((o) => o.key === pickedKey) ?? null;
  const sponsorLayer = (o: SponsorOption): SceneLayer => ({
    kind: "sponsor",
    source: o.source,
    sponsorId: o.id,
    // Drawn at once in the preview; the API fills the card in from its own records.
    name: o.name,
    line: o.line,
    url: o.url,
    code: o.code,
    logoUrl: o.logoUrl,
    restricted: o.restricted,
  });

  const put = (layer: SceneLayer) => onLayers(withLayer(layers, layer.kind, layer));
  const take = (kind: SceneLayer["kind"]) => onLayers(withLayer(layers, kind, null));

  const lowerThirdLayer = (): SceneLayer => ({ kind: "lower-third", title: title.trim(), subtitle: subtitle.trim() });
  const ctaLayer = (): SceneLayer => ({ kind: "cta", title: ctaTitleDraft.trim(), url: ctaUrlClean });
  // Stamped on the server's clock, so it ends at the same moment for every viewer.
  const countdownEnds = () => new Date(serverNow() + cdMinutes * 60_000).toISOString();

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
            {people.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Names on stage">
                {[{ name: hostName, username: undefined as string | undefined, you: true }, ...people.map((p) => ({ ...p, you: false }))].map((p) => (
                  <button
                    key={`${p.name}-${p.username ?? "you"}`}
                    type="button"
                    onClick={() => {
                      setLtTitle(p.name);
                      setLtSubtitle(p.you ? streamTitle.slice(0, 72) : p.username ? `@${p.username}` : "");
                    }}
                    className="press h-7 max-w-full truncate rounded-full bg-white/[0.06] px-2.5 text-[11.5px] font-semibold text-foreground/85 transition-colors hover:bg-white/[0.1]"
                  >
                    {p.you ? "You" : p.name}
                  </button>
                ))}
              </div>
            )}
            <PresetRow
              presets={presets.filter((p): p is Extract<BrandPreset, { kind: "lower-third" }> => p.kind === "lower-third")}
              label={(p) => (p.subtitle ? `${p.title} · ${p.subtitle}` : p.title)}
              onPick={(p) => {
                setLtTitle(p.title);
                setLtSubtitle(p.subtitle);
              }}
              onDrop={dropPreset}
              canSave={Boolean(title.trim()) && !presetsFull}
              onSave={() => savePreset({ kind: "lower-third", title: title.trim(), subtitle: subtitle.trim() })}
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
            <PresetRow
              presets={presets.filter((p): p is Extract<BrandPreset, { kind: "banner" }> => p.kind === "banner")}
              label={(p) => p.text}
              onPick={(p) => setBannerText(p.text)}
              onDrop={dropPreset}
              canSave={Boolean(bannerDraft.trim()) && !presetsFull}
              onSave={() => savePreset({ kind: "banner", text: bannerDraft.trim() })}
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
            <PresetRow
              presets={presets.filter((p): p is Extract<BrandPreset, { kind: "ticker" }> => p.kind === "ticker")}
              label={(p) => p.text}
              onPick={(p) => setTickerText(p.text)}
              onDrop={dropPreset}
              canSave={Boolean(tickerDraft.trim()) && !presetsFull}
              onSave={() => savePreset({ kind: "ticker", text: tickerDraft.trim() })}
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
            title="Prices"
            on={Boolean(prices)}
            canShow={priceList.length > 0}
            status={prices ? `${prices.symbols.map(marketBase).join(", ")} on screen` : undefined}
            dirty={Boolean(prices) && prices!.symbols.join(",") !== priceList.join(",")}
            onShow={() => put({ kind: "prices", symbols: priceList })}
            // Every market taken off while it's up: the strip comes down rather than go up empty.
            onUpdate={() => (priceList.length > 0 ? put({ kind: "prices", symbols: priceList }) : take("prices"))}
            onHide={() => take("prices")}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-muted-foreground">Markets on the strip</span>
              <span className="font-mono text-[11.5px] font-semibold text-muted-foreground tabular-nums">
                {priceList.length} of {MAX_PRICE_SYMBOLS}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label="Markets">
              {priceChoices.map((m) => {
                const on = priceList.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && priceFull}
                    onClick={() => togglePrice(m)}
                    className={cn(
                      "press h-8 rounded-full px-3 font-mono text-[11.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40",
                      on ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
                    )}
                  >
                    {m.replace("-", "/")}
                  </button>
                );
              })}
            </div>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!pairAddable) return;
                togglePrice(typedPair);
                setPairDraft("");
              }}
            >
              <input
                value={pairDraft}
                onChange={(e) => setPairDraft(e.target.value)}
                placeholder="Another pair, like ADA-USD"
                aria-label="Another market"
                maxLength={15}
                className="h-9 min-w-0 flex-1 rounded-full bg-white/[0.06] px-3.5 font-mono text-[12.5px] text-foreground uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground focus:bg-white/[0.09]"
              />
              <button
                type="submit"
                disabled={!pairAddable}
                className="press h-9 shrink-0 rounded-full bg-white/[0.08] px-3.5 text-[12px] font-bold text-foreground transition-colors hover:bg-white/[0.12] disabled:pointer-events-none disabled:opacity-40"
              >
                Add
              </button>
            </form>
            {typedPair && !pairLooksRight && <p className="text-[11.5px] text-chili-hi">A market looks like BTC-USD.</p>}
            {typedPair && pairLooksRight && priceFull && !priceList.includes(typedPair) && (
              <p className="text-[11.5px] text-chili-hi">Five at most — take one off to add another.</p>
            )}
            <p className="text-[12px] leading-snug text-muted-foreground">
              Live prices on every viewer&apos;s screen, from Coinbase, always marked &ldquo;Not financial advice&rdquo;. No links, no buy buttons.
            </p>
          </GraphicCard>

          {streamId && (
            <MakeACall
              // A new broadcast starts afresh: "Show again" is only ever this stream's call.
              key={streamId}
              streamId={streamId}
              strip={prices?.symbols ?? []}
              up={callUp}
              carded={carded}
              battle={battle}
              onPut={(layer) => put(layer)}
              onTake={() => take("call")}
            />
          )}

          <GraphicCard
            title="QR code"
            on={Boolean(cta)}
            canShow={Boolean(ctaTitleDraft.trim() && ctaUrlClean)}
            dirty={Boolean(cta) && (cta!.title !== ctaTitleDraft.trim() || cta!.url !== ctaUrlClean)}
            onShow={() => put(ctaLayer())}
            onHide={() => take("cta")}
          >
            <div className="flex gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <input
                  value={ctaTitleDraft}
                  onChange={(e) => setCtaTitle(e.target.value)}
                  maxLength={40}
                  placeholder="Scan for merch"
                  aria-label="What the QR code is for"
                  className={FIELD}
                />
                <input
                  value={ctaUrlDraft}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ctaTitleDraft.trim() && ctaUrlClean && put(ctaLayer())}
                  inputMode="url"
                  maxLength={300}
                  placeholder="shop.example.com/merch"
                  aria-label="Where it goes"
                  className={FIELD}
                />
              </div>
              {/* What viewers will scan, as they'll see it. */}
              <span className="flex size-[88px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white/[0.06]">
                {ctaUrlClean ? (
                  <QrCode value={ctaUrlClean} label={`QR code for ${shortUrl(ctaUrlClean)}`} className="size-full rounded-[10px]" />
                ) : (
                  <span className="px-2 text-center text-[10.5px] leading-tight text-muted-foreground">Add a link to see its code</span>
                )}
              </span>
            </div>
            {ctaUrlDraft.trim() && !ctaUrlClean && <p className="text-[11.5px] text-chili-hi">That doesn&apos;t look like a web address.</p>}
          </GraphicCard>

          <GraphicCard
            title="Sponsor"
            on={Boolean(sponsorUp)}
            canShow={Boolean(picked)}
            status={sponsorUp ? `${sponsorUp.name} · Paid promotion` : undefined}
            dirty={Boolean(sponsorUp && picked && picked.key !== upKey)}
            onShow={() => picked && put(sponsorLayer(picked))}
            onHide={() => take("sponsor")}
          >
            {sponsors === null ? (
              <div className="h-8 w-40 animate-pulse rounded-full bg-white/[0.06]" />
            ) : sponsorOptions.length === 0 ? (
              <p className="text-[12px] leading-snug text-muted-foreground">
                Add a brand you&apos;ve made a deal with, or join an Xtream campaign that pays you to run its card.{" "}
                {/* A new tab: leaving the studio mid-broadcast would drop the feed. */}
                <Link href="/sponsorships" target="_blank" rel="noopener" className="font-semibold text-ember-hi hover:underline">
                  Set up sponsors
                </Link>
              </p>
            ) : (
              <>
                <div role="radiogroup" aria-label="Which sponsor" className="flex flex-wrap gap-1.5">
                  {sponsorOptions.map((o) => {
                    const on = o.key === pickedKey;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setSponsorPick(o.key)}
                        className={cn(
                          "press flex h-8 max-w-full items-center gap-1.5 rounded-full pr-3 pl-1 text-[12px] font-semibold transition-colors",
                          on ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
                        )}
                      >
                        <SponsorMark name={o.name} logoUrl={o.logoUrl} />
                        <span className="truncate">{o.name}</span>
                        {o.campaign && (
                          <span className={cn("shrink-0 font-mono text-[10.5px] font-bold tabular-nums", on ? "text-[#0b0708]/60" : "text-value")}>
                            {centsToDollars(o.campaign.payPerStreamUsdMinor)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {picked && (
                  <p className="text-[12px] leading-snug text-muted-foreground">
                    {picked.campaign
                      ? `Xtream campaign: pays ${centsToDollars(picked.campaign.payPerStreamUsdMinor)} once it's been up ${picked.campaign.minMinutes} min while you're live · ${picked.campaign.paidStreams} of ${picked.campaign.maxStreamsPerCreator} streams paid.`
                      : "Your own deal — the brand pays you directly."}{" "}
                    The card always says &ldquo;Paid promotion&rdquo;.
                  </p>
                )}
                {picked?.restricted && (
                  <p className="flex items-start gap-1.5 text-[12px] leading-snug text-warning">
                    <Warning size={13} weight="fill" className="mt-px shrink-0" />
                    Viewers in Nigeria won&apos;t see this card — crypto, betting and alcohol promotions aren&apos;t allowed there.
                  </p>
                )}
                <Link
                  href="/sponsorships"
                  target="_blank"
                  rel="noopener"
                  className="flex w-fit items-center gap-1 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  Manage sponsors
                  <ArrowUpRight size={12} weight="bold" />
                </Link>
              </>
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
            ? `A battle has the top of the picture — the banner, prices${callUp ? ", call" : ""} and countdown come back when it ends.`
            : carded
              ? `A card is up: the lower third, banner${callUp ? ", prices and call wait" : " and prices wait"} under it. The ticker, countdown and logo stay on top.`
              : "Graphics draw sharp on every screen, whatever the viewer's connection."}
        </p>
      </section>

      {brandKit && <BrandKit brand={brand} onBrand={onBrand} onLogoRemoved={() => logo && take("logo")} />}
    </div>
  );
}

interface SponsorOption {
  key: string;
  source: "own" | "campaign";
  id: string;
  name: string;
  line: string;
  url: string;
  code: string;
  logoUrl: string | null;
  restricted: boolean;
  campaign: CampaignView | null;
}

/** A sponsor's mark, small: its logo on white, or its initial. */
function SponsorMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return logoUrl ? (
    <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-0.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- the sponsor's logo, served versioned by the API */}
      <img src={apiUrl(logoUrl)} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  ) : (
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ember text-[11px] font-bold text-on-ember">
      {name.trim().charAt(0).toUpperCase()}
    </span>
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
  const now = useNow() + serverOffset();
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

/** Saved graphics of one kind: tap to use, × to forget, and Save for what's in the fields. */
function PresetRow<P extends BrandPreset>({
  presets,
  label,
  onPick,
  onDrop,
  canSave,
  onSave,
}: {
  presets: P[];
  label: (p: P) => string;
  onPick: (p: P) => void;
  onDrop: (p: P) => void;
  canSave: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {presets.map((p) => (
        <span key={label(p)} className="group/preset flex h-7 max-w-full items-center rounded-full bg-white/[0.06] transition-colors hover:bg-white/[0.1]">
          <button type="button" onClick={() => onPick(p)} className="min-w-0 truncate pl-2.5 text-[11.5px] font-medium text-foreground/85" title={label(p)}>
            {label(p).length > 28 ? `${label(p).slice(0, 27)}…` : label(p)}
          </button>
          <button
            type="button"
            onClick={() => onDrop(p)}
            aria-label={`Forget “${label(p)}”`}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className="press h-7 rounded-full px-2 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        + Save for later
      </button>
    </div>
  );
}

/**
 * The brand kit: the accent every graphic wears, the lower third's shape,
 * and the logo. Saved to the channel, so it carries to every stream.
 */
export function BrandKit({
  brand,
  onBrand,
  onLogoRemoved,
  heading = true,
}: {
  brand: Brand;
  onBrand: (patch: BrandPatch) => Promise<void>;
  onLogoRemoved: () => void;
  /** The studio names the section; Settings has its own heading. */
  heading?: boolean;
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
    <section aria-labelledby={heading ? "scenes-brand" : undefined} aria-label={heading ? undefined : "Brand kit"}>
      {heading && <p id="scenes-brand" className={LABEL}>Brand</p>}

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

      {/* Four faces don't fit beside a label in the studio's column — they get their own line. */}
      <div className="mt-3.5 flex flex-col gap-2">
        <span className="text-[13px] font-medium text-foreground/85">Titles</span>
        <div role="radiogroup" aria-label="Title font" className="flex flex-wrap gap-1.5">
          {(Object.keys(BRAND_FONT_CLASS) as BrandFont[]).map((f) => {
            const on = brand.font === f;
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={on}
                title={BRAND_FONT_LABELS[f]}
                onClick={() => !on && void save({ font: f })}
                className={cn(
                  "press flex h-9 items-center rounded-full px-3 text-[12px] transition-colors",
                  on ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
                )}
              >
                {/* Each face shown in itself. */}
                <span className={cn("text-[14px] leading-none font-bold", BRAND_FONT_CLASS[f])}>Aa</span>
                <span className="ml-1.5 font-semibold">{BRAND_FONT_LABELS[f]}</span>
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
