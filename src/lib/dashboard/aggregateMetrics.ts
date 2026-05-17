"use client";

import { createClient } from "@/lib/supabase/client";

export interface DashboardMetrics {
  totalProperties: number;
  activeScenes: number;
  monthlyViews: number;
  storageUsedMB: number;
  scenesGeneratedThisMonth: number;
  processingJobs: {
    queued: number;
    running: number;
    failed: number;
  };
}

/**
 * Client-side dashboard metrics fetcher.
 * Used for realtime updates without full page reload.
 */
export async function fetchDashboardMetrics(
  orgId: string,
): Promise<DashboardMetrics | null> {
  const supabase = createClient();
  if (!supabase) return null;

  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  ).toISOString();

  // Get org property IDs
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
      processingJobs: { queued: 0, running: 0, failed: 0 },
    };
  }

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

  // Get processing jobs counts
  const { data: orgScenes } = await supabase
    .from("scenes")
    .select("id")
    .in("property_id", propertyIds);

  const sceneIds = orgScenes?.map((s) => s.id) || [];

  let processingJobs = { queued: 0, running: 0, failed: 0 };
  if (sceneIds.length > 0) {
    const { data: jobs } = await supabase
      .from("processing_jobs")
      .select("status")
      .in("scene_id", sceneIds);

    processingJobs = {
      queued: jobs?.filter((j) => j.status === "queued").length ?? 0,
      running: jobs?.filter((j) => j.status === "running").length ?? 0,
      failed: jobs?.filter((j) => j.status === "failed").length ?? 0,
    };
  }

  return {
    totalProperties: propertiesRes.count ?? 0,
    activeScenes: scenesRes.count ?? 0,
    monthlyViews: viewsRes.count ?? 0,
    storageUsedMB: storageRes.data?.[0]?.value ?? 0,
    scenesGeneratedThisMonth: scenesMonthRes.count ?? 0,
    processingJobs,
  };
}
