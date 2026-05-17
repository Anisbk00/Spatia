import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { SignupForm } from "@/components/auth/SignupForm";

/**
 * Server-component wrapper for the signup page.
 *
 * Authenticated users are redirected based on their role:
 *   - Buyers (clients) without properties → /explore
 *   - Agents/admins or buyers with properties → /dashboard
 */
export default async function AuthSignupPage() {
  const supabase = await createClient();

  // If user is already authenticated, redirect based on role
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const admin = createAdminClient();
      if (admin) {
        try {
          const { data: profile } = await admin
            .from("users")
            .select("role")
            .eq("id", user.id)
            .single();

          const role = profile?.role || "client";

          if (role === "client") {
            const { count } = await admin
              .from("properties")
              .select("*", { count: "exact", head: true })
              .eq("owner_id", user.id);

            if (!count || count === 0) {
              redirect("/explore");
            }
          }
        } catch {
          // Fall through to dashboard
        }
      }
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
