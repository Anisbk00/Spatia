import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/LoginForm";

/**
 * Server-component wrapper for the login page.
 *
 * Reads the real external hostname from proxy headers so the client
 * component can build correct redirect URLs for OAuth and email confirmation.
 *
 * Authenticated users are redirected away from this page.
 */
export default async function AuthLoginPage() {
  const supabase = await createClient();

  // If user is already authenticated, redirect to dashboard
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      redirect("/dashboard");
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

  return <LoginForm appOrigin={appOrigin} />;
}
