import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TutorialFlow } from "@/components/onboarding/TutorialFlow";

export default async function TutorialOnboardingPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    redirect("/auth/login");
  }

  if (!supabase) {
    redirect("/auth/login");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const userId = user.id;

  // Use admin client for all data operations (bypasses RLS)
  const adminClient = createAdminClient();
  const readClient = adminClient || supabase;

  try {
    // Check user role for role-specific tutorial content
    // Use maybeSingle() — single() throws PGRST116 if no row exists
    const { data: profile } = await readClient
      .from("users")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    const userRole = profile?.role || "client";

    // Check onboarding state — if already completed, redirect based on role
    const { data: onboardingState } = await readClient
      .from("onboarding_state")
      .select("is_completed")
      .eq("user_id", userId)
      .maybeSingle();

    if (onboardingState?.is_completed) {
      // Role-aware redirect: buyers → /explore, agents/admins → /dashboard
      redirect("/auth/redirect");
    }

    return <TutorialFlow userId={userId} userRole={userRole} />;
  } catch (err) {
    // Re-throw Next.js redirect errors
    if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string") {
      const digest = (err as { digest: string }).digest;
      if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) {
        throw err;
      }
    }
    console.error("[TutorialOnboarding] Error:", err);
    redirect("/onboarding");
  }
}
