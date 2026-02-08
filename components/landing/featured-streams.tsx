import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Eye, Users } from "@phosphor-icons/react/dist/ssr";

const featuredStreams = [
  {
    id: 1,
    title: "BTC Analysis: Bull Run Incoming?",
    streamer: "CryptoKing",
    viewers: "12.4K",
    category: "Bitcoin",
    thumbnail:
      "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=800&auto=format&fit=crop",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=CryptoKing",
    isLive: true,
  },
  {
    id: 2,
    title: "Solana DeFi Deep Dive",
    streamer: "DeFiDegen",
    viewers: "8.1K",
    category: "Solana",
    thumbnail:
      "https://images.unsplash.com/photo-1639762681057-408e52192e55?q=80&w=800&auto=format&fit=crop",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=DeFiDegen",
    isLive: true,
  },
  {
    id: 3,
    title: "NFT Minting Strategy 2026",
    streamer: "NFTWhale",
    viewers: "5.7K",
    category: "NFTs",
    thumbnail:
      "https://images.unsplash.com/photo-1644143379190-08a5f055de1d?q=80&w=800&auto=format&fit=crop",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=NFTWhale",
    isLive: true,
  },
  {
    id: 4,
    title: "Ethereum Merge Update & Yield Farming",
    streamer: "ETHMaxi",
    viewers: "3.9K",
    category: "Ethereum",
    thumbnail:
      "https://images.unsplash.com/photo-1642104704074-907c0698b98d?q=80&w=800&auto=format&fit=crop",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=ETHMaxi",
    isLive: false,
  },
  {
    id: 5,
    title: "Altcoin Gems: 100x Potential Picks",
    streamer: "AltHunter",
    viewers: "6.2K",
    category: "Altcoins",
    thumbnail:
      "https://images.unsplash.com/photo-1622630998477-20aa696ecb05?q=80&w=800&auto=format&fit=crop",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=AltHunter",
    isLive: true,
  },
  {
    id: 6,
    title: "Crypto Tax Strategies for Traders",
    streamer: "TaxGuru",
    viewers: "2.3K",
    category: "Education",
    thumbnail:
      "https://images.unsplash.com/photo-1633158829585-23ba8f7c8caf?q=80&w=800&auto=format&fit=crop",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=TaxGuru",
    isLive: false,
  },
];

export function FeaturedStreams() {
  return (
    <section id="explore" className="relative py-20 sm:py-28 overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 right-1/4 w-[250px] h-[250px] sm:w-[350px] sm:h-[350px] md:size-[500px] rounded-full bg-primary/5 blur-[120px]" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
              Featured Streams
            </h2>
            <p className="mt-2 text-muted-foreground">
              Trending live streams from the crypto community
            </p>
          </div>
          <Link
            href="/explore"
            className="hidden text-sm font-medium text-primary transition-colors hover:text-primary/80 sm:block"
          >
            View All →
          </Link>
        </div>

        {/* Stream grid */}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featuredStreams.map((stream) => (
            <Link key={stream.id} href={`/stream/${stream.id}`}>
            <article
              className="group cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition-all hover:border-white/10 hover:bg-white/[0.04]"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video overflow-hidden">
                <Image
                  src={stream.thumbnail}
                  alt={stream.title}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

                {/* Live badge */}
                {stream.isLive && (
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                    </span>
                    LIVE
                  </div>
                )}

                {/* Viewers */}
                <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white/90 backdrop-blur-sm">
                  <Eye size={14} />
                  {stream.viewers}
                </div>
              </div>

              {/* Info */}
              <div className="flex gap-3 p-3">
                <Image
                  src={stream.avatar}
                  alt={stream.streamer}
                  width={36}
                  height={36}
                  className="size-9 rounded-full bg-white/10"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {stream.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {stream.streamer}
                  </p>
                  <Badge
                    variant="secondary"
                    className="mt-1.5 text-[0.65rem] h-4 bg-white/5 text-muted-foreground border-0"
                  >
                    {stream.category}
                  </Badge>
                </div>
              </div>
            </article>
            </Link>
          ))}
        </div>

        {/* Mobile view all */}
        <div className="mt-6 text-center sm:hidden">
          <Link
            href="/explore"
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            View All Streams →
          </Link>
        </div>
      </div>
    </section>
  );
}
