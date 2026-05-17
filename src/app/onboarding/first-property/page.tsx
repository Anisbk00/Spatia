import { createClient, createAdminClient } from "@/lib/supabase/server";
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

  // Use admin client for all data operations (bypasses RLS)
  const adminClient = createAdminClient();
  const readClient = adminClient || supabase;

  // Check user role — clients don't need to create properties
  const { data: profile } = await readClient
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();
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
}
