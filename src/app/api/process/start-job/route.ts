import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/process/start-job
 * Manually trigger a processing job for a session.
 * This is also called automatically when finishing a capture session.
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

  // Use admin client for data operations (bypasses RLS)
  const adminClient = createAdminClient();
  const dataClient = adminClient || supabase;

  const body = await request.json();
  const { session_id } = body as { session_id?: string };

  if (!session_id) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  // Verify session exists and belongs to user's org
  const { data: session } = await dataClient
    .from("capture_sessions")
    .select("*, properties!inner(org_id)")
    .eq("id", session_id)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Verify org ownership
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

  // Verify agent/admin role
  const { data: profile } = await dataClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check if a scene already exists for this session
  const { data: existingScene } = await dataClient
    .from("scenes")
    .select("id, status")
    .eq("session_id", session_id)
    .limit(1)
    .single();

  let sceneId = existingScene?.id;

  if (!sceneId) {
    // Create scene
    const { data: newScene, error: sceneError } = await dataClient
      .from("scenes")
      .insert({
        property_id: session.property_id,
        session_id: session_id,
        status: "queued",
      })
      .select("id")
      .single();

    if (sceneError || !newScene) {
      return NextResponse.json(
        { error: "Failed to create scene" },
        { status: 500 }
      );
    }
    sceneId = newScene.id;
  }

  // Check if a job already exists for this scene
  const { data: existingJob } = await dataClient
    .from("processing_jobs")
    .select("id, status")
    .eq("scene_id", sceneId)
    .limit(1)
    .single();

  if (existingJob && ["queued", "running"].includes(existingJob.status)) {
    return NextResponse.json({
      jobId: existingJob.id,
      sceneId,
      status: existingJob.status,
      message: "Job already exists and is processing",
    });
  }

  // Create processing job
  const { data: job, error: jobError } = await dataClient
    .from("processing_jobs")
    .insert({
      scene_id: sceneId,
      job_type: "sfm_reconstruction",
      status: "queued",
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return NextResponse.json(
      { error: "Failed to create processing job" },
      { status: 500 }
    );
  }

  // Update session and property status
  await dataClient
    .from("capture_sessions")
    .update({ status: "processing" })
    .eq("id", session_id);

  await dataClient
    .from("properties")
    .update({ status: "processing" })
    .eq("id", session.property_id);

  return NextResponse.json({
    jobId: job.id,
    sceneId,
    status: "queued",
  });
}
