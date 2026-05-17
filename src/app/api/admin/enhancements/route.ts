import { createClient } from "@/lib/supabase/server";
import { getAIEnhancementPipeline } from "@/lib/ai-enhancement";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/enhancements
 * Returns enhancement jobs with filters.
 * Query params: ?status=queued&scene_id=xxx&limit=50
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
  const status = searchParams.get("status");
  const sceneId = searchParams.get("scene_id");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

  let query = supabase
    .from("ai_enhancements")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }
  if (sceneId) {
    query = query.eq("scene_id", sceneId);
  }

  const { data: enhancements, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: "Failed to fetch enhancements" }, { status: 500 });
  }

  return NextResponse.json({
    enhancements: enhancements || [],
    total: count || 0,
    limit,
  });
}

/**
 * POST /api/admin/enhancements
 * Queue a new enhancement job.
 * Body: { scene_id, org_id, enhancement_type }
 * Admin auth or org member for their own scenes.
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

  const isAdmin = userProfile?.role === "admin";

  const body = await request.json();
  const { scene_id, org_id, enhancement_type } = body as {
    scene_id?: string;
    org_id?: string;
    enhancement_type?: string;
  };

  if (!scene_id || !org_id || !enhancement_type) {
    return NextResponse.json(
      { error: "scene_id, org_id, and enhancement_type are required" },
      { status: 400 },
    );
  }

  // If not admin, check org membership
  if (!isAdmin) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("org_id", org_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden — not a member of this organization" }, { status: 403 });
    }
  }

  const pipeline = getAIEnhancementPipeline();
  const enhancementId = await pipeline.queueEnhancement({
    sceneId: scene_id,
    orgId: org_id,
    enhancementType: enhancement_type as "scene_cleanup" | "room_detection" | "object_removal" | "lighting_enhancement" | "auto_thumbnail" | "full_enhancement",
  });

  if (!enhancementId) {
    return NextResponse.json({ error: "Failed to queue enhancement" }, { status: 500 });
  }

  return NextResponse.json({ enhancement_id: enhancementId, status: "queued" }, { status: 201 });
}
