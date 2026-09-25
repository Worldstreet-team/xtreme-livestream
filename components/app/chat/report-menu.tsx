"use client";

import { useState } from "react";
import { CheckCircle, Flag, X } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** The reasons that fit one chat line, in the words people use. */
const REASONS: { id: "spam" | "harassment" | "hate_speech" | "sexual_content" | "scam_or_fraud" | "violence" | "other"; label: string }[] = [
  { id: "harassment", label: "Harassment" },
  { id: "hate_speech", label: "Hate speech" },
  { id: "scam_or_fraud", label: "Scam or fraud" },
  { id: "spam", label: "Spam" },
  { id: "sexual_content", label: "Sexual" },
  { id: "violence", label: "Violence or threats" },
  { id: "other", label: "Something else" },
];

/**
 * Report one chat line to the platform (safety kit). A tap on a reason
 * sends it; the line's words are kept with the report, so deleting it
 * doesn't lose the evidence. Every report is reviewed within 48 hours.
 */
export function ReportMenu({
  streamId,
  messageId,
  username,
  onClose,
}: {
  streamId: string;
  messageId: string;
  username: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<"pick" | "sending" | "sent" | "error">("pick");
  const [error, setError] = useState("");

  const send = async (reason: (typeof REASONS)[number]["id"]) => {
    setState("sending");
    try {
      await apiFetch(`/api/streams/${streamId}/report`, { method: "POST", body: JSON.stringify({ reason, messageId }) });
      setState("sent");
      setTimeout(onClose, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the report");
      setState("error");
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Report ${username}'s message`}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-7 right-1 z-20 w-[248px] rounded-[12px] bg-popover p-2.5 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.85)]"
    >
      {state === "sent" ? (
        <p className="flex items-start gap-2 px-1 py-1.5 text-[12.5px] leading-snug text-foreground">
          <CheckCircle size={16} weight="fill" className="mt-px shrink-0 text-success" />
          Reported. Our team reviews every report within 48 hours.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1">
            <Flag size={13} className="text-muted-foreground" />
            <p className="flex-1 text-[12.5px] font-semibold text-foreground">Report this message</p>
            <button type="button" onClick={onClose} aria-label="Cancel" className="text-muted-foreground hover:text-foreground">
              <X size={13} />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1">
            {REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={state === "sending"}
                onClick={() => void send(r.id)}
                className={cn(
                  "press h-8 rounded-[8px] bg-white/[0.05] px-2 text-left text-[11.5px] font-medium text-foreground/90 transition-colors hover:bg-white/[0.1] disabled:opacity-50",
                  r.id === "other" && "col-span-2"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {state === "error" && <p className="mt-2 px-1 text-[11.5px] text-chili-hi">{error}</p>}
        </>
      )}
    </div>
  );
}
