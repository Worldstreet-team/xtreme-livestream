import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Archivo, Poppins } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { HUB_REGISTER, HUB_SIGN_IN, isLocalClerk } from "@/lib/auth-urls";
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
 * Satellite of the worldstreetgold.com hub in production, declared in CODE
 * the way WorldSpace, the dashboard, academy and arcade declare it (see
 * middleware.ts): sign-in happens on the hub's own /login, and anyone
 * already signed in there is handshaken over without a form. Locally (a
 * pk_test_ key) the app runs standalone against the Clerk test instance
 * with its own /sign-in page. Two explicit branches — ClerkProvider's props
 * are a discriminated union, so a conditional spread doesn't type-check.
 */
const APP_ORIGIN = "https://xtreme.worldstreetgold.com";

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
    return (
      <ClerkProvider
        appearance={clerkAppearance}
        domain="worldstreetgold.com"
        isSatellite
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
