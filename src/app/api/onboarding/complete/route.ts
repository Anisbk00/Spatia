// ============================================
// POST /api/onboarding/complete
// ============================================
// Mark onboarding as completed for the
// authenticated user.
// Uses admin client to bypass RLS and ensure
// the update always succeeds.
// ============================================

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use admin client to bypass RLS — ensures onboarding completion
  // always succeeds even if RLS policies are misconfigured
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin service not configured" },
      { status: 503 }
    );
  }

  // Upsert: update existing or create new
  const { data: existing } = await admin
    .from("onboarding_state")
    .select("id, completed_steps")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    // Add step 4 to completed if not already there, then mark complete
    const mergedCompleted = Array.from(
      new Set([...(existing.completed_steps || []), 4])
    ).sort();

    const { data: updated, error } = await admin
      .from("onboarding_state")
      .update({
        current_step: 4,
        completed_steps: mergedCompleted,
        is_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error || !updated) {
      console.error("[/api/onboarding/complete] Update error:", error);
      return NextResponse.json(
        { error: "Failed to complete onboarding" },
        { status: 500 }
      );
    }

    return NextResponse.json({ state: updated });
  }

  // No existing state — create as completed
  const { data: created, error } = await admin
    .from("onboarding_state")
    .insert({
      user_id: user.id,
      current_step: 4,
      completed_steps: [0, 1, 2, 3, 4],
      is_completed: true,
      skipped: false,
    })
    .select()
    .single();

  if (error || !created) {
    console.error("[/api/onboarding/complete] Insert error:", error);
    return NextResponse.json(
      { error: "Failed to complete onboarding" },
      { status: 500 }
    );
  }

  return NextResponse.json({ state: created }, { status: 201 });
}
