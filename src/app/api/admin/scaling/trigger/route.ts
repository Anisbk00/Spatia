import { createClient } from "@/lib/supabase/server";
import { getAutoScaler } from "@/lib/auto-scale";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/scaling/trigger
 * Manually trigger a scaling evaluation.
 * Body: { action: "evaluate" | "scale_up" | "scale_down", target_count?: number }
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
  const { action, target_count } = body as {
    action?: string;
    target_count?: number;
  };

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const validActions = ["evaluate", "scale_up", "scale_down"];
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
      { status: 400 },
    );
  }

  const scaler = getAutoScaler();

  if (action === "evaluate") {
    const decision = await scaler.evaluate();
    return NextResponse.json({ decision });
  }

  if (action === "scale_up") {
    const count = target_count || (await scaler.getSystemState()).activeWorkers + 1;
    const result = await scaler.scaleUp(count);
    return NextResponse.json({ result });
  }

  if (action === "scale_down") {
    const count = target_count || Math.max((await scaler.getSystemState()).activeWorkers - 1, 1);
    const result = await scaler.scaleDown(count);
    return NextResponse.json({ result });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
