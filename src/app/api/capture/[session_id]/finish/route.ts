import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ session_id: string }> }
) {
  const { session_id } = await params;

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use admin client for data operations (bypasses RLS)
  const adminClient = createAdminClient();
  const dataClient = adminClient || supabase;

  // 2. Verify session exists and belongs to user
  const { data: session } = await dataClient
    .from("capture_sessions")
    .select("*, properties!inner(org_id)")
    .eq("id", session_id)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 2b. Verify org ownership
  const sessionOrgId = (session.properties as unknown as { org_id: string | null })?.org_id;
  if (sessionOrgId) {
    const { data: member } = await dataClient
      .from("organization_members")
      .select("id")
      .eq("org_id", sessionOrgId)
      .eq("user_id", user.id)
      .in("role", ["owner", "agent"])
      .maybeSingle();
    if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify user is agent/admin of the org
  const { data: profile } = await dataClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. Check for duplicate scene before creating (race condition guard)
  const { data: existingScene } = await dataClient
    .from("scenes")
    .select("id, status")
    .eq("session_id", session_id)
    .limit(1)
    .maybeSingle();

  if (existingScene) {
    // Scene already exists for this session — return it instead of creating a duplicate
    return NextResponse.json({
      sessionId: session_id,
      sceneId: existingScene.id,
      status: existingScene.status,
    });
  }

  // 4. Update session status → 'processing'
  const { error: sessionError } = await dataClient
    .from("capture_sessions")
    .update({
      status: "processing",
      completed_at: new Date().toISOString(),
    })
    .eq("id", session_id);

  if (sessionError) {
    console.error("Session update error:", sessionError);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }

  // 5. Update property status → 'processing'
  await dataClient
    .from("properties")
    .update({ status: "processing" })
    .eq("id", session.property_id);

  // 6. Create scene record
  const { data: scene, error: sceneError } = await dataClient
    .from("scenes")
    .insert({
      property_id: session.property_id,
      session_id: session_id,
      status: "queued",
    })
    .select("id")
    .single();

  if (sceneError || !scene) {
    console.error("Scene creation error:", sceneError);
    return NextResponse.json(
      { error: "Failed to create scene" },
      { status: 500 }
    );
  }

  // 7. Create processing job: SfM reconstruction
  const { error: jobError } = await dataClient
    .from("processing_jobs")
    .insert({
      scene_id: scene.id,
      job_type: "sfm_reconstruction",
      status: "queued",
    });

  if (jobError) {
    console.error("Job creation error:", jobError);
    // Non-fatal: the scene exists, job can be retried later
  }

  // 8. Return success
  return NextResponse.json({
    sessionId: session_id,
    sceneId: scene.id,
    status: "processing",
  });
}
