// ============================================
// Funnel Analytics Queries
// ============================================
// Functions for querying funnel data, retention,
// activation rates, and growth metrics.
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FunnelData, FunnelStep, RetentionData } from "@/lib/types";

// ============================================
// Funnel Metrics
// ============================================

/**
 * Get full funnel metrics for the product activation flow.
 *
 * Funnel steps:
 * 1. Signed Up — total users
 * 2. Onboarding Started
 * 3. First Property Created
 * 4. First Capture Started
 * 5. First Scene Generated
 * 6. First View Shared (fully activated)
 */
export async function getFunnelMetrics(
  supabase: SupabaseClient,
): Promise<FunnelData> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Step 1: Total users who signed up
  const { count: totalUsers } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  const total = totalUsers ?? 0;

  // Step 2: Users with ONBOARDING_STARTED event
  const { data: onboardingEvents } = await supabase
    .from("events")
    .select("user_id")
    .eq("event_type", "ONBOARDING_STARTED")
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  const onboardingStartedCount = new Set(
    (onboardingEvents || []).map((e) => e.user_id),
  ).size;

  // Step 3: Users with FIRST_PROPERTY_CREATED event
  const { data: propertyEvents } = await supabase
    .from("events")
    .select("user_id")
    .eq("event_type", "FIRST_PROPERTY_CREATED")
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  const propertyCreatedCount = new Set(
    (propertyEvents || []).map((e) => e.user_id),
  ).size;

  // Step 4: Users with FIRST_CAPTURE_STARTED event
  const { data: captureEvents } = await supabase
    .from("events")
    .select("user_id")
    .eq("event_type", "FIRST_CAPTURE_STARTED")
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  const captureStartedCount = new Set(
    (captureEvents || []).map((e) => e.user_id),
  ).size;

  // Step 5: Users with FIRST_SCENE_GENERATED event
  const { data: sceneEvents } = await supabase
    .from("events")
    .select("user_id")
    .eq("event_type", "FIRST_SCENE_GENERATED")
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  const sceneGeneratedCount = new Set(
    (sceneEvents || []).map((e) => e.user_id),
  ).size;

  // Step 6: Users with FIRST_VIEW_SHARED event
  const { data: shareEvents } = await supabase
    .from("events")
    .select("user_id")
    .eq("event_type", "FIRST_VIEW_SHARED")
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  const viewSharedCount = new Set(
    (shareEvents || []).map((e) => e.user_id),
  ).size;

  // Build funnel steps with conversion rates
  const steps: FunnelStep[] = [
    {
      step: "signed_up",
      label: "Signed Up",
      count: total,
      rate: 100,
    },
    {
      step: "onboarding_started",
      label: "Onboarding Started",
      count: onboardingStartedCount,
      rate: total > 0 ? Math.round((onboardingStartedCount / total) * 1000) / 10 : 0,
    },
    {
      step: "first_property_created",
      label: "First Property Created",
      count: propertyCreatedCount,
      rate:
        onboardingStartedCount > 0
          ? Math.round((propertyCreatedCount / onboardingStartedCount) * 1000) / 10
          : 0,
    },
    {
      step: "first_capture_started",
      label: "First Capture Started",
      count: captureStartedCount,
      rate:
        propertyCreatedCount > 0
          ? Math.round((captureStartedCount / propertyCreatedCount) * 1000) / 10
          : 0,
    },
    {
      step: "first_scene_generated",
      label: "First Scene Generated",
      count: sceneGeneratedCount,
      rate:
        captureStartedCount > 0
          ? Math.round((sceneGeneratedCount / captureStartedCount) * 1000) / 10
          : 0,
    },
    {
      step: "first_view_shared",
      label: "First View Shared",
      count: viewSharedCount,
      rate:
        sceneGeneratedCount > 0
          ? Math.round((viewSharedCount / sceneGeneratedCount) * 1000) / 10
          : 0,
    },
  ];

  // Calculate average time to activation
  const avgTime = await getAvgTimeToActivation(supabase);

  return {
    steps,
    totalUsers: total,
    activatedUsers: viewSharedCount,
    avgTimeToActivation: avgTime,
  };
}

// ============================================
// Retention Data
// ============================================

/**
 * Get retention data by signup cohort.
 *
 * Returns retention rates at D1, D7, D30 for each cohort.
 */
export async function getRetentionData(
  supabase: SupabaseClient,
  days: number,
): Promise<RetentionData[]> {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get all users who signed up within the time range
  const { data: users } = await supabase
    .from("users")
    .select("id, created_at")
    .gte("created_at", startDate.toISOString());

  if (!users || users.length === 0) return [];

  // Group users by signup date (cohort)
  const cohortMap = new Map<string, Set<string>>();
  for (const user of users) {
    const cohortDate = new Date(user.created_at).toISOString().split("T")[0];
    if (!cohortMap.has(cohortDate)) {
      cohortMap.set(cohortDate, new Set());
    }
    cohortMap.get(cohortDate)!.add(user.id);
  }

  // Get all active events (any event indicates user was active) within the range
  const userIds = users.map((u) => u.id);
  const { data: activeEvents } = await supabase
    .from("events")
    .select("user_id, created_at")
    .in("user_id", userIds)
    .gte("created_at", startDate.toISOString());

  // Build user activity map: user_id -> Set of dates they were active
  const userActivityMap = new Map<string, Set<string>>();
  if (activeEvents) {
    for (const event of activeEvents) {
      const date = new Date(event.created_at).toISOString().split("T")[0];
      if (!userActivityMap.has(event.user_id)) {
        userActivityMap.set(event.user_id, new Set());
      }
      userActivityMap.get(event.user_id)!.add(date);
    }
  }

  // Calculate retention for each cohort
  const retentionData: RetentionData[] = [];

  for (const [cohort, cohortUsers] of cohortMap.entries()) {
    const signupCount = cohortUsers.size;

    let d1 = 0;
    let d7 = 0;
    let d30 = 0;

    for (const userId of cohortUsers) {
      const signupDate = new Date(cohort);
      const activeDays = userActivityMap.get(userId) || new Set();

      // D1: active within 1 day of signup
      const d1Date = new Date(signupDate.getTime() + 1 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      if (activeDays.has(d1Date) || activeDays.has(cohort)) d1++;

      // D7: active within 7 days of signup
      for (let i = 1; i <= 7; i++) {
        const checkDate = new Date(signupDate.getTime() + i * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
        if (activeDays.has(checkDate)) {
          d7++;
          break;
        }
      }

      // D30: active within 30 days of signup
      for (let i = 1; i <= 30; i++) {
        const checkDate = new Date(signupDate.getTime() + i * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
        if (activeDays.has(checkDate)) {
          d30++;
          break;
        }
      }
    }

    retentionData.push({
      cohort,
      signupCount,
      d1: signupCount > 0 ? Math.round((d1 / signupCount) * 1000) / 10 : 0,
      d7: signupCount > 0 ? Math.round((d7 / signupCount) * 1000) / 10 : 0,
      d30: signupCount > 0 ? Math.round((d30 / signupCount) * 1000) / 10 : 0,
    });
  }

  // Sort by cohort date ascending
  retentionData.sort((a, b) => a.cohort.localeCompare(b.cohort));

  return retentionData;
}

// ============================================
// Activation Rate
// ============================================

/**
 * Get the overall activation rate.
 * Activation = user has created their first property.
 */
export async function getActivationRate(
  supabase: SupabaseClient,
): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { count: totalUsers } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  if (!totalUsers || totalUsers === 0) return 0;

  const { data: activatedEvents } = await supabase
    .from("events")
    .select("user_id")
    .eq("event_type", "FIRST_PROPERTY_CREATED")
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  const uniqueActivatedUsers = new Set(
    (activatedEvents || []).map((e) => e.user_id),
  ).size;

  return Math.round((uniqueActivatedUsers / totalUsers) * 1000) / 10;
}

// ============================================
// Average Time to Activation
// ============================================

/**
 * Get the average time (in hours) from signup to first property creation.
 */
export async function getAvgTimeToActivation(
  supabase: SupabaseClient,
): Promise<number | null> {
  // Get FIRST_PROPERTY_CREATED events with timestamps
  const { data: activationEvents } = await supabase
    .from("events")
    .select("user_id, created_at")
    .eq("event_type", "FIRST_PROPERTY_CREATED");

  if (!activationEvents || activationEvents.length === 0) return null;

  // Get user signup times for each activated user
  const activatedUserIds = activationEvents.map((e) => e.user_id);

  const { data: users } = await supabase
    .from("users")
    .select("id, created_at")
    .in("id", activatedUserIds);

  if (!users || users.length === 0) return null;

  // Build map of user signup times
  const userSignupMap = new Map<string, string>();
  for (const user of users) {
    userSignupMap.set(user.id, user.created_at);
  }

  // Calculate time differences
  const activationTimes: number[] = [];
  for (const event of activationEvents) {
    const signupAt = userSignupMap.get(event.user_id);
    if (signupAt) {
      const hoursDiff =
        (new Date(event.created_at).getTime() - new Date(signupAt).getTime()) /
        (1000 * 60 * 60);
      if (hoursDiff >= 0) {
        activationTimes.push(hoursDiff);
      }
    }
  }

  if (activationTimes.length === 0) return null;

  const avgHours =
    activationTimes.reduce((sum, t) => sum + t, 0) / activationTimes.length;

  return Math.round(avgHours * 10) / 10;
}

// ============================================
// Capture Completion Rate
// ============================================

/**
 * Get the capture completion rate.
 * Rate of capture sessions that go from started → completed.
 */
export async function getCaptureCompletionRate(
  supabase: SupabaseClient,
): Promise<number> {
  const { count: totalSessions } = await supabase
    .from("capture_sessions")
    .select("id", { count: "exact", head: true });

  if (!totalSessions || totalSessions === 0) return 0;

  const { count: completedSessions } = await supabase
    .from("capture_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "completed");

  return Math.round(((completedSessions ?? 0) / totalSessions) * 1000) / 10;
}

// ============================================
// Share Rate
// ============================================

/**
 * Get the share rate.
 * Percentage of properties that have been shared at least once.
 */
export async function getShareRate(
  supabase: SupabaseClient,
): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { count: totalProperties } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  if (!totalProperties || totalProperties === 0) return 0;

  const { data: shareEvents } = await supabase
    .from("events")
    .select("property_id")
    .eq("event_type", "PROPERTY_SHARED")
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  const sharedPropertyIds = new Set(
    (shareEvents || [])
      .map((e) => e.property_id)
      .filter((id): id is string => !!id),
  ).size;

  return Math.round((sharedPropertyIds / totalProperties) * 1000) / 10;
}

// ============================================
// Stuck Users
// ============================================

/**
 * Find users who signed up but never completed activation.
 * Returns users with no FIRST_PROPERTY_CREATED event within the given hours.
 */
export async function getStuckUsers(
  supabase: SupabaseClient,
  hoursSinceSignup: number,
): Promise<
  Array<{ user_id: string; email: string; signed_up_at: string }>
> {
  const cutoffDate = new Date(
    Date.now() - hoursSinceSignup * 60 * 60 * 1000,
  ).toISOString();

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Get all users who signed up before the cutoff
  const { data: users } = await supabase
    .from("users")
    .select("id, email, created_at")
    .lt("created_at", cutoffDate)
    .gte("created_at", ninetyDaysAgo)
    .limit(100_000);

  if (!users || users.length === 0) return [];

  const userIds = users.map((u) => u.id);

  // Find users with activation events
  const { data: activatedEvents } = await supabase
    .from("events")
    .select("user_id")
    .in("user_id", userIds)
    .eq("event_type", "FIRST_PROPERTY_CREATED");

  const activatedUserIds = new Set(
    (activatedEvents || []).map((e) => e.user_id),
  );

  // Filter to users without activation events
  return users
    .filter((u) => !activatedUserIds.has(u.id))
    .map((u) => ({
      user_id: u.id,
      email: u.email,
      signed_up_at: u.created_at,
    }));
}

// ============================================
// Signup Trend
// ============================================

/**
 * Get daily signup counts for the given number of days.
 */
export async function getSignupTrend(
  supabase: SupabaseClient,
  days: number,
): Promise<Array<{ date: string; count: number }>> {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { data: users } = await supabase
    .from("users")
    .select("created_at")
    .gte("created_at", startDate.toISOString());

  // Group by date
  const dateCountMap = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    dateCountMap.set(date, 0);
  }

  if (users) {
    for (const user of users) {
      const date = new Date(user.created_at).toISOString().split("T")[0];
      if (dateCountMap.has(date)) {
        dateCountMap.set(date, (dateCountMap.get(date) || 0) + 1);
      }
    }
  }

  // Convert to sorted array
  return Array.from(dateCountMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
