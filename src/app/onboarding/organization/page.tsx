import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OrganizationSetup } from "@/components/onboarding/OrganizationSetup";

export default async function OrganizationOnboardingPage() {
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

  // Check user role — clients don't need org setup
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (profile?.role === "client") {
    redirect("/onboarding/tutorial");
  }

  // Check if user already has org membership
  const { data: membership } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  const existingOrgId = membership?.org_id ?? null;

  // Check onboarding state — if already completed, go to dashboard
  const { data: onboardingState } = await supabase
    .from("onboarding_state")
    .select("is_completed")
    .eq("user_id", userId)
    .maybeSingle();

  if (onboardingState?.is_completed) {
    redirect("/dashboard");
  }

  return (
    <OrganizationSetup
      userId={userId}
      userEmail={userEmail}
      existingOrgId={existingOrgId}
    />
  );
}
