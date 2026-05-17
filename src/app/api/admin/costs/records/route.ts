import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/costs/records
 * Returns cost records with pagination.
 * Query params: ?org_id=xxx&cost_type=gpu_compute&limit=50&offset=0
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
  const costType = searchParams.get("cost_type");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  if (!orgId) {
    return NextResponse.json({ error: "org_id query parameter is required" }, { status: 400 });
  }

  let query = supabase
    .from("cost_records")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .order("recorded_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (costType) {
    query = query.eq("cost_type", costType);
  }

  const { data: records, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: "Failed to fetch cost records" }, { status: 500 });
  }

  return NextResponse.json({
    records: records || [],
    total: count || 0,
    limit,
    offset,
  });
}
