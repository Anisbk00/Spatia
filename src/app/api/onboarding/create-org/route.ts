// ============================================
// POST /api/onboarding/create-org
// ============================================
// Create an organization and add the user as owner.
// Uses admin client to bypass RLS — ensures org
// creation always succeeds during onboarding.
// ============================================

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  // 1. Authenticate the user
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse request body
  let body: { name?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgName = body.name?.trim();
  if (!orgName) {
    return NextResponse.json(
      { error: "Organization name is required" },
      { status: 400 }
    );
  }

  // 3. Use admin client for ALL data operations to bypass RLS
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin service not configured" },
      { status: 503 }
    );
  }

  // 4. Check if user already has an org
  const { data: existingMembership } = await admin
    .from("organization_members")
    .select("org_id, organizations(id, name)")
    .eq("user_id", user.id)
    .limit(1);

  if (existingMembership && existingMembership.length > 0) {
    // User already has an org — return it
    const existing = existingMembership[0] as Record<string, unknown>;
    const existingOrg = existing.organizations as Record<string, unknown>;
    return NextResponse.json({
      organization: existingOrg,
      membership: existing,
      alreadyExisted: true,
    });
  }

  // 5. Generate referral code
  let referralCode = "";
  try {
    const { data: rpcCode } = await admin.rpc("generate_referral_code");
    referralCode = rpcCode || "";
  } catch {
    // Fallback: generate a random code
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const arr = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    referralCode = Array.from(arr, (b) => chars[b % chars.length]).join("");
  }

  // 6. Create organization
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: orgName,
      owner_id: user.id,
      plan: "free",
      referral_code: referralCode,
    })
    .select()
    .single();

  if (orgError || !org) {
    console.error("[/api/onboarding/create-org] Org insert error:", orgError?.message);
    return NextResponse.json(
      { error: "Failed to create organization" },
      { status: 500 }
    );
  }

  // 7. Add owner membership
  const { data: membership, error: memberError } = await admin
    .from("organization_members")
    .insert({
      org_id: org.id,
      user_id: user.id,
      role: "owner",
    })
    .select()
    .single();

  if (memberError) {
    console.error("[/api/onboarding/create-org] Membership insert error:", memberError.message);
    // Org was created but membership failed — still return the org
    return NextResponse.json({
      organization: org,
      membership: null,
      warning: "Organization created but membership assignment failed",
    });
  }

  // 8. Update user role to agent (org owners are agents)
  const { error: roleError } = await admin
    .from("users")
    .update({ role: "agent", updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (roleError) {
    console.error("[/api/onboarding/create-org] Role update error:", roleError.message);
    // Don't fail the whole request — role update is secondary
  }

  return NextResponse.json({
    organization: org,
    membership,
  }, { status: 201 });
}
