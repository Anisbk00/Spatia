"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SpatiaLogo } from "@/components/SpatiaLogo";
import { Loader2 } from "lucide-react";

/**
 * Client-side OAuth callback handler.
 *
 * Supabase PKCE stores the code_verifier in the browser's cookie storage
 * (via @supabase/ssr createBrowserClient with cookie handlers). The code
 * exchange MUST happen client-side so it can read those cookies.
 *
 * Flow: Google → Supabase → /?code=... → middleware → /auth/complete?code=...
 *       → this page exchanges code for session → redirects to dashboard.
 */
export default function AuthCompletePage() {
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (!code) {
      window.location.href = "/auth/login?error=missing_code";
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      window.location.href = "/auth/login?error=service_unavailable";
      return;
    }

    supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
      if (exchangeError) {
        setError(exchangeError.message);
        setTimeout(() => {
          window.location.href = "/auth/login?error=auth_failed";
        }, 2000);
        return;
      }

      // Success — check role and redirect
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) {
          window.location.href = "/auth/login?error=no_session";
          return;
        }

        // Fetch redirect path from server-side API that checks role + properties
        fetch("/api/auth/redirect")
          .then((res) => res.ok ? res.json() : { redirect: "/dashboard" })
          .then((data) => {
            window.location.href = data.redirect || "/dashboard";
          })
          .catch(() => {
            window.location.href = "/dashboard";
          });
      });
    });
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      <div className="flex items-center gap-2 mb-8">
        <SpatiaLogo size="lg" />
        <span className="text-lg font-bold tracking-tight">Spatia</span>
      </div>

      {error ? (
        <div className="text-center space-y-2">
          <p className="text-red-600 font-medium">Sign-in failed</p>
          <p className="text-sm text-muted-foreground">Redirecting you back to login…</p>
        </div>
      ) : (
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mx-auto" />
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        </div>
      )}
    </div>
  );
}
