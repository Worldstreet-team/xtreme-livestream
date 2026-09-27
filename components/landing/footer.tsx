import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";
import { GUTTER } from "./story-ui";

/**
 * Only links that go somewhere. The old footer listed Discord, Telegram,
 * a blog, a help centre and three legal pages, all pointing at "#"; they
 * come back here as each page exists.
 */
const footerLinks: Record<string, Array<{ label: string; href: string; external?: boolean }>> = {
  Platform: [
    { label: "Explore streams", href: "/explore" },
    { label: "Browse categories", href: "/browse" },
    { label: "Start streaming", href: "/studio" },
    { label: "Rewards", href: "/rewards" },
  ],
  WorldStreet: [
    { label: "WorldSpace", href: "https://social.worldstreetgold.com", external: true },
    { label: "Wolf of WorldStreet", href: "https://social.worldstreetgold.com/votes", external: true },
    { label: "Vivid", href: "https://worldstreetgold.com/vivid", external: true },
    { label: "Dashboard", href: "https://dashboard.worldstreetgold.com", external: true },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-hairline bg-ground">
      <div data-reveal="up" className={cn("mx-auto flex max-w-[90rem] flex-col gap-14 pt-16 pb-10", GUTTER)}>
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between">
          <div className="flex max-w-[22rem] flex-col gap-4">
            <span className="flex items-center gap-2.5">
              <BrandMark size={28} />
              <span className="font-wide text-[21px] font-bold tracking-[-0.04em]">Xtream</span>
            </span>
            <p className="text-[15px] leading-[1.55] text-muted-foreground">
              The underground crypto livestreaming platform. Stream it. Trade it. Live it.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-16 gap-y-10">
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title} className="flex flex-col gap-3.5">
                <h3 className="caps font-mono text-[11px] text-muted-foreground">{title}</h3>
                <ul className="flex flex-col gap-3">
                  {links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a href={link.href} className="text-[15px] transition-colors hover:text-ember-hi">
                          {link.label}
                        </a>
                      ) : (
                        <Link href={link.href} className="text-[15px] transition-colors hover:text-ember-hi">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-8 border-t border-hairline pt-8 md:grid-cols-2 md:gap-12">
          <p className="text-[13px] leading-[1.6] text-muted-foreground">
            <span className="mb-1.5 block font-semibold text-foreground">Not financial advice.</span>
            Content on Xtream Worldstreet, including trading calls, market commentary, and price predictions, reflects the opinions of
            individual creators and is provided for entertainment and educational purposes only. Crypto assets are highly volatile; never risk
            money you can&apos;t afford to lose. Tips and gifts are voluntary payments to creators, not investments, and carry no expectation
            of return.
          </p>
          <p className="text-[13px] leading-[1.6] text-muted-foreground">
            <span className="mb-1.5 block font-semibold text-foreground">Zero tolerance for market manipulation.</span>
            Promoting pump-and-dump schemes, undisclosed paid promotion, or coordinated market manipulation violates our Creator Guidelines
            and results in permanent removal from the platform.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline pt-6 text-[14px] text-muted-foreground sm:flex-row sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Xtream Worldstreet. All rights reserved.</p>
          <p>Icons: Solar by 480 Design</p>
        </div>
      </div>
    </footer>
  );
}
