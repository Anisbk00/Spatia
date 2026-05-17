import { createClient } from "@/lib/supabase/server";
import { getCostEngine } from "@/lib/cost-engine";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/costs
 * Returns org cost summary.
 * Query params: ?org_id=xxx&period=month
 */
export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("org_id");
  const period = searchParams.get("period") || "month";

  if (!orgId) {
    return NextResponse.json({ error: "org_id query parameter is required" }, { status: 400 });
  }

  const costEngine = getCostEngine();

  // Calculate period boundaries
  const now = new Date();
  let periodStart: string;
  if (period === "month") {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  } else if (period === "week") {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    periodStart = weekAgo.toISOString();
  } else {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  const [summary, throttleStatus, priorityScore, gpuUtilization, storageGrowth] =
    await Promise.all([
      costEngine.getOrgCostSummary(orgId, periodStart, now.toISOString()),
      costEngine.shouldThrottleOrg(orgId),
      costEngine.getOrgPriorityScore(orgId),
      costEngine.getGPUUtilization(),
      costEngine.getStorageGrowth(),
    ]);

  return NextResponse.json({
    org_id: orgId,
    period,
    period_start: periodStart,
    summary,
    throttle: throttleStatus,
    priority: priorityScore,
    gpu_utilization: gpuUtilization,
    storage_growth: storageGrowth,
  });
}
