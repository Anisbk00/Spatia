// ============================================
// /auth/redirect — Post-login role-based redirect
// ============================================
// This page is used after sign-in to redirect
// users to the correct destination based on
// their role and whether they own properties.
//
// Rules:
//   - Not authenticated        → /auth/login
//   - Onboarding not completed → /onboarding
//   - Agent / Admin            → /dashboard
//   - Buyer with properties    → /dashboard
//   - Buyer without properties → /explore
// ============================================

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AuthRedirectPage() {
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

  const admin = createAdminClient();

  if (!admin) {
    redirect("/dashboard");
  }

  // 1. Check onboarding completion
  const { data: onboardingState } = await admin
    .from("onboarding_state")
    .select("is_completed")
    .eq("user_id", user.id)
    .maybeSingle();

  const hasCompletedOnboarding = onboardingState?.is_completed === true;

  if (!hasCompletedOnboarding) {
    redirect("/onboarding");
  }

  // 2. Check user role from users table
  // Use maybeSingle() — single() throws PGRST116 if no row exists
  const { data: profile } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  let role = profile?.role || "client";

  // 3. Fix stale role: If the user completed onboarding but has no org membership
  // and no properties, they likely selected "I'm a Buyer" during onboarding
  // but the role wasn't updated (bug in older code). Fix it now.
  if (role === "agent") {
    const { data: orgMembership } = await admin
      .from("organization_members")
      .select("org_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const { count: propertyCount } = await admin
      .from("properties")
      .select("*", { count: "exact", head: true })
      .eq("created_by", user.id);

    if (!orgMembership && (!propertyCount || propertyCount === 0)) {
      // User has no org and no properties — they're a buyer with a stale role
      await admin
        .from("users")
        .update({ role: "client" })
        .eq("id", user.id);
      role = "client";
    }
  }

  // Agents and admins always go to dashboard
  if (role === "agent" || role === "admin") {
    redirect("/dashboard");
  }

  // 4. Buyers (clients): check if they own properties
  const { count } = await admin
    .from("properties")
    .select("*", { count: "exact", head: true })
    .eq("created_by", user.id);

  // Buyers with properties go to dashboard, buyers without go to explore
  if (count && count > 0) {
    redirect("/dashboard");
  }

  redirect("/explore");
}
