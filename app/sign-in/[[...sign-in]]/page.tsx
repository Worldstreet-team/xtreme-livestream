import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/landing/auth-shell";

/**
 * Local standalone sign-in. In production this app is a Clerk satellite and
 * auth happens on the worldstreetgold.com hub, so this route is never used
 * there — it exists so local dev can authenticate against the same Clerk
 * test instance without reaching for the production domain. Every "Sign in"
 * in the app points here off-satellite (lib/auth-urls.ts); the card takes
 * its colours from the provider's appearance in app/layout.tsx.
 */
export default function SignInPage() {
  return (
    <AuthShell
      eyebrow="Sign in"
      title="The room's already live."
      lede="Pick up where you left off — your follows, your points and your channel are waiting."
    >
      <SignIn fallbackRedirectUrl="/explore" />
    </AuthShell>
  );
}
