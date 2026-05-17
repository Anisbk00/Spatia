// ============================================
// /auth/redirect — Post-login role-based redirect
// ============================================
// This page is used by the middleware to redirect
// authenticated users away from auth-only pages
// (like /auth/login) to the correct destination
// based on their role and properties.
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

  try {
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

    // 2. Check user role
    const { data: profile } = await admin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role || "client";

    // Agents and admins always go to dashboard
    if (role === "agent" || role === "admin") {
      redirect("/dashboard");
    }

    // 3. Buyers (clients): check if they own properties
    const { count } = await admin
      .from("properties")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id);

    // Buyers with properties go to dashboard, buyers without go to explore
    if (count && count > 0) {
      redirect("/dashboard");
    }

    redirect("/explore");
  } catch (err) {
    // If it's a Next.js redirect, re-throw it
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    console.error("[/auth/redirect] Error:", err);
    redirect("/dashboard");
  }
}
