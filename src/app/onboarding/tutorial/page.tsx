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

  // Use admin client to check role (bypasses RLS)
  const admin = createAdminClient();

  // Check user role for role-specific tutorial content
  let userRole = "client";
  if (admin) {
    const { data: profile } = await admin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();
    userRole = profile?.role || "client";
  } else {
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();
    userRole = profile?.role || "client";
  }

  // Check onboarding state — if already completed, redirect based on role
  const checkClient = admin || supabase;
  const { data: onboardingState } = await checkClient
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
