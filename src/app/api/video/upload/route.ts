import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Supabase join result type
interface PropertyOrgJoinResult {
  org_id: string | null;
}

/**
 * POST /api/video/upload
 *
 * Prepares a video upload by creating a video_captures record and
 * returning the storage path the client should upload to.
 *
 * Body: { session_id, property_id, file_name, file_size, content_type }
 * Response: { video_capture_id, path, property_id }
 *
 * Must be authenticated agent/admin.
 */
export async function POST(request: NextRequest) {
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

  const adminClient = createAdminClient();
  const dataClient = adminClient || supabase;

  // 2. Parse body
  const body = await request.json();
  const { session_id, property_id, file_name, file_size, content_type } = body as {
    session_id?: string;
    property_id?: string;
    file_name?: string;
    file_size?: number;
    content_type?: string;
  };

  if (!session_id || !property_id || !file_name || file_size === undefined) {
    return NextResponse.json(
      { error: "session_id, property_id, file_name, and file_size are required" },
      { status: 422 }
    );
  }

  // 3. Verify user is agent/admin
  const { data: profile } = await dataClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden — agent/admin required" }, { status: 403 });
  }

  // 4. Verify the session exists and belongs to user's org
  const { data: session } = await dataClient
    .from("capture_sessions")
    .select("id, property_id, properties!inner(org_id)")
    .eq("id", session_id)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Capture session not found" }, { status: 404 });
  }

  // Verify the session's property matches the provided property_id
  if (session.property_id !== property_id) {
    return NextResponse.json(
      { error: "Session does not belong to the specified property" },
      { status: 400 }
    );
  }

  // Verify org membership
  const sessionOrgId = (session.properties as unknown as PropertyOrgJoinResult)?.org_id;
  if (sessionOrgId) {
    const { data: membership } = await dataClient
      .from("organization_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .eq("org_id", sessionOrgId)
      .single();

    if (
      !membership ||
      (membership.role !== "owner" && membership.role !== "agent")
    ) {
      return NextResponse.json(
        { error: "You don't have access to this session's organization" },
        { status: 403 }
      );
    }
  }

  // 5. Generate storage path: video-captures/{session_id}/{timestamp}-{filename}
  const timestamp = Date.now();
  const sanitizedFileName = file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `video-captures/${session_id}/${timestamp}-${sanitizedFileName}`;

  // 6. Create video_captures record with status "uploaded"
  const { data: videoCapture, error: insertError } = await dataClient
    .from("video_captures")
    .insert({
      session_id,
      property_id,
      storage_path: storagePath,
      file_name,
      file_size,
      content_type: content_type || "video/mp4",
      status: "uploaded",
      uploaded_by: user.id,
    })
    .select("id")
    .single();

  if (insertError || !videoCapture) {
    console.error("[VideoUpload] video_captures insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to create video capture record" },
      { status: 500 }
    );
  }

  // 7. Return the video capture id, storage path, and property_id
  return NextResponse.json(
    {
      video_capture_id: videoCapture.id,
      path: storagePath,
      property_id,
    },
    { status: 201 }
  );
}
