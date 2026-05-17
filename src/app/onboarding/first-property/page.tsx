import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { FirstPropertySetup } from "@/components/onboarding/FirstPropertySetup";

export default async function FirstPropertyOnboardingPage() {
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

  // Check user role — clients don't need to create properties
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (profile?.role === "client") {
    redirect("/onboarding/tutorial");
  }

  // Get org membership — required before creating a property
  const { data: membership } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership?.org_id) {
    redirect("/onboarding/organization");
  }

  const orgId = membership.org_id;

  // Check onboarding state — if already completed, go to dashboard
  const { data: onboardingState } = await supabase
    .from("onboarding_state")
    .select("is_completed")
    .eq("user_id", userId)
    .maybeSingle();

  if (onboardingState?.is_completed) {
    redirect("/dashboard");
  }

  return <FirstPropertySetup userId={userId} orgId={orgId} />;
}
