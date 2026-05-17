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

  const body = await request.json();
  const { session_id, property_id, video_capture_id, storage_path, duration_seconds, width, height } = body;

  if (!session_id || !property_id || !video_capture_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Verify the file exists in storage
  const { data: fileData, error: fileError } = await dataClient.storage
    .from("property-captures")
    .list(`video-captures/${session_id}`);

  if (fileError || !fileData || fileData.length === 0) {
    console.error("[VideoConfirm] File not found in storage:", fileError);
    return NextResponse.json({ error: "Video file not found in storage" }, { status: 400 });
  }

  // Update video_captures with metadata
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
  }

  // Update capture_sessions → processing
  const { error: sessionError } = await dataClient
    .from("capture_sessions")
    .update({ status: "processing" })
    .eq("id", session_id);

  if (sessionError) {
    console.error("[VideoConfirm] Session update error:", sessionError);
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
    .single();

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
