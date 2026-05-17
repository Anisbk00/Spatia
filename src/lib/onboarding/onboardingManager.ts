// ============================================
// Onboarding Manager
// ============================================
// Coordinates onboarding operations:
// - Organization creation (with duplicate prevention)
// - Property creation during onboarding
// - Step completion tracking
// - Race condition handling
// ============================================

import { createClient } from "@/lib/supabase/client";
import {
  saveOnboardingState,
  markOnboardingComplete,
  addCompletedStep,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from "./onboardingState";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";

// ============================================
// Organization creation
// ============================================

export interface CreateOrgResult {
  orgId: string | null;
  error: string | null;
}

/**
 * Create an organization during onboarding.
 * Handles duplicate prevention and race conditions.
 */
export async function createOnboardingOrg(
  userId: string,
  agencyName: string,
  role: string,
  existingOrgId: string | null,
): Promise<CreateOrgResult> {
  const supabase = createClient();
  if (!supabase) {
    return { orgId: null, error: "Service not available" };
  }

  // If org already exists (resume scenario), skip creation
  if (existingOrgId) {
    return { orgId: existingOrgId, error: null };
  }

  // Check if user already has an org (race condition guard)
  const { data: existingMembership } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingMembership?.org_id) {
    return { orgId: existingMembership.org_id, error: null };
  }

  // Generate referral code
  let referralCode = "";
  try {
    const { data: rpcCode } = await supabase.rpc("generate_referral_code");
    referralCode = rpcCode || "";
  } catch {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const arr = new Uint8Array(8);
    if (typeof crypto !== "undefined") {
      crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < 8; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    referralCode = Array.from(arr, (b) => chars[b % chars.length]).join("");
  }

  // Create organization
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({
      name: agencyName.trim(),
      owner_id: userId,
      plan: "free",
      referral_code: referralCode,
    })
    .select()
    .single();

  if (orgError || !org) {
    // Check for unique violation (duplicate name + owner combo)
    if (orgError?.code === "23505") {
      // Try to find the existing org
      const { data: existingOrg } = await supabase
        .from("organizations")
        .select("id")
        .eq("owner_id", userId)
        .maybeSingle();

      if (existingOrg) {
        return { orgId: existingOrg.id, error: null };
      }
    }
    return { orgId: null, error: "Failed to create organization" };
  }

  // Create owner membership
  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({
      org_id: org.id,
      user_id: userId,
      role: "owner",
    });

  if (memberError) {
    // Org created but membership failed — still return the org
    console.error("[OnboardingManager] Membership creation failed:", memberError.message);
  }

  // Update user role to agent
  await supabase
    .from("users")
    .update({ role: "agent" })
    .eq("id", userId);

  return { orgId: org.id, error: null };
}

// ============================================
// Property creation
// ============================================

export interface CreatePropertyResult {
  propertyId: string | null;
  error: string | null;
}

/**
 * Create a property during onboarding.
 * Uses the /api/properties endpoint for consistency.
 */
export async function createOnboardingProperty(
  title: string,
  propertyType?: string,
  address?: string,
): Promise<CreatePropertyResult> {
  try {
    const res = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        property_type: propertyType || undefined,
        address: address?.trim() || undefined,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { propertyId: null, error: data.error || "Failed to create property" };
    }

    const data = await res.json();
    return { propertyId: data.property?.id ?? null, error: null };
  } catch {
    return { propertyId: null, error: "Network error" };
  }
}

// ============================================
// Step completion
// ============================================

/**
 * Complete an onboarding step:
 * 1. Track the analytics event
 * 2. Save the state
 * 3. Return the new completed steps array
 */
export async function completeOnboardingStep(
  step: OnboardingStep,
  completedSteps: number[],
  orgId?: string | null,
  metadata?: Record<string, unknown>,
): Promise<number[]> {
  const newCompleted = addCompletedStep(completedSteps, step);
  const nextStep = step + 1;

  trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, {
    step,
    total_completed: newCompleted.length,
    ...metadata,
  });

  await saveOnboardingState({
    currentStep: nextStep,
    completedSteps: newCompleted,
    orgId: orgId ?? undefined,
  });

  return newCompleted;
}

/**
 * Finish onboarding: mark complete and track.
 */
export async function finishOnboarding(
  completedSteps: number[],
  propertyCreated: boolean,
): Promise<void> {
  trackEvent(EVENT_TYPES.ONBOARDING_COMPLETED, {
    total_steps: completedSteps.length,
    property_created: propertyCreated,
  });

  await markOnboardingComplete();
}

/**
 * Skip onboarding: save state and track.
 */
export async function skipOnboarding(
  currentStep: OnboardingStep,
  completedSteps: number[],
): Promise<void> {
  trackEvent(EVENT_TYPES.ONBOARDING_COMPLETED, {
    step: currentStep,
    skipped: true,
  });

  await saveOnboardingState({
    currentStep: ONBOARDING_STEPS.COMPLETION,
    completedSteps,
    isCompleted: true,
    skipped: true,
  });
}
