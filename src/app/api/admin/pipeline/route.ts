import { createClient } from "@/lib/supabase/server";
import { getDataPipelineOptimizer } from "@/lib/data-pipeline";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/pipeline
 * Returns pipeline efficiency metrics.
 * Requires admin auth.
 */
export async function GET() {
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

  const pipeline = getDataPipelineOptimizer();
  const efficiency = await pipeline.getPipelineEfficiency();

  return NextResponse.json({ efficiency });
}

/**
 * POST /api/admin/pipeline
 * Trigger pipeline optimization.
 * Body: { action: "cleanup_cache" | "optimize_batch", job_ids?: string[] }
 * Requires admin auth.
 */
export async function POST(request: NextRequest) {
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

  const body = await request.json();
  const { action, job_ids } = body as {
    action?: string;
    job_ids?: string[];
  };

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const validActions = ["cleanup_cache", "optimize_batch"];
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
      { status: 400 },
    );
  }

  const pipeline = getDataPipelineOptimizer();

  if (action === "cleanup_cache") {
    const cleanedCount = await pipeline.cleanupExpiredCache();
    return NextResponse.json({ action: "cleanup_cache", entries_removed: cleanedCount });
  }

  if (action === "optimize_batch") {
    if (!job_ids || !Array.isArray(job_ids) || job_ids.length === 0) {
      return NextResponse.json(
        { error: "job_ids array is required for optimize_batch action" },
        { status: 400 },
      );
    }

    const reorderedIds = await pipeline.optimizeBatchOrder(job_ids);
    return NextResponse.json({
      action: "optimize_batch",
      original_order: job_ids,
      optimized_order: reorderedIds,
      changed: JSON.stringify(job_ids) !== JSON.stringify(reorderedIds),
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
