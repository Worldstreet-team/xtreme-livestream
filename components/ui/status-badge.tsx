import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const tones = {
  live: "bg-chili text-white shadow-[0_6px_16px_-6px_rgba(227,18,42,0.8)]",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  neutral: "bg-white/[0.06] text-muted-foreground",
  ember: "bg-ember/15 text-ember-hi",
  value: "bg-value/10 text-value",
};

/** Always pair color with a visible label. Static badges are not live regions. */
export function StatusBadge({ tone = "neutral", children, className, ...props }: ComponentProps<"span"> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium", tones[tone], className)} {...props}>
    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{children}
  </span>;
}
