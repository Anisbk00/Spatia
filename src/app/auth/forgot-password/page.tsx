import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

/**
 * Server-component wrapper for the forgot-password page.
 *
 * Authenticated users are redirected away — they should use
 * dashboard settings to change their password.
 */
export default async function AuthForgotPasswordPage() {
  const supabase = await createClient();

  // If user is already authenticated, redirect to settings
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      redirect("/dashboard/settings");
    }
  }

  const headersList = await headers();

  const host =
    headersList.get("x-forwarded-host") ||
    headersList.get("host") ||
    "localhost:3000";

  const proto =
    headersList.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");

  const appOrigin = `${proto}://${host}`;

  return <ForgotPasswordForm appOrigin={appOrigin} />;
}
