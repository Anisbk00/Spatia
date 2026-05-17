import { createClient } from "@/lib/supabase/server";
import { WorkerRegistry } from "@/lib/distributed/worker-registry";
import { getMonitoringSystem } from "@/lib/monitoring";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ worker_id: string }> };

/**
 * GET /api/admin/workers/[worker_id]
 * Returns worker details + recent GPU metrics.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
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

  const { worker_id } = await context.params;

  const registry = new WorkerRegistry();
  const worker = await registry.getWorkerByWorkerId(worker_id);

  if (!worker) {
    return NextResponse.json({ error: "Worker not found" }, { status: 404 });
  }

  const monitoring = getMonitoringSystem();
  const gpuMetrics = await monitoring.getWorkerGPUMetrics(worker_id, 50);

  return NextResponse.json({ worker, gpu_metrics: gpuMetrics });
}

/**
 * PATCH /api/admin/workers/[worker_id]
 * Update worker status (e.g., set to 'draining').
 * Body: { status }
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
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

  const { worker_id } = await context.params;
  const body = await request.json();
  const { status } = body as { status?: string };

  if (!status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  const validStatuses = ["idle", "busy", "draining", "offline"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
      { status: 400 },
    );
  }

  const registry = new WorkerRegistry();

  const existing = await registry.getWorkerByWorkerId(worker_id);
  if (!existing) {
    return NextResponse.json({ error: "Worker not found" }, { status: 404 });
  }

  try {
    await registry.updateWorkerStatus(worker_id, status as "idle" | "busy" | "draining" | "offline");
    return NextResponse.json({ worker_id, status, updated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update worker status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/workers/[worker_id]
 * Deregister a worker.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
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

  const { worker_id } = await context.params;

  const registry = new WorkerRegistry();

  const existing = await registry.getWorkerByWorkerId(worker_id);
  if (!existing) {
    return NextResponse.json({ error: "Worker not found" }, { status: 404 });
  }

  try {
    await registry.deregisterWorker(worker_id);
    return NextResponse.json({ worker_id, deregistered: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to deregister worker";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
