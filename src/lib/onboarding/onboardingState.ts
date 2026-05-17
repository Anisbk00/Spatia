// ============================================
// Onboarding State Manager
// ============================================
// Client-side onboarding state management with:
// - Persistent state via /api/onboarding
// - Resume-after-refresh support
// - Step validation
// - Race condition prevention
// ============================================

import type { OnboardingState } from "@/lib/types";

// ============================================
// Types
// ============================================

export const ONBOARDING_STEPS = {
  WELCOME: 0,
  ORGANIZATION: 1,
  FIRST_PROPERTY: 2,
  TUTORIAL: 3,
  COMPLETION: 4,
} as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[keyof typeof ONBOARDING_STEPS];

export const STEP_ROUTES: Record<OnboardingStep, string> = {
  [ONBOARDING_STEPS.WELCOME]: "/onboarding",
  [ONBOARDING_STEPS.ORGANIZATION]: "/onboarding/organization",
  [ONBOARDING_STEPS.FIRST_PROPERTY]: "/onboarding/first-property",
  [ONBOARDING_STEPS.TUTORIAL]: "/onboarding/tutorial",
  [ONBOARDING_STEPS.COMPLETION]: "/onboarding/completion",
};

export const TOTAL_STEPS = 5;

// ============================================
// Fetch onboarding state
// ============================================

/**
 * Fetch the current user's onboarding state from the API.
 * Returns null if not authenticated or no state exists.
 */
export async function fetchOnboardingState(): Promise<OnboardingState | null> {
  try {
    const res = await fetch("/api/onboarding");
    if (!res.ok) return null;
    const data = await res.json();
    return (data.onboarding_state as OnboardingState) ?? null;
  } catch {
    return null;
  }
}

// ============================================
// Save onboarding state
// ============================================

export interface SaveOnboardingStateOptions {
  currentStep?: number;
  completedSteps?: number[];
  orgId?: string;
  isCompleted?: boolean;
  skipped?: boolean;
}

/**
 * Persist onboarding state to the API.
 * Handles errors gracefully — onboarding must never break UX.
 */
export async function saveOnboardingState(
  options: SaveOnboardingStateOptions,
): Promise<OnboardingState | null> {
  try {
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_step: options.currentStep,
        completed_steps: options.completedSteps,
        org_id: options.orgId,
        is_completed: options.isCompleted ?? false,
        skipped: options.skipped ?? false,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return (data.onboarding_state as OnboardingState) ?? null;
  } catch {
    return null;
  }
}

// ============================================
// Mark onboarding complete
// ============================================

/**
 * Mark onboarding as completed via the dedicated API endpoint.
 */
export async function markOnboardingComplete(): Promise<boolean> {
  try {
    const res = await fetch("/api/onboarding/complete", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================
// Step navigation helpers
// ============================================

/**
 * Get the route for the next incomplete step.
 * Used for resuming onboarding after refresh.
 */
export function getResumeRoute(state: OnboardingState | null): string {
  if (!state || state.is_completed) return "/dashboard";
  return STEP_ROUTES[state.current_step as OnboardingStep] ?? "/onboarding";
}

/**
 * Check if a step is completed.
 */
export function isStepCompleted(
  completedSteps: number[],
  step: OnboardingStep,
): boolean {
  return completedSteps.includes(step);
}

/**
 * Add a step to the completed list (deduped, sorted).
 */
export function addCompletedStep(
  completedSteps: number[],
  step: OnboardingStep,
): number[] {
  return Array.from(new Set([...completedSteps, step])).sort();
}

/**
 * Validate that a user can access a given step.
 * They must have completed all previous steps.
 */
export function canAccessStep(
  targetStep: OnboardingStep,
  completedSteps: number[],
): boolean {
  // Welcome is always accessible
  if (targetStep === ONBOARDING_STEPS.WELCOME) return true;

  // Each step requires the previous one to be completed
  for (let i = 0; i < targetStep; i++) {
    if (!completedSteps.includes(i)) return false;
  }
  return true;
}
