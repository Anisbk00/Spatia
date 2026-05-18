// ============================================
// Throttling System for Free-Tier Users
// ============================================
// Implements free-tier usage limits, throttling delays,
// and smart queue prioritization for job scheduling.
// Gracefully handles missing Supabase configuration.
//
// IMPORTANT (fail-safe): When the system cannot determine
// whether a user has exceeded their limits (e.g., database
// query failure), it defaults to ALLOWING the request but
// tracks that verification failed. For critical paths that
// require definitive answers, callers should check the
// `verificationFailed` flag.
// ============================================

import { createAdminClient } from "@/lib/supabase/server";

// ============================================
// Free tier limits
// ============================================

export const FREE_TIER_LIMITS = {
  maxProperties: 3,
  max3DGenerations: 2,
  maxStorageMb: 500,
  maxViewSessions: 100,
};

// ============================================
// Throttle delay configuration
// ============================================

const THROTTLE_DELAYS = [
  { queueThreshold: 5, delayMs: 0 },
  { queueThreshold: 8, delayMs: 5000 },
  { queueThreshold: 12, delayMs: 10000 },
  { queueThreshold: 16, delayMs: 30000 },
  { queueThreshold: 20, delayMs: 60000 },
];

// ============================================
// Check if org has exceeded free tier limits
// ============================================

export async function checkFreeTierLimits(orgId: string): Promise<{
  exceeded: boolean;
  limits: Record<string, { current: number; max: number; exceeded: boolean }>;
  verificationFailed: boolean;
}> {
  const limits: Record<string, { current: number; max: number; exceeded: boolean }> = {
    maxProperties: { current: 0, max: FREE_TIER_LIMITS.maxProperties, exceeded: false },
    max3DGenerations: { current: 0, max: FREE_TIER_LIMITS.max3DGenerations, exceeded: false },
    maxStorageMb: { current: 0, max: FREE_TIER_LIMITS.maxStorageMb, exceeded: false },
    maxViewSessions: { current: 0, max: FREE_TIER_LIMITS.maxViewSessions, exceeded: false },
  };

  let verificationFailed = false;

  try {
    const supabase = createAdminClient();
    if (!supabase) {
      // Can't verify — return with verificationFailed flag
      return { exceeded: false, limits, verificationFailed: true };
    }

    // Check org plan first — only free tier gets limited
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("plan")
      .eq("id", orgId)
      .single();

    if (orgError || !org) {
      return { exceeded: false, limits, verificationFailed: true };
    }

    const plan = (org.plan ?? "free").toLowerCase();
    if (plan !== "free") {
      // Pro/Business have no free tier limits
      return { exceeded: false, limits, verificationFailed: false };
    }

    // Count properties
    const { count: propertyCount, error: propError } = await supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);

    if (propError) {
      console.error("[Throttle] Failed to count properties for org", orgId, ":", propError);
      verificationFailed = true;
    } else if (propertyCount !== null) {
      limits.maxProperties.current = propertyCount;
      limits.maxProperties.exceeded = propertyCount >= FREE_TIER_LIMITS.maxProperties;
    }

    // Count 3D generations (scenes that are ready)
    // First fetch property IDs, then query scenes — handle errors separately
    const { data: props, error: propsError } = await supabase
      .from("properties")
      .select("id")
      .eq("org_id", orgId);

    if (propsError || !props) {
      console.error("[Throttle] Failed to fetch properties for org", orgId, ":", propsError);
      verificationFailed = true;
    } else {
      const propIds = props.map((p: { id: string }) => p.id);
      if (propIds.length > 0) {
        const { count: sceneCount, error: sceneError } = await supabase
          .from("scenes")
          .select("id", { count: "exact", head: true })
          .eq("status", "ready")
          .in("property_id", propIds);

        if (sceneError) {
          console.error("[Throttle] Failed to count scenes for org", orgId, ":", sceneError);
          verificationFailed = true;
        } else if (sceneCount !== null) {
          limits.max3DGenerations.current = sceneCount;
          limits.max3DGenerations.exceeded = sceneCount >= FREE_TIER_LIMITS.max3DGenerations;
        }
      }
    }

    // Get storage usage from usage_metrics
    const { data: storageData, error: storageError } = await supabase
      .from("usage_metrics")
      .select("value")
      .eq("org_id", orgId)
      .eq("metric_type", "storage_used_mb")
      .order("created_at", { ascending: false })
      .limit(1);

    if (storageError) {
      console.error("[Throttle] Failed to get storage usage for org", orgId, ":", storageError);
      verificationFailed = true;
    } else if (storageData && storageData.length > 0) {
      const storageMb = Number(storageData[0].value) || 0;
      limits.maxStorageMb.current = storageMb;
      limits.maxStorageMb.exceeded = storageMb >= FREE_TIER_LIMITS.maxStorageMb;
    }

    // Count view sessions
    const { data: viewData, error: viewError } = await supabase
      .from("usage_metrics")
      .select("value")
      .eq("org_id", orgId)
      .eq("metric_type", "view_sessions")
      .order("created_at", { ascending: false })
      .limit(1);

    if (viewError) {
      console.error("[Throttle] Failed to get view sessions for org", orgId, ":", viewError);
      verificationFailed = true;
    } else if (viewData && viewData.length > 0) {
      const views = Number(viewData[0].value) || 0;
      limits.maxViewSessions.current = views;
      limits.maxViewSessions.exceeded = views >= FREE_TIER_LIMITS.maxViewSessions;
    }

    const exceeded = Object.values(limits).some((l) => l.exceeded);

    return { exceeded, limits, verificationFailed };
  } catch (err) {
    console.error("[Throttle] checkFreeTierLimits error:", err);
    // Fail-safe: when we can't determine limits at all, mark verification
    // as failed so callers can decide whether to allow or deny.
    return { exceeded: false, limits, verificationFailed: true };
  }
}

// ============================================
// Apply throttling delay to free tier jobs
// ============================================

export function calculateThrottleDelay(orgPlan: string, queueDepth: number): number {
  // Pro/Business get 0ms always
  const plan = (orgPlan ?? "free").toLowerCase();
  if (plan !== "free") {
    return 0;
  }

  // Free tier: 0ms when queue < 5, progressive delay after
  if (queueDepth < 5) {
    return 0;
  }

  // Find the appropriate delay based on queue depth
  let delay = 0;
  for (const tier of THROTTLE_DELAYS) {
    if (queueDepth >= tier.queueThreshold) {
      delay = tier.delayMs;
    }
  }

  // Beyond the highest defined threshold, scale linearly
  if (queueDepth > 20) {
    const extraDepth = queueDepth - 20;
    delay = 60000 + extraDepth * 5000; // 60s + 5s per additional job
  }

  return delay;
}

// ============================================
// Smart queue prioritization — sort jobs by priority
// ============================================

const PLAN_PRIORITY: Record<string, number> = {
  business: 3,
  pro: 2,
  free: 1,
};

export function prioritizeJobs<T extends { org_id?: string | null; plan?: string }>(
  jobs: T[],
  queueDepth: number,
): T[] {
  if (!jobs || jobs.length === 0) return jobs;

  // Create a sorted copy
  const sorted = [...jobs].sort((a, b) => {
    const planA = (a.plan ?? "free").toLowerCase();
    const planB = (b.plan ?? "free").toLowerCase();

    const priorityA = PLAN_PRIORITY[planA] ?? 1;
    const priorityB = PLAN_PRIORITY[planB] ?? 1;

    // Higher priority goes first
    if (priorityA !== priorityB) {
      return priorityB - priorityA;
    }

    // Within same tier, FIFO (maintain original order)
    return 0;
  });

  // If queue depth exceeds threshold, free tier jobs go to the back
  const THRESHOLD = 5;
  if (queueDepth > THRESHOLD) {
    const paid: T[] = [];
    const free: T[] = [];

    for (const job of sorted) {
      const plan = (job.plan ?? "free").toLowerCase();
      if (plan === "free") {
        free.push(job);
      } else {
        paid.push(job);
      }
    }

    return [...paid, ...free];
  }

  return sorted;
}
