import { Flame } from "@phosphor-icons/react/dist/ssr";

const footerLinks = {
  Platform: [
    { label: "Explore Streams", href: "#" },
    { label: "Start Streaming", href: "#" },
    { label: "Categories", href: "#" },
    { label: "Top Streamers", href: "#" },
  ],
  Community: [
    { label: "Discord", href: "#" },
    { label: "Twitter / X", href: "#" },
    { label: "Telegram", href: "#" },
    { label: "Blog", href: "#" },
  ],
  Support: [
    { label: "Help Center", href: "#" },
    { label: "Contact Us", href: "#" },
    { label: "Creator Guidelines", href: "#" },
    { label: "API Docs", href: "#" },
  ],
  Legal: [
    { label: "Terms of Service", href: "#" },
    { label: "Privacy Policy", href: "#" },
    { label: "Cookie Policy", href: "#" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
                <Flame size={18} weight="fill" />
              </div>
              <span className="text-base font-bold tracking-tight text-foreground">
                Xtreme <span className="text-primary">Worldstreet</span>
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              The underground crypto livestreaming platform. Stream it. Trade
              it. Live it.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              <ul className="mt-3 space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/5 pt-8 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Xtreme Worldstreet. All rights
            reserved.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Status
            </a>
            <span className="text-white/10">|</span>
            <a
              href="#"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Changelog
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
