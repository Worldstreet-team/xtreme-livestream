import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { FeaturedStreams } from "@/components/landing/featured-streams";
import { TopStreamers } from "@/components/landing/top-streamers";
import { Footer } from "@/components/landing/footer";

export default function Page() {
  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <Hero />
      <FeaturedStreams />
      <TopStreamers />
      <Footer />
    </main>
  );
}