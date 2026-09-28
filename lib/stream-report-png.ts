import { ellipsize, formatResultDate, wrapLines } from "@/lib/battle-result";
import { families, loadFonts, roundRect, toPng, typesetter } from "@/lib/battle-result-png";
import { durationLabel, type StreamReportData } from "@/lib/stream-report";

/**
 * The post-live recap as a 1080×1350 PNG, drawn by hand on a canvas the way
 * the battle result card is (lib/battle-result-png.ts, whose type setting it
 * borrows): the headline, the stream's title, four numbers and the audience
 * curve, on the Afterglow ground. No money on it — what a stream earned is
 * the host's business, not the post's — and no logo (the chili isn't
 * licensed for posted images; MARK_ON_CARD in lib/battle-result.ts).
 */

export const RECAP_W = 1080;
export const RECAP_H = 1350;

const PAINT = {
  ground: "#0b0708",
  panel: "rgba(255, 255, 255, 0.05)",
  ink: "#f6f1ee",
  muted: "#a89f9a",
  ember: "#f85810",
  emberHi: "#ff8a4c",
  emberField: "rgba(248, 88, 16, 0.16)",
  chili: "#e3122a",
} as const;

const PAD = 72;

export function recapFileName(r: StreamReportData) {
  const day = (r.stream.startedAt ?? new Date().toISOString()).slice(0, 10);
  const slug = r.stream.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "stream";
  return `xtream-recap-${slug}-${day}.png`;
}

/** The four numbers the card carries: the ones worth showing off. */
export function recapNumbers(r: StreamReportData): Array<{ label: string; value: string }> {
  const s = r.analytics?.summary;
  return [
    { label: "Peak viewers", value: String(s?.peakViewers ?? 0) },
    { label: "Watched by", value: String(s?.uniqueViewers ?? 0) },
    { label: "New allies", value: String(s?.newAllies ?? 0) },
    { label: "Chat messages", value: String(s?.chats ?? 0) },
  ];
}

export async function renderRecapPng(r: StreamReportData, handle: string): Promise<Blob> {
  const fam = families();
  const headline = r.tone === "good" ? "Nice stream!" : "Live on Xtream";
  const numbers = recapNumbers(r);
  await loadFonts(fam, [headline, r.stream.title, handle, ...numbers.map((n) => `${n.label} ${n.value}`), "STREAM RECAP 0123456789 min h s ·"].join(" "));

  const canvas = document.createElement("canvas");
  canvas.width = RECAP_W;
  canvas.height = RECAP_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the image");
  const type = typesetter(ctx, fam);

  ctx.fillStyle = PAINT.ground;
  ctx.fillRect(0, 0, RECAP_W, RECAP_H);

  // The eyebrow, and the date across from it.
  let y = PAD + 28;
  type.set("mono", 26, 500);
  type.write("STREAM RECAP", PAD, y, PAINT.muted);
  const date = r.stream.startedAt ? formatResultDate(r.stream.startedAt) : "";
  type.write(date, RECAP_W - PAD, y, PAINT.muted, "right");

  // The headline, big.
  y += 150;
  type.set("display", 118, 800);
  type.write(headline, PAD, y, PAINT.ink);

  // The title, up to two lines.
  y += 84;
  type.set("sans", 46, 600);
  const width = (t: string) => {
    type.set("sans", 46, 600);
    return ctx.measureText(t).width;
  };
  const title = wrapLines(r.stream.title || "Untitled stream", RECAP_W - PAD * 2, width, 2);
  for (const line of title.lines) {
    type.set("sans", 46, 600);
    type.write(line, PAD, y, PAINT.ink);
    y += 58;
  }
  type.set("sans", 34, 500);
  const byline = ellipsize(`${handle} · ${durationLabel(r.stream.durationSeconds)} on air`, RECAP_W - PAD * 2, (t) => {
    type.set("sans", 34, 500);
    return ctx.measureText(t).width;
  });
  type.set("sans", 34, 500);
  type.write(byline, PAD, y + 4, PAINT.muted);

  // Four numbers, two by two.
  const gridTop = y + 60;
  const gap = 20;
  const cellW = (RECAP_W - PAD * 2 - gap) / 2;
  const cellH = 188;
  numbers.forEach((n, i) => {
    const cx = PAD + (i % 2) * (cellW + gap);
    const cy = gridTop + Math.floor(i / 2) * (cellH + gap);
    roundRect(ctx, cx, cy, cellW, cellH, 32);
    ctx.fillStyle = PAINT.panel;
    ctx.fill();
    type.set("mono", 22, 500);
    type.write(n.label.toUpperCase(), cx + 36, cy + 58, PAINT.muted);
    type.set("money", 88, 300);
    type.write(n.value, cx + 36, cy + 154, PAINT.ink);
  });

  // The audience curve: an ember line over a flat ember field.
  const curveTop = gridTop + cellH * 2 + gap + 56;
  const curveBottom = RECAP_H - PAD - 70;
  const minutes = r.analytics?.minutes ?? [];
  const top = Math.max(1, ...minutes.map((m) => m.viewers));
  if (minutes.some((m) => m.viewers > 0)) {
    type.set("mono", 22, 500);
    type.write("VIEWERS, MINUTE BY MINUTE", PAD, curveTop - 18, PAINT.muted);
    const n = minutes.length;
    const x = (i: number) => PAD + (n === 1 ? (RECAP_W - PAD * 2) / 2 : (i / (n - 1)) * (RECAP_W - PAD * 2));
    const yOf = (v: number) => curveBottom - (v / top) * (curveBottom - curveTop - 24);
    ctx.beginPath();
    minutes.forEach((m, i) => (i === 0 ? ctx.moveTo(x(i), yOf(m.viewers)) : ctx.lineTo(x(i), yOf(m.viewers))));
    ctx.lineTo(x(n - 1), curveBottom);
    ctx.lineTo(x(0), curveBottom);
    ctx.closePath();
    ctx.fillStyle = PAINT.emberField;
    ctx.fill();
    ctx.beginPath();
    minutes.forEach((m, i) => (i === 0 ? ctx.moveTo(x(i), yOf(m.viewers)) : ctx.lineTo(x(i), yOf(m.viewers))));
    ctx.strokeStyle = PAINT.ember;
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  } else {
    roundRect(ctx, PAD, curveTop, RECAP_W - PAD * 2, curveBottom - curveTop, 32);
    ctx.fillStyle = PAINT.panel;
    ctx.fill();
    type.set("sans", 34, 500);
    type.write("Every channel starts with one viewer.", RECAP_W / 2, (curveTop + curveBottom) / 2 + 12, PAINT.muted, "center");
  }

  // The foot: where to find the next one, and the tally light.
  const footY = RECAP_H - PAD + 4;
  ctx.beginPath();
  ctx.arc(PAD + 10, footY - 11, 10, 0, Math.PI * 2);
  ctx.fillStyle = PAINT.chili;
  ctx.fill();
  type.set("display", 34, 700);
  type.write("Xtream", PAD + 34, footY, PAINT.ink);
  type.set("sans", 30, 500);
  type.write(`Catch the next one · ${handle}`, RECAP_W - PAD, footY, PAINT.muted, "right");

  return toPng(canvas);
}
