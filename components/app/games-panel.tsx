"use client";

import { useEffect, useState } from "react";
import { Sparkle, X, Plus, Trophy, Coins, Ticket, Question, Check } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { GAME_LABEL, formatPoints, secondsToClose, type GameType, type GameView } from "@/lib/games";
import { formatClock } from "@/lib/battles";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui/pill";
import { PillTabs } from "@/components/ui/tabs";

/**
 * The host's side of games, in the studio. Pick a type — prediction,
 * raffle or quiz — fill in the two or three things it needs, open it, watch
 * it build, then settle: tap the outcome that happened, draw the raffle,
 * or let the quiz reveal itself. Cancel refunds everyone.
 */
export function GamesPanel({
  streamId,
  inline = false,
}: {
  streamId: string;
  /** Inside a sheet or tab: full width, form open from the start, no toggle. */
  inline?: boolean;
}) {
  const [game, setGame] = useState<GameView | null>(null);
  const [open, setOpen] = useState(inline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<GameType>("prediction");
  const [question, setQuestion] = useState("");
  const [outcomes, setOutcomes] = useState(["Yes", "No"]);
  const [correct, setCorrect] = useState(0);
  const [duration, setDuration] = useState(120);
  const [ticket, setTicket] = useState(0);
  const [winnersCount, setWinnersCount] = useState(1);
  const [prize, setPrize] = useState(100);
  const now = useNow(!!game && game.status === "open");

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { game: GameView | null } }>(`/api/streams/${streamId}/games/current`)
        .then((r) => !cancelled && setGame(r.data.game))
        .catch(() => {});
    void load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [streamId]);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { game: GameView } }>(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      setGame(r.data.game);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const running = game && (game.status === "open" || game.status === "locked");

  if (running) {
    const left = secondsToClose(game, now);
    const isRaffle = game.type === "raffle";
    const isQuiz = game.type === "quiz";
    return (
      <div className="flex max-w-[460px] flex-col gap-2 rounded-sm bg-white/[0.05] px-3 py-2.5">
        <div className="flex items-center gap-2">
          {isRaffle ? <Ticket size={14} weight="fill" className="text-amber-300" /> : isQuiz ? <Question size={14} weight="fill" className="text-amber-300" /> : <Sparkle size={14} weight="fill" className="text-amber-300" />}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{game.question}</span>
          <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground tabular-nums">
            <Coins size={11} weight="fill" className="text-amber-300" />
            {isRaffle ? formatPoints(game.poolPoints + game.prizePoints) : isQuiz ? `${formatPoints(game.prizePoints)} each` : formatPoints(game.poolPoints)} · {game.entries} in
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", game.status === "open" ? "bg-white text-neutral-950" : "bg-white/[0.1] text-muted-foreground")}>
            {game.status === "open" ? formatClock(left) : "Locked"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isRaffle ? (
            <Pill size="sm" variant="soft" tone="green" icon={<Trophy size={12} weight="fill" />} onClick={() => post(`/api/games/${game.id}/settle`)} disabled={busy}>
              Draw {game.winnersCount} winner{game.winnersCount === 1 ? "" : "s"}
            </Pill>
          ) : isQuiz ? (
            <span className="text-[11.5px] text-muted-foreground">Reveals itself when the clock hits zero.</span>
          ) : (
            <>
              <span className="text-[11px] text-muted-foreground">Settle:</span>
              {game.outcomes.map((o) => (
                <Pill key={o.id} size="sm" variant="soft" tone="green" icon={<Trophy size={12} weight="fill" />} onClick={() => post(`/api/games/${game.id}/settle`, { winningOutcome: o.id })} disabled={busy}>
                  {o.label} <span className="ml-1 text-[10.5px] opacity-70 tabular-nums">{Math.round((game.poolPoints ? o.points / game.poolPoints : 1 / game.outcomes.length) * 100)}%</span>
                </Pill>
              ))}
            </>
          )}
          <Pill size="sm" variant="ghost" icon={<X size={12} />} onClick={() => post(`/api/games/${game.id}/cancel`)} disabled={busy} className="ml-auto">
            Cancel &amp; refund
          </Pill>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  const canOpen = question.trim().length >= 3 && (type === "raffle" || outcomes.every((o) => o.trim()));

  return (
    <div className={cn("flex flex-col gap-2", inline ? "items-stretch" : "items-end")}>
      {!inline && (
        <Pill size="md" variant="glass" icon={<Sparkle size={15} weight="fill" />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Games
        </Pill>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {open && (
        <div className={cn("rounded-sm p-3", inline ? "w-full bg-white/[0.03]" : "w-[380px] border border-white/[0.08] bg-[oklch(0.14_0.005_285)] shadow-2xl")}>
          <PillTabs
            size="sm"
            label="Game type"
            className="mb-3"
            items={[
              { id: "prediction" as const, label: "Prediction", icon: Sparkle },
              { id: "raffle" as const, label: "Raffle", icon: Ticket },
              { id: "quiz" as const, label: "Quiz", icon: Question },
            ]}
            value={type}
            onChange={setType}
          />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={140}
            placeholder={type === "prediction" ? "Do we win this match?" : type === "raffle" ? "Signed jersey giveaway" : "Which year did we first go live?"}
            className="h-9 w-full rounded-sm bg-white/[0.06] px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09]"
          />

          {type !== "raffle" && (
            <div className="mt-2 flex flex-col gap-1.5">
              {outcomes.map((o, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {type === "quiz" ? (
                    <button
                      type="button"
                      onClick={() => setCorrect(i)}
                      aria-pressed={correct === i}
                      title="Mark as the right answer"
                      className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase", correct === i ? "bg-emerald-400 text-neutral-950" : "bg-white/[0.1] text-foreground")}
                    >
                      {correct === i ? <Check size={11} weight="bold" /> : String.fromCharCode(97 + i)}
                    </button>
                  ) : (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.1] text-[10px] font-bold uppercase">{String.fromCharCode(97 + i)}</span>
                  )}
                  <input
                    value={o}
                    onChange={(e) => setOutcomes((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                    maxLength={40}
                    className="h-8 min-w-0 flex-1 rounded-sm bg-white/[0.06] px-2.5 text-sm text-foreground outline-none focus:bg-white/[0.09]"
                  />
                  {outcomes.length > 2 && (
                    <button type="button" onClick={() => setOutcomes((arr) => arr.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground" aria-label="Remove outcome">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
              {outcomes.length < 4 && (
                <button type="button" onClick={() => setOutcomes((arr) => [...arr, ""])} className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground">
                  <Plus size={12} weight="bold" /> Add {type === "quiz" ? "answer" : "outcome"}
                </button>
              )}
              {type === "quiz" && <p className="text-[11px] text-muted-foreground/60">Tap the circle to mark the right answer. Viewers never see it until the reveal.</p>}
            </div>
          )}

          {type === "raffle" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted-foreground">
                Ticket (pts, 0 = free)
                <input type="number" min={0} max={1000} value={ticket} onChange={(e) => setTicket(Math.max(0, Number(e.target.value) || 0))} className="mt-1 h-8 w-full rounded-sm bg-white/[0.06] px-2.5 text-sm text-foreground outline-none focus:bg-white/[0.09]" />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Winners drawn
                <input type="number" min={1} max={10} value={winnersCount} onChange={(e) => setWinnersCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} className="mt-1 h-8 w-full rounded-sm bg-white/[0.06] px-2.5 text-sm text-foreground outline-none focus:bg-white/[0.09]" />
              </label>
            </div>
          )}
          {type !== "prediction" && (
            <label className="mt-2 block text-[11px] text-muted-foreground">
              {type === "raffle" ? "Prize added to the pot (pts)" : "Points per correct answer"}
              <input type="number" min={0} max={10000} value={prize} onChange={(e) => setPrize(Math.max(0, Number(e.target.value) || 0))} className="mt-1 h-8 w-full rounded-sm bg-white/[0.06] px-2.5 text-sm text-foreground outline-none focus:bg-white/[0.09]" />
            </label>
          )}

          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Open for</span>
            {[60, 120, 300].map((s) => (
              <button key={s} type="button" onClick={() => setDuration(s)} aria-pressed={duration === s} className={cn("h-7 rounded-full px-2.5 text-[11.5px] font-semibold", duration === s ? "bg-white text-neutral-950" : "bg-[#26262D] text-foreground/90")}>
                {s / 60} min
              </button>
            ))}
            <Pill
              size="sm"
              variant="primary"
              className="ml-auto"
              disabled={busy || !canOpen}
              onClick={() =>
                post(`/api/streams/${streamId}/games`, {
                  type,
                  question: question.trim(),
                  outcomes: type === "raffle" ? [] : outcomes.map((o) => o.trim()),
                  durationSec: duration,
                  ticketPoints: ticket,
                  winnersCount,
                  prizePoints: type === "prediction" ? 0 : prize,
                  correctIndex: type === "quiz" ? correct : null,
                })
              }
            >
              Open {GAME_LABEL[type].toLowerCase()}
            </Pill>
          </div>
        </div>
      )}
    </div>
  );
}
