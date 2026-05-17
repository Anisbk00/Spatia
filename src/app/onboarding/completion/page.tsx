import { createClient, createAdminClient } from "@/lib/supabase/server";
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

  // Use admin client for all data operations (bypasses RLS)
  const adminClient = createAdminClient();
  const readClient = adminClient || supabase;

  // Check user role for role-specific completion content
  const { data: profile } = await readClient
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();
  const userRole = profile?.role || "client";

  // Get full onboarding state
  const { data: onboardingState } = await readClient
    .from("onboarding_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // If onboarding already completed, redirect based on role
  if (onboardingState?.is_completed) {
    // Use the role-aware redirect page
    redirect("/auth/redirect");
  }

  // Get org membership for context
  const { data: membership } = await readClient
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
