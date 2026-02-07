import Image from "next/image";
import { Crown, TrendUp, Eye } from "@phosphor-icons/react/dist/ssr";

const topStreamers = [
  {
    rank: 1,
    name: "CryptoKing",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=CryptoKing",
    followers: "245K",
    totalViews: "12.8M",
    category: "Bitcoin Trading",
    isLive: true,
  },
  {
    rank: 2,
    name: "DeFiDegen",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=DeFiDegen",
    followers: "189K",
    totalViews: "9.2M",
    category: "DeFi Protocols",
    isLive: true,
  },
  {
    rank: 3,
    name: "NFTWhale",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=NFTWhale",
    followers: "156K",
    totalViews: "7.5M",
    category: "NFT Markets",
    isLive: false,
  },
  {
    rank: 4,
    name: "AltHunter",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=AltHunter",
    followers: "134K",
    totalViews: "6.1M",
    category: "Altcoin Scouting",
    isLive: true,
  },
  {
    rank: 5,
    name: "ChainAnalyst",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=ChainAnalyst",
    followers: "112K",
    totalViews: "5.4M",
    category: "On-Chain Data",
    isLive: false,
  },
  {
    rank: 6,
    name: "MevBot_",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=MevBot",
    followers: "98K",
    totalViews: "4.8M",
    category: "MEV & Bots",
    isLive: true,
  },
  {
    rank: 7,
    name: "YieldFarmer",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=YieldFarmer",
    followers: "87K",
    totalViews: "3.9M",
    category: "Yield Strategies",
    isLive: false,
  },
  {
    rank: 8,
    name: "TaxGuru",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=TaxGuru",
    followers: "76K",
    totalViews: "3.2M",
    category: "Crypto Education",
    isLive: false,
  },
];

export function TopStreamers() {
  return (
    <section id="top-streamers" className="relative py-20 sm:py-28">
      {/* Background glow */}
      <div className="absolute bottom-0 left-1/3 size-[500px] rounded-full bg-primary/5 blur-[120px]" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Crown size={14} weight="fill" />
            Leaderboard
          </div>
          <h2 className="mt-4 text-2xl font-bold text-foreground sm:text-3xl">
            Top Streamers
          </h2>
          <p className="mt-2 text-muted-foreground">
            The most-watched crypto streamers this month
          </p>
        </div>

        {/* Streamer list */}
        <div className="mx-auto mt-10 max-w-3xl space-y-3">
          {topStreamers.map((streamer) => (
            <div
              key={streamer.rank}
              className="group flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10 hover:bg-white/[0.04] cursor-pointer"
            >
              {/* Rank */}
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                  streamer.rank === 1
                    ? "bg-yellow-500/20 text-yellow-400"
                    : streamer.rank === 2
                    ? "bg-gray-300/20 text-gray-300"
                    : streamer.rank === 3
                    ? "bg-orange-500/20 text-orange-400"
                    : "bg-white/5 text-muted-foreground"
                }`}
              >
                {streamer.rank}
              </div>

              {/* Avatar */}
              <div className="relative">
                <Image
                  src={streamer.avatar}
                  alt={streamer.name}
                  width={44}
                  height={44}
                  className="size-11 rounded-full bg-white/10"
                />
                {streamer.isLive && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border-2 border-background bg-red-500">
                    <span className="size-1.5 rounded-full bg-white" />
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {streamer.name}
                  </h3>
                  {streamer.isLive && (
                    <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[0.6rem] font-semibold text-red-400">
                      LIVE
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {streamer.category}
                </p>
              </div>

              {/* Stats */}
              <div className="hidden items-center gap-6 sm:flex">
                <div className="text-right">
                  <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                    <TrendUp size={14} className="text-green-400" />
                    {streamer.followers}
                  </div>
                  <div className="text-[0.65rem] text-muted-foreground">
                    Followers
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                    <Eye size={14} className="text-primary" />
                    {streamer.totalViews}
                  </div>
                  <div className="text-[0.65rem] text-muted-foreground">
                    Total Views
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
