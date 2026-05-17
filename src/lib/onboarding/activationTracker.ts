// ============================================
// Activation Tracker
// ============================================
// Tracks user activation funnel:
// signup_completed → onboarding_started → organization_created
// → tutorial_completed → first_property_created → first_capture_started
// → onboarding_completed
// ============================================

import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";

// ============================================
// Activation funnel steps
// ============================================

export const ACTIVATION_STEPS = [
  "signup_completed",
  "onboarding_started",
  "organization_created",
  "tutorial_completed",
  "first_property_created",
  "first_capture_started",
  "onboarding_completed",
] as const;

export type ActivationStep = (typeof ACTIVATION_STEPS)[number];

// ============================================
// Tracking functions
// ============================================

/**
 * Track onboarding started event.
 */
export function trackOnboardingStarted(orgId?: string): void {
  trackEvent(EVENT_TYPES.ONBOARDING_STARTED, {
    funnel_step: "onboarding_started",
    org_id: orgId,
  });
}

/**
 * Track organization created during onboarding.
 */
export function trackOrganizationCreated(orgId: string, agencyName: string, role: string): void {
  trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, {
    funnel_step: "organization_created",
    step: 1,
    org_id: orgId,
    agency_name: agencyName,
    role,
  });
}

/**
 * Track tutorial completion.
 */
export function trackTutorialCompleted(skipped: boolean): void {
  trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, {
    funnel_step: "tutorial_completed",
    step: 3,
    skipped,
  });
}

/**
 * Track first property created.
 */
export function trackFirstPropertyCreated(propertyId: string): void {
  trackEvent(EVENT_TYPES.FIRST_PROPERTY_CREATED, {
    funnel_step: "first_property_created",
    step: 2,
    property_id: propertyId,
  });
}

/**
 * Track first capture started.
 */
export function trackFirstCaptureStarted(propertyId: string, sessionId: string): void {
  trackEvent(EVENT_TYPES.FIRST_CAPTURE_STARTED, {
    funnel_step: "first_capture_started",
    property_id: propertyId,
    session_id: sessionId,
  });
}

/**
 * Track onboarding completed (full activation).
 */
export function trackOnboardingCompleted(propertyCreated: boolean, skipped: boolean): void {
  trackEvent(EVENT_TYPES.ONBOARDING_COMPLETED, {
    funnel_step: "onboarding_completed",
    property_created: propertyCreated,
    skipped,
  });
}
