"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

/**
 * Whether the signed-in person is one of the platform's admins
 * (ADMIN_USERNAMES on the API) — null while it's being asked.
 */
export function useIsAdmin() {
  const { user } = useAuth();
  const [admin, setAdmin] = useState<{ userId: string; admin: boolean } | null>(null);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    apiFetch<{ success: boolean; data: { admin: boolean } }>("/api/admin/me")
      .then((r) => alive && setAdmin({ userId: user.id, admin: r.data.admin }))
      .catch(() => alive && setAdmin({ userId: user.id, admin: false }));
    return () => {
      alive = false;
    };
  }, [user]);
  if (!user) return false;
  return admin?.userId === user.id ? admin.admin : null;
}
