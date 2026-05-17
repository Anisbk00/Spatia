import { NextResponse } from "next/server";
import { getPropertyWithScene } from "@/lib/supabase/property";

/**
 * GET /api/properties/[property_id]/scene-status
 * Public endpoint for polling scene status (used by 3D viewer when scene is processing)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ property_id: string }> }
) {
  const { property_id } = await params;

  const data = await getPropertyWithScene(property_id);

  if (!data) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  return NextResponse.json({
    property_id: data.id,
    status: data.status,
    scene: data.scene
      ? {
          id: data.scene.id,
          status: data.scene.status,
          model_url: data.scene.model_url,
          thumbnail_url: data.scene.thumbnail_url,
          quality_score: data.scene.quality_score,
        }
      : null,
  });
}
