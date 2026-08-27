import { SignUp } from "@clerk/nextjs";

/** Local standalone sign-up — see the sign-in route for why this exists. */
export default function SignUpPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6 bg-background">
      <SignUp
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
