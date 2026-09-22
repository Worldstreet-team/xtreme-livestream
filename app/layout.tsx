import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Archivo, Poppins } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

const dmSans = DM_Sans({subsets:['latin'],variable:'--font-sans'});

// Headlines. A grotesque with a narrow footprint and flat, level
// terminals: it holds a full sentence per line at display size instead of
// wrapping into rags, and it reads as authority rather than the soft,
// round friendliness the earlier faces brought.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
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

const isSatellite = process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE === "true";
const clerkDomain = process.env.NEXT_PUBLIC_CLERK_DOMAIN;
const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in";
const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up";

/**
 * Satellite mode is a PRODUCTION arrangement: there this app is a satellite
 * of the worldstreetgold.com hub and sign-in happens on the hub. Locally
 * there is no hub to hand off to, so unless satellite is explicitly switched
 * on the app runs standalone against the same Clerk test instance with its
 * own /sign-in route. Two explicit branches — ClerkProvider's props are a
 * discriminated union, so a conditional spread doesn't type-check.
 */

/** Clerk's own sign-in card, wearing Xtream's mark and ground. */
const clerkAppearance = {
  layout: { logoImageUrl: "/images/xtream-mark-square.png", logoPlacement: "inside" as const },
  variables: {
    colorPrimary: "#D6392C",
    colorBackground: "#141417",
    colorText: "#F2F2F3",
    colorInputBackground: "#1B1B20",
    borderRadius: "10px",
  },
};

function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  if (isSatellite && clerkDomain) {
    return (
      <ClerkProvider
        appearance={clerkAppearance}
        domain={clerkDomain}
        isSatellite
        signInUrl={signInUrl}
        signUpUrl={signUpUrl}
      >
        {children}
      </ClerkProvider>
    );
  }
  return (
    <ClerkProvider appearance={clerkAppearance} signInUrl={signInUrl} signUpUrl={signUpUrl}>
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
      <html lang="en" className={`${dmSans.variable} ${archivo.variable} ${poppins.variable} dark`}>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        >
          <AuthProvider>{children}</AuthProvider>
        </body>
      </html>
    </ClerkAuthProvider>
  );
}
