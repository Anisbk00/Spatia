import { createClient } from "@/lib/supabase/server";
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

  // Check user role for role-specific tutorial content
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  const userRole = profile?.role || "agent";

  // Check onboarding state — if already completed, go to dashboard
  const { data: onboardingState } = await supabase
    .from("onboarding_state")
    .select("is_completed")
    .eq("user_id", userId)
    .maybeSingle();

  if (onboardingState?.is_completed) {
    redirect("/dashboard");
  }

  return <TutorialFlow userId={userId} userRole={userRole} />;
}
