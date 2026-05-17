import { createClient } from "@/lib/supabase/server";
import { getAuditLogs } from "@/lib/enterprise/audit";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/enterprise/audit
 * Get audit logs for an org.
 * Query params: ?org_id=xxx&action=property.create&limit=50
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
  const action = searchParams.get("action") || undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

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

  const logs = await getAuditLogs({
    orgId,
    action,
    limit,
    offset,
  });

  return NextResponse.json({ logs, limit, offset });
}
