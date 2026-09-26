"use client";

import { cn } from "@/lib/utils";
import { RemoteImage } from "@/components/ui/remote-image";

/**
 * Rings are where Afterglow's heat gradient lives (the allowlist): `live`
 * and `story` wear it, `seen` is a quiet hairline, `none` is a bare face.
 * The ring sits outside the avatar — it adds 8px to the footprint — with a
 * 2px gap painted in `ringGapClassName`, so pass the colour behind it
 * (the page by default; `bg-black` on a picture).
 */
export type AvatarRing = "none" | "live" | "story" | "seen";

interface UserAvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
  ring?: AvatarRing;
  ringGapClassName?: string;
}

/**
 * Get initials from a name (up to 2 characters).
 * E.g., "John Doe" → "JD", "crypto_king" → "CK"
 */
function getInitials(name: string): string {
  if (!name) return "?";

  // Split by spaces or underscores
  const parts = name.split(/[\s_]+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // Single word — take first 2 chars or just first
  return name.slice(0, 2).toUpperCase();
}

/**
 * A consistent fill for someone without a photo, picked by name — from the
 * warm neutrals and soft tints of the two brand colours only, never a
 * rainbow (owner, 2026-09-23: two colours throughout).
 */
function getColorFromName(name: string): string {
  const colors = [
    "bg-control text-foreground/85",
    "bg-control-hover text-foreground/85",
    "bg-[#3a2c2d] text-foreground/85",
    "bg-chili/25 text-chili-hi",
    "bg-ember/20 text-ember-hi",
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Avatar component that shows an image or falls back to initials, with an
 * optional ring (see `AvatarRing`).
 */
export function UserAvatar({ ring = "none", ringGapClassName, ...props }: UserAvatarProps) {
  const face = <Face {...props} />;
  if (ring === "none") return face;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full p-[2px]",
        ring === "seen" ? "bg-white/[0.14]" : "bg-heat",
      )}
    >
      <span className={cn("inline-flex rounded-full p-[2px]", ringGapClassName ?? "bg-background")}>{face}</span>
    </span>
  );
}

function Face({ src, name, size = 32, className }: Omit<UserAvatarProps, "ring" | "ringGapClassName">) {
  const initials = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        getColorFromName(name),
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      title={name}
    >
      {getInitials(name)}
    </div>
  );

  if (!src) return initials;

  return (
    <RemoteImage
      src={src}
      alt={name}
      width={size}
      height={size}
      className={cn(
        // Square whatever the photo's shape: the width attribute sizes it, and
        // without aspect-square the reset's height:auto let a 16:9 photo
        // squash a sizeless avatar into a pill.
        "aspect-square shrink-0 rounded-full bg-white/10 object-cover",
        className
      )}
      fallback={initials}
    />
  );
}
