import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Archivo, Poppins } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { APP_ORIGIN, HUB_REGISTER, HUB_SIGN_IN, isLocalClerk } from "@/lib/auth-urls";
import { AuthProvider } from "@/lib/auth-context";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { AccountThemeSync, ThemeSync } from "@/components/app/theme-switch";
import "./globals.css";

const dmSans = DM_Sans({subsets:['latin'],variable:'--font-sans'});

// Headlines, numbers, the whole voice. Loaded as the variable font with
// its width axis, because Afterglow (2026-09-23) speaks through it: wide
// (118%) for display, widest and thin (125%, 300) for money — the
// watch-dial numerals borrowed from Gold Floor — and condensed where a
// broadcast strap needs to fit. `font-wide` and `font-money` set these.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-display",
});

// The socials (WorldSpace) display face, for the house slides in the right
// rail that are drawn on that platform's grammar.
const poppins = Poppins({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-poppins" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Xtream Worldstreet — Crypto Livestreaming Platform",
  description: "Stream live, trade insights, and connect with the crypto community. Go live or explore streams on Xtream Worldstreet.",
  // A shared link carries the mark; without this a preview is a blank card.
  openGraph: {
    title: "Xtream Worldstreet",
    description: "Go live, flex your alpha, and get tipped in crypto.",
    siteName: "Xtream",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "Xtream Worldstreet" },
};

/**
 * In production sign-in happens on the worldstreetgold.com hub's own /login,
 * and anyone already signed in there is handshaken over without a form (the
 * satellite handshake lives in middleware.ts, on the server). Locally (a
 * pk_test_ key) the app runs standalone against the Clerk test instance
 * with its own /sign-in page. Two explicit branches — ClerkProvider's props
 * are a discriminated union, so a conditional spread doesn't type-check.
 */
/** Clerk's own sign-in card, wearing Xtream's mark and ground. */
const clerkAppearance = {
  layout: { logoImageUrl: "/images/xtream-mark-square.png", logoPlacement: "inside" as const },
  variables: {
    colorPrimary: "#EC1229",
    colorBackground: "#141417",
    colorText: "#F2F2F3",
    colorInputBackground: "#1B1B20",
    borderRadius: "10px",
  },
};

function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  if (!isLocalClerk) {
    // NOT isSatellite here, only in middleware.ts. A satellite clerk-js that
    // finds nobody signed in sends the browser to `https://clerk.<domain>/
    // v1/client/sync`, which for domain="worldstreetgold.com" is the hub's
    // own Clerk, and it refuses the request ("link_domain must be included")
    // — so every signed-out visitor to a public page ended on a raw JSON
    // error (production, 2026-09-29). WorldSpace never shows it because it
    // has no public pages: its server sends signed-out visitors to /login
    // before clerk-js runs. On a subdomain of the hub the browser needs no
    // sync anyway: it reads the hub's session from clerk.worldstreetgold.com
    // directly, and the server-side handshake still runs in middleware.ts.
    return (
      <ClerkProvider
        appearance={clerkAppearance}
        signInUrl={HUB_SIGN_IN}
        signUpUrl={HUB_REGISTER}
        signInFallbackRedirectUrl={`${APP_ORIGIN}/explore`}
        signUpFallbackRedirectUrl={`${APP_ORIGIN}/explore`}
      >
        {children}
      </ClerkProvider>
    );
  }
  return (
    <ClerkProvider appearance={clerkAppearance} signInUrl="/sign-in" signUpUrl="/sign-up">
      {children}
    </ClerkProvider>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkAuthProvider>
      {/* The head script sets data-theme before paint, so <html> differs from the server's on purpose. */}
      <html lang="en" className={`${dmSans.variable} ${archivo.variable} ${poppins.variable} dark`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        </head>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        >
          <ThemeSync />
          <AuthProvider>
            <AccountThemeSync />
            {children}
          </AuthProvider>
        </body>
      </html>
    </ClerkAuthProvider>
  );
}
