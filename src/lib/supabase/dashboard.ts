import { createClient, createAdminClient } from "@/lib/supabase/server";
import type {
  Property,
  CaptureSession,
  Scene,
  Media,
  ProcessingJob,
  PropertyViewsRow,
  Organization,
  OrganizationMember,
  User,
  Plan,
  Subscription,
  UsageMetric,
  Payment,
  Invoice,
} from "@/lib/types";

// Supabase join result types
interface PropertyJoinResult {
  title: string;
}

/**
 * Get a Supabase client for read operations.
 * Prefers admin client (bypasses RLS) to ensure dashboard reads always succeed,
 * falls back to user-context client if admin is unavailable.
 */
async function getReadClient() {
  const adminClient = createAdminClient();
  if (adminClient) return adminClient;

  const userClient = await createClient();
  return userClient;
}

// ============================================
// Dashboard KPI queries
// ============================================

export async function getDashboardKPIs(orgId: string) {
  const supabase = await getReadClient();
  if (!supabase) {
    return {
      totalProperties: 0,
      activeScenes: 0,
      monthlyViews: 0,
      storageUsedMB: 0,
      scenesGeneratedThisMonth: 0,
    };
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Step 1: Get property IDs (must be first since other queries depend on them)
  const { data: orgProperties } = await supabase
    .from("properties")
    .select("id")
    .eq("org_id", orgId);

  const propertyIds = orgProperties?.map((p) => p.id) || [];

  if (propertyIds.length === 0) {
    return {
      totalProperties: 0,
      activeScenes: 0,
      monthlyViews: 0,
      storageUsedMB: 0,
      scenesGeneratedThisMonth: 0,
    };
  }

  // Step 2: Run all dependent queries in parallel
  const [propertiesRes, scenesRes, viewsRes, storageRes, scenesMonthRes] =
    await Promise.all([
      supabase
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
      supabase
        .from("scenes")
        .select("id", { count: "exact", head: true })
        .eq("status", "ready")
        .in("property_id", propertyIds),
      supabase
        .from("property_views")
        .select("id", { count: "exact", head: true })
        .in("property_id", propertyIds)
        .gte("viewed_at", startOfMonth),
      supabase
        .from("usage_metrics")
        .select("value")
        .eq("org_id", orgId)
        .eq("metric_type", "storage_used_mb")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("scenes")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfMonth)
        .in("property_id", propertyIds),
    ]);

  return {
    totalProperties: propertiesRes.count ?? 0,
    activeScenes: scenesRes.count ?? 0,
    monthlyViews: viewsRes.count ?? 0,
    storageUsedMB: storageRes.data?.[0]?.value ?? 0,
    scenesGeneratedThisMonth: scenesMonthRes.count ?? 0,
  };
}

// ============================================
// Recent activity feed
// ============================================

export type ActivityItem = {
  id: string;
  type: "property_created" | "capture_completed" | "scene_ready" | "scene_failed";
  title: string;
  description: string;
  timestamp: string;
  propertyId?: string;
};

export async function getRecentActivity(
  orgId: string,
  limit = 10
): Promise<ActivityItem[]> {
  const supabase = await getReadClient();
  if (!supabase) return [];

  // Get recent properties
  const { data: properties } = await supabase
    .from("properties")
    .select("id, title, status, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Get recent scenes
  const { data: scenes } = await supabase
    .from("scenes")
    .select("id, status, created_at, completed_at, property_id, properties(title)")
    .in(
      "property_id",
      properties?.map((p) => p.id) || []
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  // Get recent capture sessions
  const { data: sessions } = await supabase
    .from("capture_sessions")
    .select("id, status, completed_at, property_id, properties(title)")
    .in(
      "property_id",
      properties?.map((p) => p.id) || []
    )
    .order("started_at", { ascending: false })
    .limit(limit);

  const activities: ActivityItem[] = [];

  // Add property creation events
  for (const prop of properties || []) {
    activities.push({
      id: `prop-${prop.id}`,
      type: "property_created",
      title: "Property created",
      description: prop.title,
      timestamp: prop.created_at,
      propertyId: prop.id,
    });
  }

  // Add capture completed events
  for (const session of sessions || []) {
    if (session.status === "completed" && session.completed_at) {
      activities.push({
        id: `capture-${session.id}`,
        type: "capture_completed",
        title: "Capture completed",
        description: (session.properties as unknown as PropertyJoinResult)?.title || "Unknown property",
        timestamp: session.completed_at,
        propertyId: session.property_id,
      });
    }
  }

  // Add scene events
  for (const scene of scenes || []) {
    if (scene.status === "ready" && scene.completed_at) {
      activities.push({
        id: `scene-${scene.id}`,
        type: "scene_ready",
        title: "3D scene ready",
        description: (scene.properties as unknown as PropertyJoinResult)?.title || "Unknown property",
        timestamp: scene.completed_at,
        propertyId: scene.property_id,
      });
    } else if (scene.status === "failed") {
      activities.push({
        id: `scene-fail-${scene.id}`,
        type: "scene_failed",
        title: "Scene processing failed",
        description: (scene.properties as unknown as PropertyJoinResult)?.title || "Unknown property",
        timestamp: scene.created_at,
        propertyId: scene.property_id,
      });
    }
  }

  // Sort by timestamp descending and limit
  return activities
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

// ============================================
// Processing queue
// ============================================

export type ProcessingQueueStatus = {
  queued: number;
  running: number;
  failed: number;
  total: number;
  jobs: ProcessingJob[];
};

export async function getProcessingQueue(orgId: string): Promise<ProcessingQueueStatus> {
  const supabase = await getReadClient();
  const empty: ProcessingQueueStatus = { queued: 0, running: 0, failed: 0, total: 0, jobs: [] };
  if (!supabase) return empty;

  // Get property IDs for the org
  const { data: orgProperties } = await supabase
    .from("properties")
    .select("id")
    .eq("org_id", orgId);

  const propertyIds = orgProperties?.map((p) => p.id) || [];
  if (propertyIds.length === 0) return empty;

  // Get scene IDs for those properties
  const { data: orgScenes } = await supabase
    .from("scenes")
    .select("id")
    .in("property_id", propertyIds);

  const sceneIds = orgScenes?.map((s) => s.id) || [];
  if (sceneIds.length === 0) return empty;

  // Get processing jobs for those scenes
  const { data: jobs } = await supabase
    .from("processing_jobs")
    .select("*")
    .in("scene_id", sceneIds)
    .order("started_at", { ascending: false })
    .limit(20);

  const allJobs = (jobs || []) as ProcessingJob[];

  return {
    queued: allJobs.filter((j) => j.status === "queued").length,
    running: allJobs.filter((j) => j.status === "running").length,
    failed: allJobs.filter((j) => j.status === "failed").length,
    total: allJobs.length,
    jobs: allJobs,
  };
}

// ============================================
// Properties for dashboard
// ============================================

export type PropertyRow = Property & {
  scene_status: string | null;
  view_count: number;
};

/**
 * Get properties for an organization. Falls back to querying by user ID
 * if no orgId is provided (for buyers without an org).
 */
export async function getOrgProperties(
  orgId: string | null,
  options?: {
    status?: string;
    propertyType?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    userId?: string; // fallback for users without an org
  }
): Promise<{ properties: PropertyRow[]; total: number }> {
  try {
    const supabase = await getReadClient();
    if (!supabase) return { properties: [], total: 0 };

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("properties")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(from, to);

    // Filter by org_id or created_by depending on what's available
    if (orgId) {
      query = query.eq("org_id", orgId);
    } else if (options?.userId) {
      query = query.eq("created_by", options.userId);
    } else {
      return { properties: [], total: 0 };
    }

    if (options?.status) {
      query = query.eq("status", options.status);
    }
    if (options?.propertyType) {
      query = query.eq("property_type", options.propertyType);
    }
    if (options?.search) {
      const searchPattern = `%${options.search.replace(/[%_]/g, '\\$&')}%`;
      query = query.or(`title.ilike.${searchPattern},address.ilike.${searchPattern}`);
    }

    const { data: properties, count, error: propertiesError } = await query;

    if (propertiesError) {
      console.error("[getOrgProperties] Query error:", propertiesError.message);
      return { properties: [], total: 0 };
    }

    if (!properties || properties.length === 0) {
      return { properties: [], total: count ?? 0 };
    }

    // Get scene status for each property
    const propertyIds = properties.map((p) => p.id);

    const [scenesRes, viewCountsRes] = await Promise.all([
      supabase
        .from("scenes")
        .select("property_id, status")
        .in("property_id", propertyIds),
      supabase
        .from("property_views")
        .select("property_id")
        .in("property_id", propertyIds),
    ]);

    if (scenesRes.error) {
      console.error("[getOrgProperties] Scenes query error:", scenesRes.error.message);
    }
    if (viewCountsRes.error) {
      console.error("[getOrgProperties] Views query error:", viewCountsRes.error.message);
    }

    const sceneMap = new Map<string, string>();
    for (const scene of scenesRes.data || []) {
      if (!sceneMap.has(scene.property_id)) {
        sceneMap.set(scene.property_id, scene.status);
      }
    }

    const viewCountMap = new Map<string, number>();
    for (const view of viewCountsRes.data || []) {
      const current = viewCountMap.get(view.property_id) ?? 0;
      viewCountMap.set(view.property_id, current + 1);
    }

    const rows: PropertyRow[] = properties.map((p) => ({
      ...p,
      scene_status: sceneMap.get(p.id) ?? null,
      view_count: viewCountMap.get(p.id) ?? 0,
    }));

    return { properties: rows, total: count ?? 0 };
  } catch (err) {
    console.error("[getOrgProperties] Unexpected error:", err);
    return { properties: [], total: 0 };
  }
}

// ============================================
// Property detail data
// ============================================

export type PropertyDetail = Property & {
  scenes: Scene[];
  capture_sessions: CaptureSession[];
  media: Media[];
  view_count: number;
};

export async function getPropertyDetail(propertyId: string, orgId: string | null, userId?: string): Promise<PropertyDetail | null> {
  try {
    const supabase = await getReadClient();
    if (!supabase) return null;

    // Build query — filter by org_id if available, otherwise by created_by
    let query = supabase
      .from("properties")
      .select("*")
      .eq("id", propertyId);

    if (orgId) {
      query = query.eq("org_id", orgId);
    } else if (userId) {
      query = query.eq("created_by", userId);
    }

    const { data: property, error: propertyError } = await query.single();

    if (propertyError || !property) return null;

    // Fetch related data in parallel with individual error handling
    const [scenesRes, sessionsRes, mediaRes, viewsRes] = await Promise.all([
      supabase.from("scenes").select("*").eq("property_id", propertyId).order("created_at", { ascending: false }),
      supabase.from("capture_sessions").select("*").eq("property_id", propertyId).order("started_at", { ascending: false }),
      supabase.from("media").select("*").eq("property_id", propertyId).eq("type", "image").order("order_index", { ascending: true }),
      supabase.from("property_views").select("id", { count: "exact", head: true }).eq("property_id", propertyId),
    ]);

    // Log non-critical query errors but don't crash the page
    if (scenesRes.error) {
      console.error("[getPropertyDetail] Scenes query error:", scenesRes.error.message);
    }
    if (sessionsRes.error) {
      console.error("[getPropertyDetail] Sessions query error:", sessionsRes.error.message);
    }
    if (mediaRes.error) {
      console.error("[getPropertyDetail] Media query error:", mediaRes.error.message);
    }
    if (viewsRes.error) {
      console.error("[getPropertyDetail] Views query error:", viewsRes.error.message);
    }

    return {
      ...property,
      scenes: (scenesRes.data || []) as Scene[],
      capture_sessions: (sessionsRes.data || []) as CaptureSession[],
      media: (mediaRes.data || []) as Media[],
      view_count: viewsRes.count ?? 0,
    };
  } catch (err) {
    console.error("[getPropertyDetail] Unexpected error:", err);
    return null;
  }
}

// ============================================
// Capture sessions for dashboard
// ============================================

export type CaptureSessionRow = CaptureSession & {
  property_title: string;
  property_status: string;
};

export async function getOrgCaptureSessions(
  orgId: string,
  options?: {
    status?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<{ sessions: CaptureSessionRow[]; total: number }> {
  const supabase = await getReadClient();
  if (!supabase) return { sessions: [], total: 0 };

  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Get property IDs for the org
  const { data: orgProperties } = await supabase
    .from("properties")
    .select("id, title, status")
    .eq("org_id", orgId);

  const propertyMap = new Map(orgProperties?.map((p) => [p.id, p]) || []);
  const propertyIds = Array.from(propertyMap.keys());

  if (propertyIds.length === 0) return { sessions: [], total: 0 };

  let query = supabase
    .from("capture_sessions")
    .select("*", { count: "exact" })
    .in("property_id", propertyIds)
    .order("started_at", { ascending: false })
    .range(from, to);

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data: sessions, count } = await query;

  const rows: CaptureSessionRow[] = (sessions || []).map((s) => ({
    ...s,
    property_title: propertyMap.get(s.property_id)?.title ?? "Unknown",
    property_status: propertyMap.get(s.property_id)?.status ?? "unknown",
  }));

  return { sessions: rows, total: count ?? 0 };
}

// ============================================
// User's organization
// ============================================

export async function getUserOrganization(userId: string): Promise<{
  organization: Organization | null;
  membership: OrganizationMember | null;
  members: (OrganizationMember & { user: User })[];
}> {
  try {
    // Use admin client to bypass RLS on organization_members
    const supabase = createAdminClient() || await createClient();

    if (!supabase) {
      return { organization: null, membership: null, members: [] };
    }

    const { data: memberships, error: membershipsError } = await supabase
      .from("organization_members")
      .select("*, organizations(*)")
      .eq("user_id", userId)
      .limit(1);

    if (membershipsError) {
      console.error("[getUserOrganization] Memberships query error:", membershipsError.message);
      return { organization: null, membership: null, members: [] };
    }

    const membership = memberships?.[0] as OrganizationMember & { organizations: Organization } | undefined;
    const organization = membership?.organizations ?? null;

    if (!organization) {
      return { organization: null, membership: null, members: [] };
    }

    const { data: members, error: membersError } = await supabase
      .from("organization_members")
      .select("*, users(*)")
      .eq("org_id", organization.id);

    if (membersError) {
      console.error("[getUserOrganization] Members query error:", membersError.message);
    }

    return {
      organization,
      membership: membership as OrganizationMember,
      members: (members || []) as (OrganizationMember & { user: User })[],
    };
  } catch (err) {
    console.error("[getUserOrganization] Unexpected error:", err);
    return { organization: null, membership: null, members: [] };
  }
}

// ============================================
// Analytics
// ============================================

export type AnalyticsData = {
  totalViews: number;
  viewsOverTime: { date: string; views: number }[];
  topProperties: { id: string; title: string; views: number }[];
  deviceBreakdown: { device: string; count: number }[];
  countryBreakdown: { country: string; count: number }[];
  scenesGenerated: number;
  storageGrowth: { date: string; mb: number }[];
};

export async function getAnalytics(orgId: string): Promise<AnalyticsData> {
  const supabase = await getReadClient();
  const empty: AnalyticsData = {
    totalViews: 0,
    viewsOverTime: [],
    topProperties: [],
    deviceBreakdown: [],
    countryBreakdown: [],
    scenesGenerated: 0,
    storageGrowth: [],
  };

  if (!supabase) return empty;

  // Get org property IDs
  const { data: orgProperties } = await supabase
    .from("properties")
    .select("id, title")
    .eq("org_id", orgId);

  const propertyIds = orgProperties?.map((p) => p.id) || [];
  if (propertyIds.length === 0) return empty;

  // Total views
  const { count: totalViews } = await supabase
    .from("property_views")
    .select("id", { count: "exact", head: true })
    .in("property_id", propertyIds);

  // Views over time (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: viewsData } = await supabase
    .from("property_views")
    .select("viewed_at, property_id")
    .in("property_id", propertyIds)
    .gte("viewed_at", thirtyDaysAgo.toISOString())
    .order("viewed_at", { ascending: true });

  // Group views by date
  const viewsByDate = new Map<string, number>();
  for (const view of viewsData || []) {
    const date = new Date(view.viewed_at).toISOString().split("T")[0];
    viewsByDate.set(date, (viewsByDate.get(date) ?? 0) + 1);
  }

  const viewsOverTime = Array.from(viewsByDate.entries())
    .map(([date, views]) => ({ date, views }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top properties by views
  const viewsByProperty = new Map<string, number>();
  for (const view of viewsData || []) {
    viewsByProperty.set(view.property_id, (viewsByProperty.get(view.property_id) ?? 0) + 1);
  }

  const propertyTitleMap = new Map(orgProperties?.map((p) => [p.id, p.title]) || []);
  const topProperties = Array.from(viewsByProperty.entries())
    .map(([id, views]) => ({ id, title: propertyTitleMap.get(id) ?? "Unknown", views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  // Device breakdown
  const { data: deviceData } = await supabase
    .from("property_views")
    .select("device_type")
    .in("property_id", propertyIds);

  const deviceMap = new Map<string, number>();
  for (const view of deviceData || []) {
    const device = view.device_type || "unknown";
    deviceMap.set(device, (deviceMap.get(device) ?? 0) + 1);
  }

  const deviceBreakdown = Array.from(deviceMap.entries()).map(([device, count]) => ({
    device,
    count,
  }));

  // Country breakdown
  const { data: countryData } = await supabase
    .from("property_views")
    .select("country")
    .in("property_id", propertyIds);

  const countryMap = new Map<string, number>();
  for (const view of countryData || []) {
    const country = view.country || "unknown";
    countryMap.set(country, (countryMap.get(country) ?? 0) + 1);
  }

  const countryBreakdown = Array.from(countryMap.entries()).map(([country, count]) => ({
    country,
    count,
  }));

  // Scenes generated this month
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { count: scenesGenerated } = await supabase
    .from("scenes")
    .select("id", { count: "exact", head: true })
    .in("property_id", propertyIds)
    .gte("created_at", startOfMonth);

  // Storage growth (last 30 days)
  const { data: storageData } = await supabase
    .from("usage_metrics")
    .select("value, created_at")
    .eq("org_id", orgId)
    .eq("metric_type", "storage_used_mb")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .order("created_at", { ascending: true });

  const storageGrowth = (storageData || []).map((s) => ({
    date: new Date(s.created_at).toISOString().split("T")[0],
    mb: s.value,
  }));

  return {
    totalViews: totalViews ?? 0,
    viewsOverTime,
    topProperties,
    deviceBreakdown,
    countryBreakdown,
    scenesGenerated: scenesGenerated ?? 0,
    storageGrowth,
  };
}

// ============================================
// Billing data
// ============================================

export type BillingData = {
  subscription: Subscription | null;
  plan: Plan | null;
  usage: UsageMetric[];
  payments: Payment[];
  invoices: Invoice[];
};

export async function getBillingData(orgId: string): Promise<BillingData> {
  const supabase = await getReadClient();
  const empty: BillingData = {
    subscription: null,
    plan: null,
    usage: [],
    payments: [],
    invoices: [],
  };

  if (!supabase) return empty;

  // Get subscription
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Get plan
  let plan = null;
  if (subscription?.plan_id) {
    const { data: planData } = await supabase
      .from("plans")
      .select("*")
      .eq("id", subscription.plan_id)
      .single();
    plan = planData;
  } else {
    // Default to free plan
    const { data: freePlan } = await supabase
      .from("plans")
      .select("*")
      .eq("name", "free")
      .single();
    plan = freePlan;
  }

  // Get usage metrics
  const { data: usage } = await supabase
    .from("usage_metrics")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  // Get payments
  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  // Get invoices
  const { data: invoices } = await supabase
    .from("invoices")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return {
    subscription: subscription as Subscription | null,
    plan: plan as Plan | null,
    usage: (usage || []) as UsageMetric[],
    payments: (payments || []) as Payment[],
    invoices: (invoices || []) as Invoice[],
  };
}

// ============================================
// Current usage vs limits
// ============================================

export type UsageLimits = {
  properties: { used: number; limit: number | null };
  storage: { usedMB: number; limitMB: number | null };
  generations: { used: number; limit: number | null };
};

export async function getUsageLimits(orgId: string): Promise<UsageLimits> {
  const supabase = await getReadClient();
  const defaults: UsageLimits = {
    properties: { used: 0, limit: 3 },
    storage: { usedMB: 0, limitMB: 500 },
    generations: { used: 0, limit: 2 },
  };

  if (!supabase) return defaults;

  // Get current plan limits
  const billing = await getBillingData(orgId);
  const plan = billing.plan;

  // Get actual usage
  const { count: propertyCount } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  const { data: storageMetric } = await supabase
    .from("usage_metrics")
    .select("value")
    .eq("org_id", orgId)
    .eq("metric_type", "storage_used_mb")
    .order("created_at", { ascending: false })
    .limit(1);

  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data: genMetrics } = await supabase
    .from("usage_metrics")
    .select("value")
    .eq("org_id", orgId)
    .eq("metric_type", "3d_scenes_generated")
    .gte("created_at", startOfMonth);

  const generationsUsed = genMetrics?.reduce((sum, m) => sum + (m.value || 0), 0) ?? 0;

  return {
    properties: {
      used: propertyCount ?? 0,
      limit: plan?.max_properties ?? null,
    },
    storage: {
      usedMB: storageMetric?.[0]?.value ?? 0,
      limitMB: plan?.max_storage_mb ?? null,
    },
    generations: {
      used: generationsUsed,
      limit: plan?.max_3d_generations ?? null,
    },
  };
}
