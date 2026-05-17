import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

/**
 * Server-component wrapper for the reset-password page.
 *
 * This page is accessed via the password reset email link.
 * Supabase sets a session when the user clicks the reset link,
 * so a valid recovery session should exist.
 *
 * We do NOT redirect authenticated users away here because
 * the password reset flow requires the recovery session.
 */
export default async function AuthResetPasswordPage() {
  const headersList = await headers();

  const host =
    headersList.get("x-forwarded-host") ||
    headersList.get("host") ||
    "localhost:3000";

  const proto =
    headersList.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");

  const appOrigin = `${proto}://${host}`;

  // Check if there's a valid recovery session
  let hasRecoverySession = false;
  const supabase = await createClient();
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    // Supabase sets the session with a recovery type on password reset links
    hasRecoverySession = !!session;
  }

  return <ResetPasswordForm appOrigin={appOrigin} hasRecoverySession={hasRecoverySession} />;
}
