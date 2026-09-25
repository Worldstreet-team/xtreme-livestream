"use client";

import { Dialog as Primitive } from "radix-ui";
import { X } from "@/components/icons";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

/** Shared dialog/sheet: portal, focus trapping, Escape and focus return via Radix. */
export function DialogContent({ title, description, variant = "dialog", children, className, ...props }: Omit<ComponentProps<typeof Primitive.Content>, "title"> & { title: string; description: string; variant?: "dialog" | "sheet"; children: ReactNode }) {
  return <Primitive.Portal><Primitive.Overlay className="ds-scrim fixed inset-0 z-[var(--layer-overlay)] bg-black/65" /><Primitive.Content {...props} className={cn("ds-dialog fixed z-[var(--layer-dialog)] max-h-[85dvh] overflow-y-auto bg-surface-raised p-6 shadow-overlay", variant === "sheet" ? "ds-sheet inset-x-0 bottom-0 mx-auto w-full max-w-xl rounded-t-overlay pb-[max(24px,env(safe-area-inset-bottom))]" : "left-1/2 top-1/2 w-[calc(100%_-_32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-overlay", className)}>
    {variant === "sheet" && <div aria-hidden="true" className="mx-auto mb-5 h-1 w-10 rounded-full bg-muted-foreground/50" />}
    <div className="mb-6 flex items-start justify-between gap-4"><div><Primitive.Title className="text-heading font-semibold">{title}</Primitive.Title><Primitive.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</Primitive.Description></div><Primitive.Close asChild><IconButton icon={X} label="Close dialog" className="-mr-2 -mt-2 shrink-0" /></Primitive.Close></div>{children}
  </Primitive.Content></Primitive.Portal>;
}
