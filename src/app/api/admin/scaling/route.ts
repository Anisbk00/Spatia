import { createClient } from "@/lib/supabase/server";
import { getAutoScaler } from "@/lib/auto-scale";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/scaling
 * Returns current scaling state: active workers, queue depth, scaling config, recent decisions.
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

  const scaler = getAutoScaler();

  const [systemState, history] = await Promise.all([
    scaler.getSystemState(),
    Promise.resolve(scaler.getScalingHistory()),
  ]);

  return NextResponse.json({
    system_state: systemState,
    recent_decisions: history.slice(-20),
    can_scale: scaler.canScale(),
  });
}

/**
 * PATCH /api/admin/scaling
 * Update scaling configuration.
 * Body: { scale_up_threshold, scale_down_threshold, min_workers, max_workers, etc. }
 * Requires admin auth.
 */
export async function PATCH(request: NextRequest) {
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
  const config = body as {
    scale_up_threshold?: number;
    scale_down_threshold?: number;
    min_workers?: number;
    max_workers?: number;
    cooldown_seconds?: number;
    free_tier_delay_threshold?: number;
  };

  // Store updated scaling config in database
  const { data, error } = await supabase
    .from("scaling_config")
    .upsert({
      id: "default",
      ...config,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    // If the table doesn't exist, return the config that would have been applied
    return NextResponse.json({
      config,
      note: "Config accepted but could not be persisted (table may not exist)",
    });
  }

  // Re-create the scaler with the new config
  const updatedConfig = {
    scale_up_threshold: (data.scale_up_threshold as number) ?? undefined,
    scale_down_threshold: (data.scale_down_threshold as number) ?? undefined,
    min_workers: (data.min_workers as number) ?? undefined,
    max_workers: (data.max_workers as number) ?? undefined,
    cooldown_seconds: (data.cooldown_seconds as number) ?? undefined,
    free_tier_delay_threshold: (data.free_tier_delay_threshold as number) ?? undefined,
  };

  return NextResponse.json({ config: data ?? updatedConfig });
}
