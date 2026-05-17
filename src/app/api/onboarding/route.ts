// ============================================
// GET /api/onboarding  —  Get onboarding state
// POST /api/onboarding  —  Create or update onboarding state
// ============================================

import { createClient } from "@/lib/supabase/server";
import { trackServerEvent, EVENT_TYPES } from "@/lib/event-tracking/server";
import { NextRequest, NextResponse } from "next/server";
import type { OnboardingState } from "@/lib/types";

// ============================================
// Request / Response types
// ============================================

interface OnboardingUpdateRequest {
  current_step?: number;
  completed_steps?: number[];
  is_completed?: boolean;
  skipped?: boolean;
  org_id?: string;
}

// ============================================
// GET — Get current user's onboarding state
// ============================================

export async function GET() {
  // 1. Authenticate the user
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Look up onboarding state
  const { data: onboardingState, error } = await supabase
    .from("onboarding_state")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[/api/onboarding GET] Query failed:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch onboarding state" },
      { status: 500 },
    );
  }

  // 3. Return onboarding state or null
  return NextResponse.json({
    onboarding_state: onboardingState as OnboardingState | null,
  });
}

// ============================================
// POST — Create or update onboarding state
// ============================================

export async function POST(request: NextRequest) {
  // 1. Authenticate the user
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse and validate request body
  let body: OnboardingUpdateRequest;
  try {
    body = await request.json();
  } catch (err) {
    console.error("[OnboardingAPI] JSON parse failed:", err);
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Validate current_step if provided
  if (body.current_step !== undefined && (typeof body.current_step !== "number" || body.current_step < 0)) {
    return NextResponse.json(
      { error: "current_step must be a non-negative number" },
      { status: 400 },
    );
  }

  // Validate completed_steps if provided
  if (body.completed_steps !== undefined) {
    if (!Array.isArray(body.completed_steps) || !body.completed_steps.every((s) => typeof s === "number")) {
      return NextResponse.json(
        { error: "completed_steps must be an array of numbers" },
        { status: 400 },
      );
    }
  }

  // Validate is_completed if provided
  if (body.is_completed !== undefined && typeof body.is_completed !== "boolean") {
    return NextResponse.json(
      { error: "is_completed must be a boolean" },
      { status: 400 },
    );
  }

  // Validate skipped if provided
  if (body.skipped !== undefined && typeof body.skipped !== "boolean") {
    return NextResponse.json(
      { error: "skipped must be a boolean" },
      { status: 400 },
    );
  }

  // 3. Look up user's org membership if org_id not provided
  let orgId = body.org_id || null;
  if (!orgId) {
    const { data: orgMembership } = await supabase
      .from("organization_members")
      .select("org_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    orgId = orgMembership?.org_id || null;
  }

  // 4. Check if onboarding state already exists
  const { data: existingState } = await supabase
    .from("onboarding_state")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  // 5. Build the data to upsert
  const upsertData: Record<string, unknown> = {
    user_id: user.id,
    org_id: orgId,
  };

  if (body.current_step !== undefined) {
    upsertData.current_step = body.current_step;
  }
  if (body.completed_steps !== undefined) {
    upsertData.completed_steps = body.completed_steps;
  }
  if (body.is_completed !== undefined) {
    upsertData.is_completed = body.is_completed;
  }
  if (body.skipped !== undefined) {
    upsertData.skipped = body.skipped;
  }

  // 6. Upsert into onboarding_state table
  const { data: upsertedState, error: upsertError } = await supabase
    .from("onboarding_state")
    .upsert(upsertData, {
      onConflict: "user_id",
    })
    .select()
    .single();

  if (upsertError) {
    console.error("[/api/onboarding POST] Upsert failed:", upsertError.message);
    return NextResponse.json(
      { error: "Failed to update onboarding state" },
      { status: 500 },
    );
  }

  // 7. Track appropriate events based on state transitions
  const wasCompleted = existingState?.is_completed === true;
  const isNowCompleted = upsertedState.is_completed === true;
  const isNewOnboarding = !existingState;
  const previousStep = (existingState?.completed_steps as number[]) || [];
  const currentSteps = (upsertedState.completed_steps as number[]) || [];
  const newStepsCompleted = currentSteps.filter(
    (step: number) => !previousStep.includes(step),
  );

  // Track ONBOARDING_STARTED if this is a new onboarding state
  if (isNewOnboarding) {
    await trackServerEvent(
      EVENT_TYPES.ONBOARDING_STARTED,
      {
        current_step: upsertedState.current_step,
        org_id: orgId,
      },
      user.id,
      orgId,
      request,
    );
  }

  // Track ONBOARDING_STEP_COMPLETED for each new step
  for (const step of newStepsCompleted) {
    await trackServerEvent(
      EVENT_TYPES.ONBOARDING_STEP_COMPLETED,
      {
        step,
        total_completed: currentSteps.length,
      },
      user.id,
      orgId,
      request,
    );
  }

  // Track ONBOARDING_COMPLETED if onboarding just completed
  if (isNowCompleted && !wasCompleted) {
    await trackServerEvent(
      EVENT_TYPES.ONBOARDING_COMPLETED,
      {
        skipped: upsertedState.skipped,
        total_steps: currentSteps.length,
      },
      user.id,
      orgId,
      request,
    );
  }

  // 8. Return the upserted state
  return NextResponse.json({
    onboarding_state: upsertedState as OnboardingState,
  });
}
