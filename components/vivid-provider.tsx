"use client"

import { useEffect } from "react"
import { useUser, useAuth } from "@clerk/nextjs"
import { usePathname, useRouter } from "next/navigation"
import { xtremeFunctions } from "@/lib/vivid-functions"
import VividVoiceControl from "@/components/vivid/vivid-voice-control"
import { SiraVividProvider } from "@/components/vivid/sira-provider"

// Hide the floating mic on auth routes: nobody should be talking to Vivid on a
// sign-in form, and the session mint would only bounce them back anyway.
const HIDE_MIC_ROUTES = ["/sign-in", "/sign-up", "/sso-callback"]

/**
 * Mounts Vivid's voice stack on Xtreme. Sira is the only engine. The persona
 * and the `lib/vivid-functions` tools go to Sira when a session is minted
 * (app/api/vivid/sira-session), and tool calls come back over the session's
 * WebSocket to run here or on /api/vivid/function.
 */
export function VividVoiceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser()
  const { isSignedIn } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const hideMic = HIDE_MIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))

  // navigateToPage / openStream dispatch vivid:navigate; the router does the rest.
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path
      if (path && path !== pathname) router.push(path)
    }
    window.addEventListener("vivid:navigate", handler)
    return () => window.removeEventListener("vivid:navigate", handler)
  }, [router, pathname])

  const vividUser = user
    ? {
        id: user.id,
        firstName: user.firstName || user.username || undefined,
        lastName: user.lastName || undefined,
        email: user.primaryEmailAddress?.emailAddress || undefined,
      }
    : null

  return (
    <SiraVividProvider
      user={vividUser}
      isSignedIn={isSignedIn ?? false}
      requireAuth
      pathname={pathname}
      functions={xtremeFunctions}
      onAuthRequired={() => {
        const redirectUrl = encodeURIComponent(pathname || "/")
        router.push(`/sign-in?redirect_url=${redirectUrl}`)
      }}
    >
      {children}
      {!hideMic && <VividVoiceControl />}
    </SiraVividProvider>
  )
}
