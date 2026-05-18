import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

  // Verify user is agent/admin
  const { data: profile } = await dataClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { session_id, property_id, video_capture_id, storage_path, duration_seconds, width, height } = body;

  if (!session_id || !property_id || !video_capture_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Verify session exists and belongs to user's org
  const { data: session } = await dataClient
    .from("capture_sessions")
    .select("id, property_id, properties!inner(org_id)")
    .eq("id", session_id)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Capture session not found" }, { status: 404 });
  }

  const sessionOrgId = (session.properties as unknown as { org_id: string | null })?.org_id;
  if (sessionOrgId) {
    const { data: membership } = await dataClient
      .from("organization_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .eq("org_id", sessionOrgId)
      .maybeSingle();

    if (!membership || (membership.role !== "owner" && membership.role !== "agent")) {
      return NextResponse.json(
        { error: "You don't have access to this session's organization" },
        { status: 403 }
      );
    }
  }

  // Verify the specific expected file exists in storage (not just any files in the directory)
  // Fetch the video capture record to get the expected storage_path
  const { data: vcRecord } = await dataClient
    .from("video_captures")
    .select("storage_path")
    .eq("id", video_capture_id)
    .maybeSingle();

  const expectedStoragePath = vcRecord?.storage_path || storage_path;
  if (!expectedStoragePath) {
    return NextResponse.json({ error: "No storage path specified" }, { status: 400 });
  }

  // Extract directory and expected file name from the storage path
  const lastSlashIndex = expectedStoragePath.lastIndexOf("/");
  if (lastSlashIndex === -1) {
    return NextResponse.json({ error: "Invalid storage path format" }, { status: 400 });
  }
  const directory = expectedStoragePath.substring(0, lastSlashIndex);
  const expectedFileName = expectedStoragePath.substring(lastSlashIndex + 1);

  const { data: fileData, error: fileError } = await dataClient.storage
    .from("property-captures")
    .list(directory);

  if (fileError) {
    console.error("[VideoConfirm] Storage list error:", fileError);
    return NextResponse.json({ error: "Failed to verify file in storage" }, { status: 400 });
  }

  // Verify the specific expected file exists in the directory listing
  const expectedFileExists = fileData?.some(f => f.name === expectedFileName);
  if (!expectedFileExists) {
    console.error("[VideoConfirm] Expected file not found:", expectedFileName);
    return NextResponse.json({ error: "Expected video file not found in storage" }, { status: 400 });
  }

  // Update video_captures with metadata — fail-fast on error
  const { error: vcUpdateError } = await dataClient
    .from("video_captures")
    .update({
      status: "extracting",
      duration_seconds: duration_seconds || null,
      width: width || null,
      height: height || null,
      metadata: { duration: duration_seconds, resolution: width && height ? `${width}x${height}` : null },
    })
    .eq("id", video_capture_id);

  if (vcUpdateError) {
    console.error("[VideoConfirm] Video capture update error:", vcUpdateError);
    return NextResponse.json({ error: "Failed to update video capture" }, { status: 500 });
  }

  // Update capture_sessions → processing — fail-fast on error
  const { error: sessionError } = await dataClient
    .from("capture_sessions")
    .update({ status: "processing" })
    .eq("id", session_id);

  if (sessionError) {
    console.error("[VideoConfirm] Session update error:", sessionError);
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }

  // Update properties → processing
  await dataClient
    .from("properties")
    .update({ status: "processing" })
    .eq("id", property_id);

  // Create or get scene
  const { data: existingScene } = await dataClient
    .from("scenes")
    .select("id")
    .eq("session_id", session_id)
    .limit(1)
    .maybeSingle();

  let sceneId = existingScene?.id;

  if (!sceneId) {
    const { data: newScene, error: sceneError } = await dataClient
      .from("scenes")
      .insert({
        property_id,
        session_id,
        status: "queued",
      })
      .select("id")
      .single();

    if (sceneError || !newScene) {
      console.error("[VideoConfirm] Scene creation error:", sceneError);
      return NextResponse.json({ error: "Failed to create scene" }, { status: 500 });
    }
    sceneId = newScene.id;
  }

  // Create processing job — frame_extraction is the first step
  const { data: job, error: jobError } = await dataClient
    .from("processing_jobs")
    .insert({
      scene_id: sceneId,
      job_type: "frame_extraction",
      status: "queued",
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("[VideoConfirm] Job creation error:", jobError);
    return NextResponse.json({ error: "Failed to create processing job" }, { status: 500 });
  }

  return NextResponse.json({
    scene_id: sceneId,
    property_id,
    job_id: job.id,
    status: "processing",
  }, { status: 201 });
}
