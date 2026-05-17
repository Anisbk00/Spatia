import { createClient } from "@/lib/supabase/server";
import { getEnterpriseManager } from "@/lib/enterprise";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/enterprise
 * Returns enterprise settings for an org.
 * Query params: ?org_id=xxx
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
  const orgId = searchParams.get("org_id");

  if (!orgId) {
    return NextResponse.json({ error: "org_id query parameter is required" }, { status: 400 });
  }

  // If not admin, check org membership
  if (!isAdmin) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const enterprise = getEnterpriseManager();
  const settings = await enterprise.getSettings(orgId);

  if (!settings) {
    return NextResponse.json({ error: "Enterprise settings not found for this org" }, { status: 404 });
  }

  return NextResponse.json({ settings });
}

/**
 * PATCH /api/admin/enterprise
 * Update enterprise settings.
 * Body: partial EnterpriseSettings
 * Admin auth or org owner.
 */
export async function PATCH(request: NextRequest) {
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
  const { org_id, ...settings } = body as {
    org_id?: string;
    [key: string]: unknown;
  };

  if (!org_id) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  // If not admin, check org owner role
  if (!isAdmin) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("org_id", org_id)
      .eq("user_id", user.id)
      .single();

    if (!membership || membership.role !== "owner") {
      return NextResponse.json({ error: "Forbidden — only org owners can update settings" }, { status: 403 });
    }
  }

  const enterprise = getEnterpriseManager();
  const updated = await enterprise.upsertSettings(org_id, settings);

  if (!updated) {
    return NextResponse.json({ error: "Failed to update enterprise settings" }, { status: 500 });
  }

  return NextResponse.json({ settings: updated });
}
