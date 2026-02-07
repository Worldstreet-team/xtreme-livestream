"use client";

import { Sidebar } from "@/components/app/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
