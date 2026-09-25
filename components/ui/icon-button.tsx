"use client";

import { Check, WarningCircle, type Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export function IconButton({ icon: IconGlyph, label, selected, state = "idle", className, disabled, ...props }: Omit<ComponentProps<typeof Button>, "children" | "asChild" | "loading" | "size"> & { icon: Icon; label: string; selected?: boolean; state?: "idle" | "pending" | "success" | "error" }) {
  return <Button {...props} size="icon" variant={props.variant ?? "ghost"} disabled={disabled} aria-disabled={disabled || state === "pending" || undefined} aria-busy={state === "pending" || undefined} aria-label={label} aria-pressed={selected} className={cn(selected && "text-live", state === "success" && "text-success", state === "error" && "text-destructive", className)} onClick={e=>{if(state !== "pending") props.onClick?.(e);}}>
    {state === "pending" ? <Spinner /> : state === "success" ? <Check size={20} className="size-5" aria-hidden="true" /> : state === "error" ? <WarningCircle size={20} className="size-5" aria-hidden="true" /> : <IconGlyph size={20} className="size-5" aria-hidden="true" weight={selected ? "fill" : "regular"} />}
  </Button>;
}
