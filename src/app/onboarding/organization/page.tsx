import { createClient, createAdminClient } from "@/lib/supabase/server";
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

  // Use admin client to check role (bypasses RLS)
  const admin = createAdminClient();
  const checkClient = admin || supabase;

  // Check user role — clients don't need org setup
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

  if (userRole === "client") {
    redirect("/onboarding/tutorial");
  }

  // Check if user already has org membership
  const { data: membership } = await checkClient
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  const existingOrgId = membership?.org_id ?? null;

  // Check onboarding state — if already completed, redirect based on role
  const { data: onboardingState } = await checkClient
    .from("onboarding_state")
    .select("is_completed")
    .eq("user_id", userId)
    .maybeSingle();

  if (onboardingState?.is_completed) {
    // Role-aware redirect
    redirect("/auth/redirect");
  }

  return (
    <OrganizationSetup
      userId={userId}
      userEmail={userEmail}
      existingOrgId={existingOrgId}
    />
  );
}
