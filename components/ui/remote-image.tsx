"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Image renderer for *user-supplied* sources — avatars from Clerk/OAuth
 * providers and stream thumbnails uploaded as base64 data URIs.
 *
 * Deliberately not `next/image`. Its loader validates the source against
 * `images.remotePatterns` and **throws during render** for anything that
 * doesn't match (`next/dist/shared/lib/image-loader.js`, error E231) — in
 * production as well as dev, despite the stale comment there saying otherwise.
 * A data URI fails that check too: it doesn't start with "/", so it takes the
 * remote branch and parses to an empty hostname.
 *
 * Two consequences made this unusable here:
 *   - every Clerk avatar (`https://img.clerk.com/...`) crashed the tree,
 *   - every auto-captured stream thumbnail (a data URI) crashed Explore,
 *     the landing page and the dashboard.
 *
 * A throw is not catchable by `onError`, so there was no way to degrade
 * gracefully while still routing these through `next/image`. Sources here are
 * already small — thumbnails are client-compressed to ~640px before upload —
 * so the optimizer wasn't buying much anyway.
 */
interface RemoteImageProps {
  src: string;
  alt: string;
  /** Absolutely fill the nearest positioned ancestor (mirrors next/image's `fill`). */
  fill?: boolean;
  width?: number;
  height?: number;
  className?: string;
  /** Rendered in place of the image if it fails to load. */
  fallback?: React.ReactNode;
}

export function RemoteImage({
  src,
  alt,
  fill = false,
  width,
  height,
  className,
  fallback = null,
}: RemoteImageProps) {
  // Track *which* source failed rather than a bare boolean: a new src is then
  // automatically a fresh attempt, so replacing a broken thumbnail doesn't
  // leave the fallback stuck on screen — and no reset effect is needed.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      {...(fill ? {} : { width, height })}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={cn(fill && "absolute inset-0 size-full", className)}
    />
  );
}
