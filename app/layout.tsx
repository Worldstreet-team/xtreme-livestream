import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Space_Grotesk } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

const dmSans = DM_Sans({subsets:['latin'],variable:'--font-sans'});

const spaceGrotesk = Space_Grotesk({subsets:['latin'],variable:'--font-display'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Xtreme Worldstreet — Crypto Livestreaming Platform",
  description: "Stream live, trade insights, and connect with the crypto community. Go live or explore streams on Xtreme Worldstreet.",
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
function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  if (isSatellite && clerkDomain) {
    return (
      <ClerkProvider
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
    <ClerkProvider signInUrl={signInUrl} signUpUrl={signUpUrl}>
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
      <html lang="en" className={`${dmSans.variable} ${spaceGrotesk.variable} dark`}>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        >
          <AuthProvider>{children}</AuthProvider>
        </body>
      </html>
    </ClerkAuthProvider>
  );
}
