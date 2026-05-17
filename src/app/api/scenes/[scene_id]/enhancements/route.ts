import { createClient } from "@/lib/supabase/server";
import { getAIEnhancementPipeline } from "@/lib/ai-enhancement";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ scene_id: string }> };

/**
 * GET /api/scenes/[scene_id]/enhancements
 * Returns enhancement results for a scene.
 * Requires org member auth or public (for completed enhancements on ready scenes).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  const { scene_id } = await context.params;

  // Check if scene exists and its status
  const { data: scene } = await supabase
    .from("scenes")
    .select("id, property_id, status")
    .eq("id", scene_id)
    .single();

  if (!scene) {
    return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  }

  // Check user auth
  const { data: { user } } = await supabase.auth.getUser();

  let isOrgMember = false;

  if (user) {
    // Get property's org
    const { data: property } = await supabase
      .from("properties")
      .select("org_id")
      .eq("id", scene.property_id)
      .single();

    if (property?.org_id) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("id")
        .eq("org_id", property.org_id)
        .eq("user_id", user.id)
        .single();

      isOrgMember = !!membership;
    }
  }

  // If scene is ready, allow public access to completed enhancements
  // Otherwise, require org membership
  const pipeline = getAIEnhancementPipeline();
  const allEnhancements = await pipeline.getSceneEnhancements(scene_id);

  if (scene.status === "ready") {
    // Public: return only completed enhancements
    if (!isOrgMember) {
      const completed = allEnhancements.filter((e) => e.status === "completed");
      return NextResponse.json({ enhancements: completed });
    }
  } else {
    // Non-ready scenes require org membership
    if (!isOrgMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({ enhancements: allEnhancements });
}
