import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CompletionScreen } from "@/components/onboarding/CompletionScreen";
import type { OnboardingState } from "@/lib/types";

export default async function CompletionOnboardingPage() {
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
  const userEmail = user.email ?? "";

  // Check user role for role-specific completion content
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  const userRole = profile?.role || "agent";

  // Get full onboarding state
  const { data: onboardingState } = await supabase
    .from("onboarding_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // If onboarding already completed, redirect to dashboard
  if (onboardingState?.is_completed) {
    redirect("/dashboard");
  }

  // Get org membership for context
  const { data: membership } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  const orgId = membership?.org_id ?? null;

  return (
    <CompletionScreen
      userId={userId}
      userEmail={userEmail}
      orgId={orgId}
      onboardingState={(onboardingState as OnboardingState) ?? null}
      userRole={userRole}
    />
  );
}
