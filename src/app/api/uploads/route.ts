// ============================================
// /api/uploads — CRUD for upload_operations table
// ============================================

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Supabase join result type
interface PropertyOrgJoinResult {
  org_id: string | null;
}

// -------------------------------------------
// POST — Create an upload_operation record
// -------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 }
    );
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
  const { sessionId, propertyId, fileName, fileSize, contentType, orgId } = body as {
    sessionId?: string;
    propertyId?: string;
    fileName?: string;
    fileSize?: number;
    contentType?: string;
    orgId?: string;
  };

  if (!sessionId || !propertyId || !fileName || fileSize === undefined) {
    return NextResponse.json(
      { error: "sessionId, propertyId, fileName, and fileSize are required" },
      { status: 422 }
    );
  }

  // 3. Verify user is agent/admin of the org that owns the property
  const { data: profile } = await dataClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify session belongs to user's org
  const { data: session } = await dataClient
    .from("capture_sessions")
    .select("id, property_id, properties!inner(org_id)")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json(
      { error: "Capture session not found" },
      { status: 404 }
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
      (membership.role !== "owner" &&
        membership.role !== "agent")
    ) {
      return NextResponse.json(
        { error: "You don't have access to this session's organization" },
        { status: 403 }
      );
    }
  }

  // 4. Create upload_operation record
  const now = new Date().toISOString();
  const { data: operation, error: insertError } = await dataClient
    .from("upload_operations")
    .insert({
      org_id: orgId ?? sessionOrgId ?? null,
      user_id: user.id,
      session_id: sessionId,
      property_id: propertyId,
      file_name: fileName,
      file_size: fileSize,
      content_type: contentType || "image/jpeg",
      storage_path: null,
      status: "pending",
      bytes_uploaded: 0,
      chunk_count: 0,
      chunks_uploaded: 0,
      retry_count: 0,
      last_error: null,
      media_id: null,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (insertError || !operation) {
    console.error("upload_operations insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to create upload operation" },
      { status: 500 }
    );
  }

  return NextResponse.json({ operation }, { status: 201 });
}

// -------------------------------------------
// GET — List upload_operations for a session
// -------------------------------------------

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 }
    );
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

  // 2. Get query params
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const propertyId = searchParams.get("propertyId");

  if (!sessionId && !propertyId) {
    return NextResponse.json(
      { error: "sessionId or propertyId query parameter is required" },
      { status: 422 }
    );
  }

  // 3. Verify user has access
  const { data: profile } = await dataClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify session belongs to user's org
  if (sessionId) {
    const { data: session } = await dataClient
      .from("capture_sessions")
      .select("id, properties!inner(org_id)")
      .eq("id", sessionId)
      .maybeSingle();

    if (!session) {
      return NextResponse.json(
        { error: "Capture session not found" },
        { status: 404 }
      );
    }

    const sessionOrgId = (session.properties as unknown as PropertyOrgJoinResult)?.org_id;
    if (sessionOrgId) {
      const { data: membership } = await dataClient
        .from("organization_members")
        .select("org_id")
        .eq("user_id", user.id)
        .eq("org_id", sessionOrgId)
        .single();

      if (!membership) {
        return NextResponse.json(
          { error: "You don't have access to this session" },
          { status: 403 }
        );
      }
    }
  }

  // 4. Fetch upload operations
  let query = dataClient
    .from("upload_operations")
    .select("*")
    .order("created_at", { ascending: true });

  if (sessionId) {
    query = query.eq("session_id", sessionId);
  }
  if (propertyId) {
    query = query.eq("property_id", propertyId);
  }

  const { data: operations, error: fetchError } = await query;

  if (fetchError) {
    console.error("upload_operations fetch error:", fetchError);
    return NextResponse.json(
      { error: "Failed to fetch upload operations" },
      { status: 500 }
    );
  }

  return NextResponse.json({ operations: operations ?? [] });
}

// -------------------------------------------
// PATCH — Update upload status
// -------------------------------------------

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 }
    );
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
  const {
    operationId,
    status,
    bytesUploaded,
    chunksUploaded,
    retryCount,
    lastError,
    mediaId,
    storagePath,
  } = body as {
    operationId?: string;
    status?: string;
    bytesUploaded?: number;
    chunksUploaded?: number;
    retryCount?: number;
    lastError?: string;
    mediaId?: string;
    storagePath?: string;
  };

  if (!operationId) {
    return NextResponse.json(
      { error: "operationId is required" },
      { status: 422 }
    );
  }

  // 3. Verify user owns this operation or is admin
  const { data: operation } = await dataClient
    .from("upload_operations")
    .select("id, user_id, org_id, session_id")
    .eq("id", operationId)
    .maybeSingle();

  if (!operation) {
    return NextResponse.json(
      { error: "Upload operation not found" },
      { status: 404 }
    );
  }

  // Allow the user who created it, or any admin in the org
  const isOwner = operation.user_id === user.id;
  let isAdmin = false;

  if (!isOwner && operation.org_id) {
    const { data: membership } = await dataClient
      .from("organization_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", operation.org_id)
      .single();
    isAdmin = membership?.role === "owner";
  }

  if (!isOwner && !isAdmin) {
    const { data: profile } = await dataClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // 4. Build update object
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (status !== undefined) update.status = status;
  if (bytesUploaded !== undefined) update.bytes_uploaded = bytesUploaded;
  if (chunksUploaded !== undefined) update.chunks_uploaded = chunksUploaded;
  if (retryCount !== undefined) update.retry_count = retryCount;
  if (lastError !== undefined) update.last_error = lastError;
  if (mediaId !== undefined) update.media_id = mediaId;
  if (storagePath !== undefined) update.storage_path = storagePath;

  // 5. Apply update
  const { data: updated, error: updateError } = await dataClient
    .from("upload_operations")
    .update(update)
    .eq("id", operationId)
    .select()
    .single();

  if (updateError || !updated) {
    console.error("upload_operations update error:", updateError);
    return NextResponse.json(
      { error: "Failed to update upload operation" },
      { status: 500 }
    );
  }

  return NextResponse.json({ operation: updated });
}
