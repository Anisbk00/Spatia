import { createClient } from "@/lib/supabase/server";
import { getCostEngine } from "@/lib/cost-engine";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/costs/configs
 * Returns all cost configurations.
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

  const costEngine = getCostEngine();
  const configs = await costEngine.getCostConfigs();

  return NextResponse.json({ configs });
}

/**
 * PATCH /api/admin/costs/configs
 * Update cost configuration.
 * Body: { cost_type, unit_cost_usd, free_multiplier, pro_multiplier, business_multiplier }
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
  const { cost_type, unit_cost_usd, free_multiplier, pro_multiplier, business_multiplier } =
    body as {
      cost_type?: string;
      unit_cost_usd?: number;
      free_multiplier?: number;
      pro_multiplier?: number;
      business_multiplier?: number;
    };

  if (!cost_type) {
    return NextResponse.json({ error: "cost_type is required" }, { status: 400 });
  }

  // Build update object from provided fields
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (unit_cost_usd !== undefined) updates.unit_cost_usd = unit_cost_usd;
  if (free_multiplier !== undefined) updates.free_multiplier = free_multiplier;
  if (pro_multiplier !== undefined) updates.pro_multiplier = pro_multiplier;
  if (business_multiplier !== undefined) updates.business_multiplier = business_multiplier;

  // Upsert the cost configuration
  const { data, error } = await supabase
    .from("processing_cost_configs")
    .upsert(
      {
        cost_type,
        ...updates,
        is_active: true,
      },
      { onConflict: "cost_type" },
    )
    .select("*")
    .single();

  if (error) {
    // If the table doesn't exist, return a graceful message
    return NextResponse.json(
      { error: "Failed to update cost config", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ config: data });
}
