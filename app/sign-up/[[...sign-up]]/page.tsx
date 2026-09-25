import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/landing/auth-shell";

/** Local standalone sign-up — see the sign-in route for why this exists. */
export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="Join Xtream"
      title="Pull up a seat."
      lede="Follow the creators you like, send gifts that land on stream, and earn points just for watching."
    >
      <SignUp fallbackRedirectUrl="/explore" />
    </AuthShell>
  );
}
