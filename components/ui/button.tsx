"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * The form-and-dialog button, in Afterglow's shape: a pill that springs
 * under the finger, with an ember focus ring. It shares its variants with
 * `Pill` (components/ui/pill) — reach for Pill in product surfaces, Button
 * where a Radix/`asChild` composition or a `loading` state is needed.
 *
 *  default   white — the one neutral primary (owner's rule: white primaries)
 *  live      Chili — on air, or putting you on air
 *  heat      the gradient — Go live and gift moments only
 *  ember     Ember with dark ink — energy: claim, join, start
 *  secondary warm charcoal control
 *  outline / ghost / destructive / link
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full text-sm font-semibold outline-none transition-[background-color,box-shadow,transform,color,filter] duration-200 [transition-timing-function:var(--ease-spring)] focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.95] aria-invalid:ring-2 aria-invalid:ring-destructive/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-white text-[#0b0708] hover:bg-white/90",
        live: "bg-chili text-white hover:brightness-110",
        heat: "bg-heat text-white hover:brightness-110",
        ember: "bg-ember text-on-ember hover:brightness-105",
        secondary: "bg-control text-foreground hover:bg-control-hover aria-expanded:bg-control-hover",
        outline: "bg-transparent text-foreground shadow-[inset_0_0_0_1px_rgba(255,236,230,0.18)] hover:bg-white/[0.05] aria-expanded:bg-white/[0.05]",
        ghost: "text-foreground/85 hover:bg-white/[0.06] hover:text-foreground aria-expanded:bg-white/[0.06]",
        destructive: "bg-chili/15 text-chili-hi hover:bg-chili/25",
        link: "text-ember-hi underline-offset-4 hover:underline",
      },
      size: {
        default: "h-control gap-2 px-5",
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-control-sm gap-1.5 px-4 text-[13px]",
        lg: "h-control-lg gap-2 px-6 text-[15px]",
        icon: "size-control",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Keep a stable label while an async action is pending. */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      type={asChild ? undefined : (type ?? "button")}
      disabled={asChild ? undefined : (disabled || loading)}
      aria-disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), (disabled || loading) && "pointer-events-none opacity-50", className)}
      {...props}
      onClickCapture={(event) => {
        if (disabled || loading) { event.preventDefault(); event.stopPropagation(); }
        else props.onClickCapture?.(event);
      }}
      tabIndex={disabled || loading ? -1 : props.tabIndex}
    >
      {asChild ? children : <>{loading && <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />}{children}</>}
    </Comp>
  )
}

export { Button, buttonVariants }
