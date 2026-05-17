import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignupForm } from "@/components/auth/SignupForm";

/**
 * Server-component wrapper for the signup page.
 *
 * Authenticated users are redirected to the role-aware redirect page.
 */
export default async function AuthSignupPage() {
  const supabase = await createClient();

  // If user is already authenticated, redirect to role-aware page
  if (supabase) {
    let user;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.error("[AuthSignup] getUser error:", error.message);
      }
      user = data.user;
    } catch (err) {
      console.error("[AuthSignup] getUser threw:", err);
    }
    if (user) {
      redirect("/auth/redirect");
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
