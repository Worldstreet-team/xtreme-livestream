import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldClass } from "@/components/ui/input"

/** The multi-line field: the same fill, edge and focus line as Input. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClass, "flex field-sizing-content min-h-24 px-4 py-3", className)}
      {...props}
    />
  )
}

export { Textarea }
