import { createClient } from "@/lib/supabase/server";
import { getEnterpriseManager } from "@/lib/enterprise";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/enterprise/batch
 * Create a bulk operation.
 * Body: { org_id, operation_type, items, metadata }
 * Admin auth or org member.
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

  const isAdmin = userProfile?.role === "admin";

  const body = await request.json();
  const { org_id, operation_type, items, metadata } = body as {
    org_id?: string;
    operation_type?: string;
    items?: Array<{ property_id: string }>;
    metadata?: Record<string, unknown>;
  };

  if (!org_id || !operation_type || !items || !Array.isArray(items)) {
    return NextResponse.json(
      { error: "org_id, operation_type, and items array are required" },
      { status: 400 },
    );
  }

  // If not admin, check org membership
  if (!isAdmin) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("org_id", org_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const enterprise = getEnterpriseManager();
  const operationId = await enterprise.createBulkOperation({
    orgId: org_id,
    userId: user.id,
    operationType: operation_type as "bulk_property_upload" | "bulk_scene_processing" | "bulk_enhancement" | "bulk_export",
    items,
    metadata,
  });

  if (!operationId) {
    return NextResponse.json({ error: "Failed to create bulk operation" }, { status: 500 });
  }

  return NextResponse.json({ operation_id: operationId, status: "pending" }, { status: 201 });
}

/**
 * GET /api/admin/enterprise/batch
 * Get bulk operation status.
 * Query params: ?operation_id=xxx
 * Admin auth or org member.
 */
export async function GET(request: NextRequest) {
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

  const isAdmin = userProfile?.role === "admin";

  const { searchParams } = new URL(request.url);
  const operationId = searchParams.get("operation_id");

  if (!operationId) {
    return NextResponse.json({ error: "operation_id query parameter is required" }, { status: 400 });
  }

  // If not admin, verify the operation belongs to user's org
  if (!isAdmin) {
    const { data: operation } = await supabase
      .from("batch_operations")
      .select("org_id")
      .eq("id", operationId)
      .single();

    if (!operation) {
      return NextResponse.json({ error: "Operation not found" }, { status: 404 });
    }

    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("org_id", operation.org_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const enterprise = getEnterpriseManager();
  const status = await enterprise.getBulkOperationStatus(operationId);

  if (!status) {
    return NextResponse.json({ error: "Operation not found" }, { status: 404 });
  }

  return NextResponse.json({ operation_id: operationId, ...status });
}
