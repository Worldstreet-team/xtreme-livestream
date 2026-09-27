import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The field, Afterglow: no border (the owner rejected the grey-outlined
 * input), a soft warm fill with a hairline edge, 14px corners, and an
 * ember line drawn inside on focus. Invalid swaps the line for the
 * destructive tone. The visible label (TextField) does the identifying.
 */
export const fieldClass =
  "w-full min-w-0 rounded-control bg-tint/[0.06] text-[15px] text-foreground shadow-[inset_0_0_0_1px_var(--hairline-color)] outline-none transition-[background-color,box-shadow] duration-200 placeholder:text-muted-foreground/70 hover:bg-tint/[0.08] focus-visible:bg-tint/[0.09] focus-visible:shadow-[inset_0_0_0_1.5px_var(--ember)] aria-invalid:shadow-[inset_0_0_0_1.5px_var(--destructive)] disabled:cursor-not-allowed disabled:opacity-50"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClass,
        "h-12 px-4 file:mr-3 file:h-8 file:rounded-full file:border-0 file:bg-control file:px-3 file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }
