import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TutorialFlow } from "@/components/onboarding/TutorialFlow";

export default async function TutorialOnboardingPage() {
  const supabase = await createClient();

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

  // Check user role for role-specific tutorial content
  const { data: profile } = await readClient
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();
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
}
