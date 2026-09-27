import Image from "next/image";
import { cn } from "@/lib/utils";
import styles from "./reward-art.module.css";

/** Decorative only: callers reserve clear space for content and controls. */
export function RewardArt({ variant, className }: { variant: "ember" | "value"; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute select-none", styles.art, className)}>
      <Image
        src={variant === "ember" ? "/images/rewards/ember-ribbon-v1.png" : "/images/rewards/value-loop-v1.png"}
        alt=""
        width={variant === "ember" ? 1199 : 1254}
        height={variant === "ember" ? 1312 : 1254}
        sizes={variant === "ember" ? "(max-width: 767px) 112px, 128px" : "(max-width: 767px) 128px, 176px"}
        className="h-auto w-full object-contain"
        draggable={false}
      />
    </span>
  );
}
