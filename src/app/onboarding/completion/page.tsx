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

  // Check user role for role-specific completion content
  const admin = createAdminClient();
  let userRole = "agent";

  if (admin) {
    const { data: profile } = await admin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();
    userRole = profile?.role || "agent";
  } else {
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();
    userRole = profile?.role || "agent";
  }

  // Get full onboarding state
  const onboardingClient = admin || supabase;
  const { data: onboardingState } = await onboardingClient
    .from("onboarding_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // If onboarding already completed, redirect based on role
  if (onboardingState?.is_completed) {
    if (userRole === "client") {
      if (admin) {
        const { count } = await admin
          .from("properties")
          .select("*", { count: "exact", head: true })
          .eq("owner_id", userId);
        if (!count || count === 0) {
          redirect("/explore");
        }
      }
    }
    redirect("/dashboard");
  }

  // Get org membership for context
  const { data: membership } = await onboardingClient
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
