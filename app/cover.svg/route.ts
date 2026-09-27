import { coverSvg } from "@/lib/cover-art";

/**
 * GET /cover.svg?c=<category>&w=&h=[&t=light] — a category's cover, drawn
 * on the server from its name (see lib/cover-art). The drawing data (the
 * outlined type and the icon marks) stays here instead of in every client
 * bundle; the browser caches each cover for good, and `v` in the URL moves
 * when the drawing changes. The path ends in .svg, so the auth middleware's
 * static-file rule already lets it through without a session.
 */
export function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const size = (key: string, fallback: number) => {
    const v = Number.parseInt(q.get(key) ?? "", 10);
    return Number.isFinite(v) ? Math.min(4096, Math.max(16, v)) : fallback;
  };
  const svg = coverSvg((q.get("c") ?? "").slice(0, 120), {
    w: size("w", 480),
    h: size("h", 640),
    theme: q.get("t") === "light" ? "light" : "dark",
  });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      // Opened on its own, the SVG is a document: it never needs script.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
