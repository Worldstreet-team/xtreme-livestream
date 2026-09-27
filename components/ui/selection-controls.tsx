"use client";

import { useId, type ComponentProps } from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function SwitchField({ label, description, id: suppliedId, ...props }: ComponentProps<typeof SwitchPrimitive.Root> & { label: string; description?: string }) {
  const generatedId = useId(); const id = suppliedId ?? generatedId;
  return <div className="flex min-h-11 items-center justify-between gap-4"><div><label htmlFor={id} className="text-sm font-medium">{label}</label>{description && <p id={`${id}-hint`} className="mt-1 text-caption text-muted-foreground">{description}</p>}</div><SwitchPrimitive.Root {...props} id={id} aria-describedby={description ? `${id}-hint` : undefined} className={cn("relative inline-flex h-11 w-12 shrink-0 items-center rounded-full px-1 before:absolute before:left-0 before:top-2 before:h-7 before:w-12 before:rounded-full before:bg-control before:shadow-[inset_0_0_0_1px_var(--hairline-color)] before:transition-colors data-[state=checked]:before:bg-ember data-[state=checked]:before:shadow-[0_6px_16px_-6px_rgba(248,88,16,0.7)] disabled:opacity-40", props.className)}><SwitchPrimitive.Thumb className="relative block size-5 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition-transform duration-300 [transition-timing-function:var(--ease-spring)] data-[state=checked]:translate-x-5 motion-reduce:transition-none" /></SwitchPrimitive.Root></div>;
}

export function CheckboxField({ label, description, className, ...props }: Omit<ComponentProps<"input">, "type"> & { label: string; description?: string }) {
  return <label className={cn("flex min-h-11 items-start gap-3 py-2 text-sm", props.disabled && "opacity-40", className)}><input {...props} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-ember" /><span>{label}{description && <span className="mt-1 block text-caption text-muted-foreground">{description}</span>}</span></label>;
}

export function RadioCards({ label, name, value, onChange, options }: { label: string; name: string; value: string; onChange: (value: string) => void; options: { value: string; label: string; description?: string }[] }) {
  return <fieldset className="space-y-3"><legend className="mb-3 text-sm font-medium">{label}</legend>{options.map(option=><label key={option.value} className={cn("flex cursor-pointer gap-3 rounded-panel bg-tint/[0.03] p-4 shadow-[inset_0_0_0_1px_var(--border-control)] transition-[background-color,box-shadow] duration-200", value === option.value && "bg-ember/[0.07] shadow-[inset_0_0_0_1.5px_var(--ember)]")}><input type="radio" name={name} value={option.value} checked={value===option.value} onChange={()=>onChange(option.value)} className="mt-0.5 size-5 shrink-0 accent-ember" /><span className="text-sm">{option.label}{option.description && <span className="mt-1 block text-caption text-muted-foreground">{option.description}</span>}</span></label>)}</fieldset>;
}
