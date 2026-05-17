// ============================================
// PATCH / DELETE /api/properties/[property_id]
// ============================================
// Update or delete a specific property.
// Both handlers require authentication and org membership.
// Org ownership is verified inside the mutation functions.
// ============================================

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { propertyIdSchema, propertyUpdateSchema } from "@/lib/properties/validation";
import { trackServerEvent } from "@/lib/event-tracking/server";

// ============================================
// Shared helpers
// ============================================

/**
 * Authenticate the request and return the user + orgId.
 * Returns a NextResponse error if auth fails, or null on success.
 */
type AuthResult =
  | { user: { id: string }; orgId: string | null }
  | { error: NextResponse };

async function authenticateRequest(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
): Promise<AuthResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // Fetch org membership — use admin client to bypass potential RLS
  let orgId: string | null = null;
  try {
    const adminClient = createAdminClient();
    const clientToUse = adminClient || supabase;
    const { data: membership } = await clientToUse
      .from("organization_members")
      .select("org_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    orgId = membership?.org_id ?? null;
  } catch {
    // User may not have an org membership yet
  }

  return { user, orgId };
}

/**
 * Map mutation error strings to appropriate HTTP status codes.
 */
function errorToStatus(error: string): number {
  if (error.includes("not found")) return 404;
  if (error.includes("Unauthorized") || error.includes("does not belong")) return 403;
  if (error.includes("Invalid") || error.includes("only allowed")) return 422;
  return 500;
}

// ============================================
// PATCH — Update a property
// ============================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ property_id: string }> },
) {
  // 1. Verify Supabase is configured
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    console.error("[Property PATCH API] Failed to create Supabase client:", err);
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  // 2. Authenticate user and get org_id
  const authResult = await authenticateRequest(supabase);
  if ("error" in authResult) return authResult.error;
  const { user, orgId } = authResult;

  // 3. Validate property_id from URL params
  const { property_id: propertyId } = await params;
  const idResult = propertyIdSchema.safeParse(propertyId);
  if (!idResult.success) {
    return NextResponse.json(
      { error: "Invalid property ID format" },
      { status: 422 },
    );
  }

  // 4. Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const dataResult = propertyUpdateSchema.safeParse(body);
  if (!dataResult.success) {
    const firstError = dataResult.error.issues[0];
    return NextResponse.json(
      { error: firstError?.message ?? "Invalid update data" },
      { status: 422 },
    );
  }

  // 5. Org_id check before mutation
  if (!orgId) {
    return NextResponse.json(
      { error: "You must belong to an organization to update properties" },
      { status: 403 },
    );
  }

  // 6. Perform the update using admin client to bypass RLS
  const adminClient = createAdminClient();
  const writeClient = adminClient || supabase;

  try {
    // Verify org ownership
    const { data: existing, error: fetchError } = await writeClient
      .from("properties")
      .select("id, org_id, status")
      .eq("id", propertyId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    if (existing.org_id !== orgId) {
      return NextResponse.json(
        { error: "Unauthorized: property does not belong to this organization" },
        { status: 403 },
      );
    }

    // Perform the update
    const updatePayload: Record<string, unknown> = {
      ...dataResult.data,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updateError } = await writeClient
      .from("properties")
      .update(updatePayload)
      .eq("id", propertyId)
      .select("*")
      .single();

    if (updateError) {
      console.error("[Property PATCH API] Update error:", updateError.message);
      const status = errorToStatus(updateError.message);
      const safeMessage = status === 500 ? "Failed to update property" : updateError.message;
      return NextResponse.json({ error: safeMessage }, { status });
    }

    // 7. Track analytics event (best-effort, non-blocking)
    trackServerEvent(
      "PROPERTY_UPDATED",
      { property_id: propertyId, updated_fields: Object.keys(dataResult.data) },
      user.id,
      orgId,
      request,
    ).catch(() => {
      // Analytics failure must not block the response
    });

    // 8. Return updated property
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[Property PATCH API] Unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to update property" },
      { status: 500 },
    );
  }
}

// ============================================
// DELETE — Soft-delete (archive) or hard-delete a property
// ============================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ property_id: string }> },
) {
  // 1. Verify Supabase is configured
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    console.error("[Property DELETE API] Failed to create Supabase client:", err);
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  // 2. Authenticate user and get org_id
  const authResult = await authenticateRequest(supabase);
  if ("error" in authResult) return authResult.error;
  const { user, orgId } = authResult;

  // 3. Validate property_id from URL params
  const { property_id: propertyId } = await params;
  const idResult = propertyIdSchema.safeParse(propertyId);
  if (!idResult.success) {
    return NextResponse.json(
      { error: "Invalid property ID format" },
      { status: 422 },
    );
  }

  // 4. Parse request body for hardDelete flag
  let hardDelete = false;
  try {
    const body = await request.json();
    if (body && typeof body === "object" && "hardDelete" in body) {
      hardDelete = body.hardDelete === true;
    }
  } catch {
    // Body is optional for DELETE — default to soft delete
  }

  // 5. Org_id check before mutation
  if (!orgId) {
    return NextResponse.json(
      { error: "You must belong to an organization to delete properties" },
      { status: 403 },
    );
  }

  // 6. Perform the delete using admin client to bypass RLS
  const adminClient = createAdminClient();
  const writeClient = adminClient || supabase;

  try {
    // Verify org ownership and status
    const { data: existing, error: fetchError } = await writeClient
      .from("properties")
      .select("id, org_id, status")
      .eq("id", propertyId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    if (existing.org_id !== orgId) {
      return NextResponse.json(
        { error: "Unauthorized: property does not belong to this organization" },
        { status: 403 },
      );
    }

    if (hardDelete) {
      // Only allow hard delete for draft or archived properties
      if (existing.status !== "draft" && existing.status !== "archived") {
        return NextResponse.json(
          { error: "Hard delete is only allowed for properties with 'draft' or 'archived' status" },
          { status: 422 },
        );
      }

      const { error: deleteError } = await writeClient
        .from("properties")
        .delete()
        .eq("id", propertyId);

      if (deleteError) {
        console.error("[Property DELETE API] Hard delete error:", deleteError.message);
        return NextResponse.json(
          { error: "Failed to delete property" },
          { status: 500 },
        );
      }
    } else {
      // Soft delete: set status to 'archived'
      const { error: updateError } = await writeClient
        .from("properties")
        .update({
          status: "archived",
          updated_at: new Date().toISOString(),
        })
        .eq("id", propertyId);

      if (updateError) {
        console.error("[Property DELETE API] Archive error:", updateError.message);
        return NextResponse.json(
          { error: "Failed to archive property" },
          { status: 500 },
        );
      }
    }

    // 7. Track analytics event (best-effort, non-blocking)
    const eventType = hardDelete ? "PROPERTY_DELETED" : "PROPERTY_ARCHIVED";
    trackServerEvent(
      eventType,
      { property_id: propertyId, hard_delete: hardDelete },
      user.id,
      orgId,
      request,
    ).catch(() => {
      // Analytics failure must not block the response
    });

    // 8. Return success response
    return NextResponse.json({
      success: true,
      property_id: propertyId,
      action: hardDelete ? "hard_deleted" : "archived",
    });
  } catch (err) {
    console.error("[Property DELETE API] Unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to delete property" },
      { status: 500 },
    );
  }
}
