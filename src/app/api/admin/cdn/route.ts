import { createClient } from "@/lib/supabase/server";
import { getCDNManager } from "@/lib/cdn";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/cdn
 * Returns CDN cache stats.
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

  const cdn = getCDNManager();
  const [cacheStats, streamingConfig] = await Promise.all([
    cdn.getCacheStats(),
    Promise.resolve(cdn.getStreamingConfig()),
  ]);

  return NextResponse.json({
    cache: cacheStats,
    streaming_config: streamingConfig,
  });
}

/**
 * POST /api/admin/cdn
 * Preload a scene to CDN.
 * Body: { scene_id }
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

  // Validate input with try/catch
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { scene_id } = body as { scene_id?: string };

  if (!scene_id || typeof scene_id !== "string") {
    return NextResponse.json({ error: "scene_id is required and must be a string" }, { status: 400 });
  }

  // Validate scene_id is a valid UUID format
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(scene_id)) {
    return NextResponse.json({ error: "scene_id must be a valid UUID" }, { status: 400 });
  }

  const cdn = getCDNManager();
  const success = await cdn.preloadToCDN(scene_id);

  if (!success) {
    return NextResponse.json({ error: "Failed to preload scene to CDN" }, { status: 500 });
  }

  return NextResponse.json({ scene_id, preloaded: true });
}
