// ============================================
// Post-login redirect logic
// ============================================
// Determines where to send a user after
// authentication based on their role and
// whether they own any properties.
//
// Rules:
//   - Buyer (client) with no properties → /explore
//   - Buyer (client) with properties    → /dashboard
//   - Agent / Admin                     → /dashboard
//   - Onboarding not completed          → /onboarding
// ============================================

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Determine the post-login redirect path for a user.
 *
 * Checks:
 *   1. Has the user completed onboarding?
 *   2. What is their role (client vs agent/admin)?
 *   3. Does the user own any properties?
 *
 * Returns a relative path string like "/dashboard", "/explore", or "/onboarding".
 */
export async function getPostLoginRedirect(userId: string): Promise<string> {
  const admin = createAdminClient();

  // If admin client is unavailable, fall back to dashboard
  if (!admin) {
    return "/dashboard";
  }

  try {
    // 1. Check onboarding completion
    const { data: onboardingState } = await admin
      .from("onboarding_state")
      .select("is_completed")
      .eq("user_id", userId)
      .maybeSingle();

    const hasCompletedOnboarding = onboardingState?.is_completed === true;

    // Not yet onboarded → send to onboarding
    if (!hasCompletedOnboarding) {
      return "/onboarding";
    }

    // 2. Check user role
    const { data: profile } = await admin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    const role = profile?.role || "client";

    // Agents and admins always go to dashboard
    if (role === "agent" || role === "admin") {
      return "/dashboard";
    }

    // 3. Buyers (clients): check if they own properties
    const { count } = await admin
      .from("properties")
      .select("*", { count: "exact", head: true })
      .eq("created_by", userId);

    // Buyers with properties go to dashboard
    if (count && count > 0) {
      return "/dashboard";
    }

    // Buyers without properties go to explore
    return "/explore";
  } catch (err) {
    console.error("[getPostLoginRedirect] Error determining redirect:", err);
    return "/dashboard";
  }
}
