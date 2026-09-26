"use client";

import { SponsorshipsView } from "@/components/app/sponsorships-view";
import { useAuth } from "@/lib/auth-context";
import { useSponsorships } from "@/lib/sponsors";

/** Sponsorships, inside Your channel (see SponsorshipsView). */
export default function SponsorshipsPage() {
  const { user } = useAuth();
  const sponsorships = useSponsorships(Boolean(user));
  return <SponsorshipsView {...sponsorships} />;
}
