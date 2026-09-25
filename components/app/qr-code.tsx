"use client";

import { useMemo } from "react";
import { qrModules } from "@/lib/qr";
import { cn } from "@/lib/utils";

/**
 * A QR code as one SVG path on a white tile — sharp at any size, and with
 * the quiet zone scanners need. The grid comes from lib/qr.ts.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const modules = qrModules(value, "M");
    const quiet = 2;
    let d = "";
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + quiet},${y + quiet}h1v1h-1z`;
      })
    );
    return { path: d, size: modules.length + quiet * 2 };
  }, [value]);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={label} className={cn("bg-white", className)}>
      <path d={path} fill="#0b0708" />
    </svg>
  );
}
