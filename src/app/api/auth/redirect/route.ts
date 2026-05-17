// ============================================
// GET /api/auth/redirect
// ============================================
// Returns the post-login redirect path for the
// currently authenticated user based on their
// role and whether they own properties.
//
// Rules:
//   - Buyer (client) with no properties → /explore
//   - Buyer (client) with properties    → /dashboard
//   - Agent / Admin                     → /dashboard
//   - Onboarding not completed          → /onboarding
// ============================================

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ redirect: "/dashboard" });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ redirect: "/auth/login" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ redirect: "/dashboard" });
  }

  try {
    // 1. Check onboarding completion
    const { data: onboardingState } = await admin
      .from("onboarding_state")
      .select("is_completed")
      .eq("user_id", user.id)
      .maybeSingle();

    const hasCompletedOnboarding = onboardingState?.is_completed === true;

    if (!hasCompletedOnboarding) {
      return NextResponse.json({ redirect: "/onboarding" });
    }

    // 2. Check user role
    const { data: profile } = await admin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role || "client";

    // Agents and admins always go to dashboard
    if (role === "agent" || role === "admin") {
      return NextResponse.json({ redirect: "/dashboard" });
    }

    // 3. Buyers (clients): check if they own properties
    const { count } = await admin
      .from("properties")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id);

    if (count && count > 0) {
      return NextResponse.json({ redirect: "/dashboard" });
    }

    // Buyers without properties go to explore
    return NextResponse.json({ redirect: "/explore" });
  } catch (err) {
    console.error("[/api/auth/redirect] Error:", err);
    return NextResponse.json({ redirect: "/dashboard" });
  }
}
