import { createClient } from "@/lib/supabase/server";
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

  // 2. Verify session exists and belongs to user
  const { data: session } = await supabase
    .from("capture_sessions")
    .select("*, properties!inner(org_id)")
    .eq("id", session_id)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Verify user is agent/admin of the org
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. Update session status → 'processing'
  const { error: sessionError } = await supabase
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

  // 4. Update property status → 'processing'
  await supabase
    .from("properties")
    .update({ status: "processing" })
    .eq("id", session.property_id);

  // 5. Create scene record
  const { data: scene, error: sceneError } = await supabase
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

  // 6. Create processing job: SfM reconstruction
  const { error: jobError } = await supabase
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

  // 7. Return success
  return NextResponse.json({
    sessionId: session_id,
    sceneId: scene.id,
    status: "processing",
  });
}
