"use client";

import { useId, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function TextField({ label, hint, error, id: suppliedId, className, ...props }: ComponentProps<typeof Input> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const describedBy = [props["aria-describedby"], hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return <div className={cn("flex min-w-0 flex-col gap-2", className)}>
    <label htmlFor={id} className="text-label font-medium">{label}{props.required && <span aria-hidden="true"> *</span>}</label>
    <Input {...props} id={id} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy} />
    {hint && <p id={`${id}-hint`} className="text-caption text-muted-foreground">{hint}</p>}
    {error && <p id={`${id}-error`} role="alert" className="text-caption text-destructive">{error}</p>}
  </div>;
}
