// ============================================
// PATCH /api/user/role
// ============================================
// Update the authenticated user's role.
// Uses admin client to bypass RLS.
// ============================================

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const VALID_ROLES = ["client", "agent", "admin"] as const;
type ValidRole = (typeof VALID_ROLES)[number];

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse request body
  let body: { role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { role } = body;

  if (!role || !VALID_ROLES.includes(role as ValidRole)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` },
      { status: 400 }
    );
  }

  // Use admin client to bypass RLS
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Admin service not configured" }, { status: 503 });
  }

  const { data: updated, error: updateError } = await admin
    .from("users")
    .update({
      role,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("id, role")
    .single();

  if (updateError) {
    console.error("[/api/user/role] Update failed:", updateError.message);
    return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
  }

  return NextResponse.json({ user: updated });
}
