import { createClient } from "@/lib/supabase/server";
import { getMonitoringSystem } from "@/lib/monitoring";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/monitoring
 * Returns system monitoring data. Requires admin auth.
 */
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (userProfile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const monitoring = getMonitoringSystem();

  const [systemData, gpuUsage, queueLatency, failureRates, processingTimes, storageGrowth] =
    await Promise.all([
      monitoring.getSystemMonitoring(),
      monitoring.getGPUUsageByRegion(),
      monitoring.getQueueLatency(),
      monitoring.getFailureRatePerWorker(),
      monitoring.getProcessingTimeDistribution(),
      monitoring.getStorageGrowthRate(),
    ]);

  return NextResponse.json({
    system: systemData,
    gpu_metrics: {
      usage_by_region: gpuUsage,
      failure_rates: failureRates,
    },
    queue: queueLatency,
    processing_times: processingTimes,
    storage: storageGrowth,
  });
}
