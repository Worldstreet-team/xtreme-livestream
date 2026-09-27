"use client";

import type { ComponentProps, ReactNode } from "react";
import { CheckCircle, Info, WarningCircle } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Decorative by default: the enclosing action owns the accessible status. */
export function Spinner({ variant = "ring", className }: { variant?: "ring" | "orbit"; className?: string }) {
  return <span aria-hidden="true" className={cn("ds-spinner", variant === "orbit" && "ds-spinner-orbit", className)} />;
}

export function LoadingStatus({ label = "Loading…", variant = "ring" }: { label?: string; variant?: "ring" | "orbit" }) {
  return <span role="status" className="inline-flex items-center gap-3 text-sm text-muted-foreground"><Spinner variant={variant} />{label}</span>;
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} aria-hidden="true" className={cn("animate-pulse rounded-control bg-surface-hover motion-reduce:animate-none", className)} />;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return <div className="space-y-2"><div className="flex justify-between gap-3 text-sm"><span>{label}</span><span className="tabular-nums text-muted-foreground">{Math.round(safeValue)}%</span></div><div role="progressbar" aria-label={label} aria-valuenow={safeValue} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-tint/[0.08]"><div className="h-full origin-left rounded-full bg-ember transition-transform duration-150 motion-reduce:transition-none" style={{ transform: `scaleX(${safeValue / 100})` }} /></div></div>;
}

const tones = { info: "bg-info/10 text-info", success: "bg-success/10 text-success", warning: "bg-warning/10 text-warning", danger: "bg-destructive/10 text-destructive" };
export function Notice({ title, children, tone = "info", action, live = false }: { title: string; children?: ReactNode; tone?: keyof typeof tones; action?: ReactNode; live?: boolean }) {
  const Icon = tone === "success" ? CheckCircle : tone === "info" ? Info : WarningCircle;
  return <div role={live ? (tone === "danger" ? "alert" : "status") : undefined} className={cn("flex items-start gap-3 rounded-panel p-4", tones[tone])}>
    <Icon aria-hidden="true" size={20} className="mt-0.5 shrink-0" /><div className="min-w-0 flex-1 space-y-2"><p className="text-sm font-semibold">{title}</p>{children && <div className="text-sm leading-relaxed text-foreground">{children}</div>}{action}</div>
  </div>;
}
