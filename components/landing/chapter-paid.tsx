import { ArrowUpRight, Gift, PaperPlaneRight, Plus, Sparkle, Storefront, Sword } from "@/components/icons";
import { cn } from "@/lib/utils";
import { AppScreen, PhoneScreen } from "./app-screen";
import { BoxPattern } from "./box-pattern";
import { ChapterTitle, Eyebrow, GUTTER, INK_MUTED, PAPER, delay } from "./story-ui";

/**
 * Chapter 03: the wallet, shown as the page itself on a big screen that runs off the left edge and out through the bottom of the
 * section, the words on the right, set higher than the screen. On a phone
 * it's one centred device instead, cut by the section's foot the same way. The page is laid out the
 * way the real one is (a balance card with the actions on it, three figures
 * that summarise the account, then one history), with the accounts column
 * on the side the crop is allowed to take. Gold is for money and nothing else.
 */
const POINTS: Array<[string, string]> = [
  ["Instant", "Gifts settle to your balance live, not at month end."],
  ["No guessing", "If the balance can't be read, it says so. Never a wrong zero."],
  ["Cash out", "Withdraw to your bank or keep it on WorldStreet."],
];

const HISTORY = [
  { Icon: Gift, title: "Rocket ×5 from @whale.eth", sub: "Gift · 2 min ago", amount: "+$25.00", money: true },
  { Icon: Sword, title: "Battle won vs Nneka Beats", sub: "Battle · 1 h ago", amount: "+$342.00", money: true },
  { Icon: Storefront, title: "Payout to bank ••4417", sub: "Payout · Sent · Yesterday", amount: "−$1,200.00", money: false },
  { Icon: Sparkle, title: "Weekly streak claimed", sub: "Points · Mon", amount: "+250 pts", money: false },
];

function WalletPage() {
  return (
    <div className="flex gap-5 p-5 sm:p-6">
      {/* The cropped side: where the money lives and goes. */}
      <div data-stage className="hidden w-56 shrink-0 flex-col gap-3 lg:flex">
        <span className="caps px-1 font-mono text-[11px] text-muted-foreground">Accounts</span>
        {[
          ["WorldStreet wallet", "USD · main", true],
          ["Bank ••4417", "Payouts", false],
          ["Xtream points", "Rewards", false],
        ].map(([name, sub, on]) => (
          <div key={name as string} className={cn("rounded-panel p-4", on ? "bg-surface-raised ring-1 ring-white/10" : "bg-surface-raised/60")}>
            <span className="block text-[14px] font-semibold">{name}</span>
            <span className="block text-[12px] text-muted-foreground">{sub}</span>
          </div>
        ))}
      </div>

      {/* The side that stays in view: the balance and everything after it. */}
      <div data-stage className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-6 rounded-panel bg-surface-raised p-6">
          <div className="flex items-center justify-between">
            <span className="caps font-mono text-[11px] text-muted-foreground">WorldStreet wallet</span>
            <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" /> Up to date
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span data-count="150" className="font-money text-[clamp(2.75rem,4.4vw,4.25rem)] leading-none text-value">$12,480.52</span>
            <span data-count="300" className="text-[14px] font-medium text-success">+$2,140.00 this week</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-2 rounded-full bg-white px-[18px] py-3 text-[14px] font-semibold text-[#0b0708]">
              <ArrowUpRight size={16} weight="bold" /> Withdraw
            </span>
            <span className="flex items-center gap-2 rounded-full bg-control px-[18px] py-3 text-[14px] font-semibold">
              <Plus size={16} weight="bold" /> Add funds
            </span>
            <span className="flex items-center gap-2 rounded-full bg-control px-[18px] py-3 text-[14px] font-semibold">
              <PaperPlaneRight size={16} /> Send
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            ["Gifts this week", "$2,140.00", true],
            ["Paid out", "$8,300.00", true],
            ["Points", "18,400", false],
          ].map(([k, v, money]) => (
            <div key={k as string} className="flex flex-col gap-1.5 rounded-panel bg-surface-raised p-4">
              <span className="text-[13px] text-muted-foreground">{k}</span>
              <span data-count="250" className={cn("font-money text-[clamp(1.1rem,1.8vw,1.5rem)] leading-none", money ? "text-value" : "text-foreground")}>{v}</span>
            </div>
          ))}
        </div>

        <div className="rounded-panel bg-surface-raised px-4 pt-2">
          <div className="flex gap-1 py-3">
            {["All", "Gifts", "Payouts", "Points"].map((s, i) => (
              <span
                key={s}
                className={cn("rounded-full px-3.5 py-1.5 text-[13px] font-semibold", i === 0 ? "bg-white text-[#0b0708]" : "bg-control text-muted-foreground")}
              >
                {s}
              </span>
            ))}
          </div>
          {HISTORY.map(({ Icon, title, sub, amount, money }) => (
            <div key={title} className="flex items-center gap-3.5 border-t border-hairline py-3.5">
              <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-control">
                <Icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{title}</span>
                <span className="block text-[13px] text-muted-foreground">{sub}</span>
              </span>
              <span data-count="350" className={cn("font-money text-[16px]", money ? "text-value" : "text-foreground")}>{amount}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhoneWallet() {
  return (
    <div data-stage className="flex flex-col gap-3 px-4 pt-2">
      <p className="px-1 font-wide text-[22px] font-bold tracking-[-0.03em]">Wallet</p>
      <div className="flex flex-col gap-4 rounded-panel bg-surface-raised p-5">
        <span className="caps font-mono text-[10px] text-muted-foreground">WorldStreet wallet</span>
        <span data-count="150" className="font-money text-[40px] leading-none text-value">$12,480.52</span>
        <span data-count="300" className="-mt-2 text-[13px] font-medium text-success">+$2,140.00 this week</span>
        <div className="flex gap-2">
          <span className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white py-2.5 text-[13px] font-semibold text-[#0b0708]">
            <ArrowUpRight size={14} weight="bold" /> Withdraw
          </span>
          <span className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-control py-2.5 text-[13px] font-semibold">
            <Plus size={14} weight="bold" /> Add
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Gifts this week", "$2,140.00", true],
          ["Points", "18,400", false],
        ].map(([k, v, money]) => (
          <div key={k as string} className="flex flex-col gap-1 rounded-panel bg-surface-raised p-3.5">
            <span className="text-[12px] text-muted-foreground">{k}</span>
            <span data-count="250" className={cn("font-money text-[18px] leading-none", money ? "text-value" : "text-foreground")}>{v}</span>
          </div>
        ))}
      </div>
      <div className="rounded-panel bg-surface-raised px-3.5">
        {HISTORY.map(({ Icon, title, sub, amount, money }) => (
          <div key={title} className="flex items-center gap-3 border-t border-hairline py-3 first:border-t-0">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-control">
              <Icon size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>
            </span>
            <span data-count="350" className={cn("font-money text-[14px]", money ? "text-value" : "text-foreground")}>{amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const WALLET_LABEL =
  "The WorldStreet wallet page: a balance with Withdraw, Add funds and Send, summary figures, and a history of gifts, a battle win, a payout and points.";

export function ChapterPaid() {
  return (
    <section
      id="paid"
      aria-labelledby="paid-title"
      className={cn("relative isolate scroll-mt-16 overflow-hidden pt-24 sm:pt-32 lg:pt-36", PAPER)}
    >
      <BoxPattern theme="ledger" corner="br" />
      <div className={cn("mx-auto grid max-w-[90rem] gap-14 lg:grid-cols-2 lg:gap-16", GUTTER)}>
        {/* The screen starts lower than the words and runs out through the
            section's foot: the section crops it, not the frame. */}
        <div className="order-2 -mb-40 min-w-0 lg:order-1 lg:-mb-44 lg:pt-24">
          <div className="hidden lg:block">
            <AppScreen bleed="left" url="xtream.worldstreetgold.com/wallet" active="Wallet" ground="#f3ece6" label={WALLET_LABEL}>
              <WalletPage />
            </AppScreen>
          </div>
          <div className="lg:hidden">
            <PhoneScreen ground="#f3ece6" label={WALLET_LABEL}>
              <PhoneWallet />
            </PhoneScreen>
          </div>
        </div>

        <div className="order-1 flex min-w-0 flex-col items-center gap-8 text-center lg:order-2 lg:items-start lg:pl-8 lg:text-left">
          <Eyebrow onPaper>03 / Get paid</Eyebrow>
          <ChapterTitle
            id="paid-title"
            lines={["Money you can", "read at a glance."]}
            className="text-[clamp(2.5rem,4vw,3.5rem)] leading-[0.94]"
          />
          <p data-reveal="up" style={delay(200)} className={cn("max-w-[29rem] text-[17px] leading-[1.55]", INK_MUTED)}>
            Gifts land in your WorldStreet wallet the moment they&apos;re sent. One balance, one history: gifts, payouts and points side by
            side, the way a bank would lay it out.
          </p>
          <dl data-reveal="stagger" className="w-full max-w-[29rem] text-left">
            {POINTS.map(([k, v]) => (
              <div key={k} className="flex gap-6 border-t border-black/15 py-[18px]">
                <dt className="w-28 shrink-0 text-[15px] font-bold">{k}</dt>
                <dd className={cn("text-[15px] leading-[1.5]", INK_MUTED)}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
