import { createClient } from "@/lib/supabase/server";
import { getAIEnhancementPipeline } from "@/lib/ai-enhancement";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ scene_id: string }> };

/**
 * POST /api/scenes/[scene_id]/enhance
 * Queue enhancement for a user's scene.
 * Body: { enhancement_type }
 * Requires org member auth. Checks org owns the scene.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { scene_id } = await context.params;

  const body = await request.json();
  const { enhancement_type } = body as { enhancement_type?: string };

  if (!enhancement_type) {
    return NextResponse.json({ error: "enhancement_type is required" }, { status: 400 });
  }

  const validTypes = [
    "scene_cleanup",
    "room_detection",
    "object_removal",
    "lighting_enhancement",
    "auto_thumbnail",
    "full_enhancement",
  ];

  if (!validTypes.includes(enhancement_type)) {
    return NextResponse.json(
      { error: `Invalid enhancement_type. Must be one of: ${validTypes.join(", ")}` },
      { status: 400 },
    );
  }

  // Look up scene and verify ownership via org membership
  const { data: scene, error: sceneError } = await supabase
    .from("scenes")
    .select("id, property_id, status")
    .eq("id", scene_id)
    .single();

  if (sceneError || !scene) {
    return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  }

  // Get the property's org_id
  const { data: property } = await supabase
    .from("properties")
    .select("org_id")
    .eq("id", scene.property_id)
    .single();

  if (!property?.org_id) {
    return NextResponse.json({ error: "Scene property has no associated organization" }, { status: 400 });
  }

  // Verify user is a member of the org
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", property.org_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden — not a member of this organization" }, { status: 403 });
  }

  const pipeline = getAIEnhancementPipeline();
  const enhancementId = await pipeline.queueEnhancement({
    sceneId: scene_id,
    orgId: property.org_id,
    enhancementType: enhancement_type as "scene_cleanup" | "room_detection" | "object_removal" | "lighting_enhancement" | "auto_thumbnail" | "full_enhancement",
  });

  if (!enhancementId) {
    return NextResponse.json({ error: "Failed to queue enhancement" }, { status: 500 });
  }

  return NextResponse.json(
    { enhancement_id: enhancementId, scene_id, enhancement_type, status: "queued" },
    { status: 201 },
  );
}
