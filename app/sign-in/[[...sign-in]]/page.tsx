import { SignIn } from "@clerk/nextjs";

/**
 * Local standalone sign-in. In production this app is a Clerk satellite and
 * auth happens on the worldstreetgold.com hub, so this route is never used
 * there — it exists so local dev can authenticate against the same Clerk
 * test instance without reaching for the production domain.
 */
export default function SignInPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6 bg-background">
      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#EAB308",
            colorBackground: "#1C1917",
            colorText: "#FAFAF9",
            colorInputBackground: "#0C0A09",
            borderRadius: "10px",
          },
        }}
      />
    </main>
  );
}
