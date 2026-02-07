import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Space_Grotesk } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${spaceGrotesk.variable} dark`}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
