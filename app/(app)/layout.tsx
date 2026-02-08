"use client";

import { Sidebar } from "@/components/app/sidebar";
import { useAuth } from "@/lib/auth-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  // Show a loading state while checking auth
  // (AuthProvider handles redirect to login if unauthorized)
  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      {/* Main content — offset by sidebar width */}
      <main className="transition-all duration-300 md:ml-60 min-h-screen">
        {children}
      </main>
    </div>
  );
}
