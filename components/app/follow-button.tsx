"use client";

import { useState } from "react";
import { Heart, Check, HeartBreak } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Pill, PILL_ICON, type PillSize } from "@/components/ui/pill";

const SIGN_IN_URL = "https://www.worldstreetgold.com/login";

/**
 * Follow / unfollow a channel.
 *
 * Optimistic: the label flips immediately and rolls back if the request
 * fails, because the round trip is long enough that a "Follow" button which
 * sits inert for half a second reads as broken. Signed-out visitors get sent
 * to sign-in rather than a disabled control — following is the single most
 * common reason someone makes an account.
 *
 * Follow is the lit primary pill; Following is quiet glass that turns into
 * a red "Unfollow" only while hovered, so the destructive path is never the
 * resting state.
 */
export function FollowButton({
  username,
  initialFollowing,
  size = "default",
  onChange,
  className,
}: {
  username: string;
  initialFollowing: boolean;
  size?: "default" | "sm" | "lg";
  /** Fired after a confirmed change, so a parent can adjust its count. */
  onChange?: (following: boolean) => void;
  className?: string;
}) {
  const { isAuthenticated, user } = useAuth();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [hovering, setHovering] = useState(false);

  // Your own channel has nothing to follow.
  if (user?.username === username) return null;

  async function toggle() {
    if (!isAuthenticated) {
      window.location.href = SIGN_IN_URL;
      return;
    }
    if (pending) return;

    const next = !following;
    setFollowing(next);
    setPending(true);
    try {
      await apiFetch(`/api/user/${username}/follow`, {
        method: next ? "POST" : "DELETE",
      });
      onChange?.(next);
    } catch {
      setFollowing(!next);
    } finally {
      setPending(false);
    }
  }

  const pillSize: PillSize = size === "sm" ? "sm" : size === "lg" ? "lg" : "md";
  const iconSize = PILL_ICON[pillSize];
  const unfollowing = following && hovering;

  return (
    <Pill
      size={pillSize}
      variant={following ? "soft" : "primary"}
      tone={unfollowing ? "red" : "neutral"}
      icon={
        following ? (
          unfollowing ? <HeartBreak size={iconSize} weight="fill" /> : <Check size={iconSize} weight="bold" />
        ) : (
          <Heart size={iconSize} weight="fill" />
        )
      }
      onClick={toggle}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      disabled={pending}
      aria-pressed={following}
      className={className}
    >
      {following ? (unfollowing ? "Unfollow" : "Following") : "Follow"}
    </Pill>
  );
}
