"use client";

import { useEffect, useState } from "react";
import { Coins, Lock, Trophy, Check, X, Sparkle, Ticket, Question } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { GAME_LABEL, STAKES, announcePoints, formatPoints, outcomeShare, payoutMultiplier, secondsToClose, type GameView } from "@/lib/games";
import { formatClock } from "@/lib/battles";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui/pill";
import { UserAvatar } from "@/components/ui/user-avatar";

const SIGN_IN_URL = "https://www.worldstreetgold.com/login";

const ICON = { prediction: Sparkle, raffle: Ticket, quiz: Question } as const;

/**
 * The viewer's side of a game, stacked above chat. Predictions show the
 * outcomes as bars with live odds and a stake picker; raffles show the
 * pot and one Enter button; quizzes show the answers with no stake. Then
 * the countdown, the locked state, and the result — who won, what came
 * back. One entry per game; the server refuses a second.
 */
export function PlayPanel({ game, onChange }: { game: GameView; onChange: (g: GameView) => void }) {
  const { isAuthenticated } = useAuth();
  const now = useNow(game.status === "open");
  const left = secondsToClose(game, now);
  const [pick, setPick] = useState<string | null>(game.mine?.outcome ?? null);
  const [stake, setStake] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = ICON[game.type];

  useEffect(() => {
    if (game.mine) setPick(game.mine.outcome);
  }, [game.mine]);

  const open = game.status === "open" && left > 0;
  const entered = !!game.mine;
  const settled = game.status === "settled";
  const won = settled && !!game.mine && game.mine.wonPoints > 0;
  const isRaffle = game.type === "raffle";
  const isQuiz = game.type === "quiz";

  const enter = async () => {
    if (!isAuthenticated) {
      window.location.href = SIGN_IN_URL;
      return;
    }
    if (!isRaffle && !pick) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { game: GameView; pointsBalance: number } }>(`/api/games/${game.id}/enter`, {
        method: "POST",
        body: JSON.stringify({ outcome: isRaffle ? "ticket" : pick, stakePoints: game.type === "prediction" ? stake : 0 }),
      });
      onChange(r.data.game);
      announcePoints(r.data.pointsBalance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't place that");
    } finally {
      setBusy(false);
    }
  };

  const potLabel = isRaffle
    ? `${formatPoints(game.poolPoints + game.prizePoints)} pts pot · ${game.entries} in`
    : isQuiz
      ? `${formatPoints(game.prizePoints)} pts each · ${game.entries} in`
      : `${formatPoints(game.poolPoints)} pts · ${game.entries} in`;

  return (
    <section className="shrink-0 border-b border-white/[0.06] bg-[oklch(0.13_0.005_285)] px-3.5 py-3" aria-label={GAME_LABEL[game.type]}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-amber-300 uppercase">
          <Icon size={12} weight="fill" />
          {GAME_LABEL[game.type]}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-muted-foreground tabular-nums">
          <Coins size={12} weight="fill" className="text-amber-300" />
          {potLabel}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
            settled ? "bg-white/[0.1] text-foreground" : open ? "bg-white text-neutral-950" : "bg-white/[0.1] text-muted-foreground"
          )}
        >
          {settled ? "Result" : open ? formatClock(left) : game.status === "cancelled" ? "Cancelled" : "Locked"}
        </span>
      </div>

      <p className="text-[14px] font-semibold leading-snug text-foreground">{game.question}</p>

      {!isRaffle && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {game.outcomes.map((o) => {
            const share = isQuiz ? (game.entries ? o.entries / game.entries : 1 / game.outcomes.length) : outcomeShare(game, o.id);
            const mult = isQuiz ? null : payoutMultiplier(game, o.id);
            const isPick = pick === o.id;
            const isWinner = settled && game.winningOutcome === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={!open || entered || busy}
                onClick={() => setPick(o.id)}
                aria-pressed={isPick}
                className={cn(
                  "relative overflow-hidden rounded-sm px-3 py-2 text-left transition-colors disabled:cursor-default",
                  isWinner ? "bg-emerald-500/[0.16]" : isPick ? "bg-white/[0.12]" : "bg-white/[0.05] enabled:hover:bg-white/[0.09]"
                )}
              >
                {!isQuiz || settled ? (
                  <span className={cn("absolute inset-y-0 left-0 transition-[width]", isWinner ? "bg-emerald-400/20" : "bg-white/[0.06]")} style={{ width: `${share * 100}%` }} />
                ) : null}
                <span className="relative flex items-center gap-2 text-[13px]">
                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase", isWinner ? "bg-emerald-400 text-neutral-950" : isPick ? "bg-white text-neutral-950" : "bg-white/[0.12] text-foreground")}>
                    {isWinner ? <Trophy size={10} weight="fill" /> : isPick && entered ? <Check size={10} weight="bold" /> : o.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{o.label}</span>
                  {(!isQuiz || settled) && (
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {Math.round(share * 100)}%{mult ? ` · ${mult.toFixed(1)}×` : ""}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isRaffle && (settled || game.winners.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {game.winners.map((w) => (
            <span key={w.userId} className="flex items-center gap-1.5 rounded-full bg-emerald-500/[0.16] py-1 pr-2.5 pl-1 text-[12px] font-medium text-emerald-200">
              <UserAvatar src={w.avatar} name={w.displayName} size={20} className="size-5" />
              {w.displayName}
            </span>
          ))}
          {settled && game.winners.length === 0 && <span className="text-[12.5px] text-muted-foreground">Nobody entered.</span>}
        </div>
      )}

      {settled ? (
        <p className={cn("mt-2.5 text-[12.5px] font-medium", won ? "text-emerald-300" : "text-muted-foreground")}>
          {game.mine
            ? won
              ? `${isQuiz ? "Correct" : isRaffle ? "Drawn" : "You called it"} — +${formatPoints(game.mine.wonPoints)} pts`
              : isQuiz
                ? "Not that one."
                : isRaffle
                  ? "Not drawn this time."
                  : `Not this time — ${formatPoints(game.mine.stakePoints)} pts staked`
            : "Settled."}
        </p>
      ) : game.status === "cancelled" ? (
        <p className="mt-2.5 text-[12.5px] text-muted-foreground">Cancelled — every stake refunded.</p>
      ) : entered ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Lock size={12} />
          {isRaffle
            ? "You're in the draw."
            : isQuiz
              ? `Answer locked: ${game.outcomes.find((o) => o.id === game.mine!.outcome)?.label}.`
              : `You're in with ${formatPoints(game.mine!.stakePoints)} pts on ${game.outcomes.find((o) => o.id === game.mine!.outcome)?.label}.`}
        </p>
      ) : open ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          {game.type === "prediction" && (
            <div className="flex gap-1">
              {STAKES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStake(s)}
                  aria-pressed={stake === s}
                  className={cn("h-8 rounded-full px-2.5 text-[12px] font-semibold tabular-nums transition-colors", stake === s ? "bg-white text-neutral-950" : "bg-[#26262D] text-foreground/90 hover:bg-[#31313A]")}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {isRaffle && (
            <span className="text-[12px] text-muted-foreground">{game.ticketPoints > 0 ? `${game.ticketPoints} pts a ticket` : "Free to enter"} · {game.winnersCount} drawn</span>
          )}
          <Pill size="sm" variant="primary" className="ml-auto" icon={isRaffle ? <Ticket size={13} weight="fill" /> : <Coins size={13} weight="fill" />} onClick={enter} disabled={(!isRaffle && !pick) || busy}>
            {isRaffle ? "Enter" : isQuiz ? (pick ? "Lock answer" : "Pick one") : pick ? `Stake ${stake}` : "Pick one"}
          </Pill>
        </div>
      ) : (
        <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Lock size={12} />
          {isRaffle ? "Entries closed — drawing soon." : "Entries closed — waiting on the result."}
        </p>
      )}
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-[12px] text-red-400">
          <X size={11} weight="bold" />
          {error}
        </p>
      )}
    </section>
  );
}
