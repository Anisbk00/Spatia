import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignupForm } from "@/components/auth/SignupForm";

/**
 * Server-component wrapper for the signup page.
 *
 * Authenticated users are redirected away from this page.
 */
export default async function AuthSignupPage() {
  const supabase = await createClient();

  // If user is already authenticated, redirect to onboarding or dashboard
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

  return <SignupForm appOrigin={appOrigin} />;
}
