import { createClient } from "@/lib/supabase/server";
import { WorkerRegistry } from "@/lib/distributed/worker-registry";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/workers
 * Returns list of all workers with status, region, current jobs.
 * Supports query params: ?status=idle&region=us-east
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
  const statusFilter = searchParams.get("status");
  const regionFilter = searchParams.get("region");

  const registry = new WorkerRegistry();
  const workers = await registry.getAllWorkers();

  const filtered = workers.filter((w) => {
    if (statusFilter && w.status !== statusFilter) return false;
    if (regionFilter && w.region !== regionFilter) return false;
    return true;
  });

  return NextResponse.json({ workers: filtered, total: filtered.length });
}

/**
 * POST /api/admin/workers
 * Register a new worker.
 * Body: { worker_id, name, region, gpu_type, max_concurrent_jobs }
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
  const { worker_id, name, region, gpu_type, max_concurrent_jobs } = body as {
    worker_id?: string;
    name?: string;
    region?: string;
    gpu_type?: string;
    max_concurrent_jobs?: number;
  };

  if (!worker_id) {
    return NextResponse.json({ error: "worker_id is required" }, { status: 400 });
  }

  const registry = new WorkerRegistry();

  try {
    const worker = await registry.registerWorker({
      worker_id,
      name,
      region,
      gpu_type,
      max_concurrent_jobs,
    });

    return NextResponse.json({ worker }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register worker";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
