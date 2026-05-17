import { createClient } from "@/lib/supabase/server";
import { getAIEnhancementPipeline } from "@/lib/ai-enhancement";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ enhancement_id: string }> };

/**
 * GET /api/admin/enhancements/[enhancement_id]
 * Returns enhancement details with results.
 * Admin auth or org member.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
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

  const { enhancement_id } = await context.params;

  const pipeline = getAIEnhancementPipeline();
  const enhancement = await pipeline.getEnhancementStatus(enhancement_id);

  if (!enhancement) {
    return NextResponse.json({ error: "Enhancement not found" }, { status: 404 });
  }

  // If not admin, check org membership
  if (!isAdmin) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("org_id", enhancement.org_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({ enhancement });
}
