"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
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
 * Generate a consistent color based on the name.
 */
function getColorFromName(name: string): string {
  const colors = [
    "bg-red-600",
    "bg-orange-600",
    "bg-amber-600",
    "bg-yellow-600",
    "bg-lime-600",
    "bg-green-600",
    "bg-emerald-600",
    "bg-teal-600",
    "bg-cyan-600",
    "bg-sky-600",
    "bg-blue-600",
    "bg-indigo-600",
    "bg-violet-600",
    "bg-purple-600",
    "bg-fuchsia-600",
    "bg-pink-600",
    "bg-rose-600",
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Avatar component that shows an image or falls back to initials.
 */
export function UserAvatar({ src, name, size = 32, className }: UserAvatarProps) {
  const [hasError, setHasError] = useState(false);

  // Reset error state when src changes (e.g., after uploading a new avatar)
  useEffect(() => {
    setHasError(false);
  }, [src]);

  const showInitials = !src || hasError;
  const initials = getInitials(name);
  const bgColor = getColorFromName(name);

  if (showInitials) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
          bgColor,
          className
        )}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.4,
        }}
        title={name}
      >
        {initials}
      </div>
    );
  }

  // Use regular img tag for data URIs (base64 images) since Next.js Image doesn't support them
  const isDataUri = src.startsWith("data:");

  if (isDataUri) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full bg-white/10 object-cover", className)}
        onError={() => setHasError(true)}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full bg-white/10", className)}
      onError={() => setHasError(true)}
    />
  );
}
