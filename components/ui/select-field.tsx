"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * A select that looks like the rest of the app on both ends.
 *
 * The design system ships a Radix `Select`, but every form in the product
 * had reached for a native `<select>` with `appearance-none` instead. That
 * styles the closed control and nothing else: the moment you click it the
 * operating system draws the list — system font, system blue highlight, no
 * theme — which is exactly what it looked like. Native `<optgroup>` also
 * can't be styled at all, so grouped menus were the worst of it.
 *
 * This wraps the primitives in the app's own field grammar so a caller
 * passes values, not classes. Two sizes: `md` is a form field (the studio's
 * Title sits next to it), `sm` is a toolbar control beside the pills.
 */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** A flat list, or `groups` for a menu with headings. Pass one. */
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  size?: "sm" | "md";
  full?: boolean;
  id?: string;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  /** A filter box above the list. On by default past 12 options. */
  search?: boolean;
  /** What the filter box says before you type. */
  searchPlaceholder?: string;
}

export function SelectField(props: SelectFieldProps) {
  const {
    value,
    onChange,
    options,
    groups,
    size = "md",
    full = false,
    id,
    placeholder,
    className,
    ariaLabel,
    search,
  } = props;
  const sm = size === "sm";

  // Scrolling 171 categories to find "IRL" is not a menu, it's a haystack.
  const count = groups ? groups.reduce((n, g) => n + g.options.length, 0) : (options?.length ?? 0);
  if (search ?? count > 12) return <SearchableSelectField {...props} />;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        // The kit's trigger ships its own height, padding and tinted
        // border for a form on a light card. Ours is a filled field on
        // black, so those four are overridden outright — same specificity
        // otherwise, and which wins would come down to stylesheet order.
        className={cn(
          "cursor-pointer justify-between rounded-sm border-0! text-foreground transition-colors",
          sm
            ? "h-9! bg-white/[0.05]! px-3! text-sm hover:bg-white/[0.07]! data-[state=open]:bg-white/[0.07]!"
            : "h-11! bg-white/[0.06]! px-3.5! text-[15px] hover:bg-white/[0.09]! data-[state=open]:bg-white/[0.09]!",
          full ? "w-full" : "w-fit",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* Anchored under the trigger and width-matched, so a long list
          scrolls in place instead of covering the field it belongs to. */}
      <SelectContent
        position="popper"
        align="start"
        sideOffset={6}
        className="max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] bg-neutral-950 ring-white/[0.08]"
      >
        {groups
          ? groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                  {group.label}
                </SelectLabel>
                {group.options.map((o) => (
                  <Option key={o.value} {...o} />
                ))}
              </SelectGroup>
            ))
          : (
              <SelectGroup>
                {(options ?? []).map((o) => (
                  <Option key={o.value} {...o} />
                ))}
              </SelectGroup>
            )}
      </SelectContent>
    </Select>
  );
}

/**
 * The same field, with a filter box in the popup.
 *
 * Different primitive underneath — a select can only jump by first letter,
 * so anything long needs a combobox — but the trigger is styled from the
 * same two lines above, so a searchable field is indistinguishable from a
 * plain one until it opens.
 */
function SearchableSelectField({
  value,
  onChange,
  options,
  groups,
  size = "md",
  full = false,
  id,
  placeholder,
  className,
  ariaLabel,
  searchPlaceholder = "Search",
}: SelectFieldProps) {
  const sm = size === "sm";
  const flat = groups ? groups.flatMap((g) => g.options) : (options ?? []);
  const selected = flat.find((o) => o.value === value) ?? null;
  const labelOf = (v: string) => flat.find((o) => o.value === v)?.label ?? v;

  // Items travel as their plain string values, never as option objects.
  // Callers build their option arrays inline, so an object list is a fresh
  // set of identities on every render — the selection then matches nothing
  // and clicking an item silently does nothing. Strings compare by value.
  const items = groups
    ? groups.map((g) => ({ value: g.label, items: g.options.map((o) => o.value) }))
    : flat.map((o) => o.value);

  return (
    <Combobox
      items={items}
      // Type three letters and press Enter: the top match is already
      // highlighted, so the keyboard never has to reach for an arrow key.
      autoHighlight
      value={selected ? selected.value : null}
      onValueChange={(v: string | null) => v != null && onChange(v)}
      itemToStringLabel={labelOf}
    >
      <ComboboxTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "flex cursor-pointer items-center justify-between rounded-sm border-0! text-foreground transition-colors outline-none",
          sm
            ? "h-9! bg-white/[0.05]! px-3! text-sm hover:bg-white/[0.07]! data-[popup-open]:bg-white/[0.07]!"
            : "h-11! bg-white/[0.06]! px-3.5! text-[15px] hover:bg-white/[0.09]! data-[popup-open]:bg-white/[0.09]!",
          full ? "w-full" : "w-fit",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder ?? ""}
        </span>
      </ComboboxTrigger>
      {/* The kit pads the popup wider than its anchor for an input-shaped
          combobox; ours is anchored to a field, so it matches the field. */}
      <ComboboxContent className="min-w-[var(--anchor-width)]! bg-neutral-950 ring-white/[0.08]">
        <div className="border-b border-white/[0.06] p-1.5">
          <ComboboxPrimitive.Input
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-sm bg-white/[0.05] px-2.5 text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.07]"
          />
        </div>
        <ComboboxList className="max-h-[min(18rem,calc(var(--available-height)-3.5rem))] p-1">
          {groups
            ? (group: { value: string; items: string[] }) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                    {group.value}
                  </ComboboxLabel>
                  <ComboboxCollection>
                    {(v: string) => <ComboItem key={v} value={v} label={labelOf(v)} />}
                  </ComboboxCollection>
                </ComboboxGroup>
              )
            : (v: string) => <ComboItem key={v} value={v} label={labelOf(v)} />}
        </ComboboxList>
        <ComboboxEmpty className="py-6 text-[13px]">Nothing matches that</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}

function ComboItem({ value, label }: SelectOption) {
  return (
    <ComboboxItem
      value={value}
      className="h-9 cursor-pointer px-2 text-[14px] text-foreground/90 data-highlighted:bg-white/[0.07] data-highlighted:text-foreground"
    >
      {label}
    </ComboboxItem>
  );
}

function Option({ value, label }: SelectOption) {
  return (
    <SelectItem
      value={value}
      className="h-9 cursor-pointer px-2 text-[14px] text-foreground/90 focus:bg-white/[0.07] focus:text-foreground data-[state=checked]:text-foreground"
    >
      {label}
    </SelectItem>
  );
}
