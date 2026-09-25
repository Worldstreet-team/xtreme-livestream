"use client";

import { Tabs } from "radix-ui";
import type { ReactNode } from "react";

export function ContentTabs({ label, items, defaultValue }: { label: string; items: { value: string; label: string; content: ReactNode; disabled?: boolean }[]; defaultValue?: string }) {
  return <Tabs.Root defaultValue={defaultValue ?? items[0]?.value} activationMode="automatic"><Tabs.List aria-label={label} className="flex max-w-full gap-1 overflow-x-auto border-b border-border">{items.map(item=><Tabs.Trigger key={item.value} value={item.value} disabled={item.disabled} className="min-h-11 shrink-0 border-b-2 border-transparent px-4 text-sm text-muted-foreground transition-colors data-[state=active]:border-live data-[state=active]:text-foreground disabled:opacity-40">{item.label}</Tabs.Trigger>)}</Tabs.List>{items.map(item=><Tabs.Content key={item.value} value={item.value} className="pt-5 text-sm leading-relaxed">{item.content}</Tabs.Content>)}</Tabs.Root>;
}
