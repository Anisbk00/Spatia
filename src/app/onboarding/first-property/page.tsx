import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { FirstPropertySetup } from "@/components/onboarding/FirstPropertySetup";

export default async function FirstPropertyOnboardingPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    redirect("/auth/login");
  }

  if (!supabase) {
    redirect("/auth/login");
  }

  let user;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("[FirstProperty] getUser error:", error.message);
    }
    user = data.user;
  } catch (err) {
    console.error("[FirstProperty] getUser threw:", err);
  }

  if (!user) {
    redirect("/auth/login");
  }

  const userId = user.id;

  // Use admin client for all data operations (bypasses RLS)
  const adminClient = createAdminClient();
  const readClient = adminClient || supabase;

  try {
    // Check user role — clients don't need to create properties
    // Use maybeSingle() — single() throws PGRST116 if no row exists
    const { data: profile } = await readClient
      .from("users")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    const userRole = profile?.role || "client";

    if (userRole === "client") {
      redirect("/onboarding/tutorial");
    }

    // Get org membership — required before creating a property
    const { data: membership } = await readClient
      .from("organization_members")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!membership?.org_id) {
      redirect("/onboarding/organization");
    }

    const orgId = membership.org_id;

    // Check onboarding state — if already completed, redirect based on role
    const { data: onboardingState } = await readClient
      .from("onboarding_state")
      .select("is_completed")
      .eq("user_id", userId)
      .maybeSingle();

    if (onboardingState?.is_completed) {
      // Role-aware redirect
      redirect("/auth/redirect");
    }

    return <FirstPropertySetup userId={userId} orgId={orgId} />;
  } catch (err) {
    // Re-throw Next.js redirect errors
    if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string") {
      const digest = (err as { digest: string }).digest;
      if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) {
        throw err;
      }
    }
    console.error("[FirstPropertyOnboarding] Error:", err);
    redirect("/onboarding");
  }
}
