// ============================================
// GET /api/referral  —  Get or generate referral code
// POST /api/referral  —  Track referral signup
// ============================================

import { createClient } from "@/lib/supabase/server";
import { trackServerEvent, EVENT_TYPES } from "@/lib/event-tracking/server";
import { NextRequest, NextResponse } from "next/server";

// ============================================
// Referral code generation
// ============================================

// Exclude confusing characters: 0/O, 1/I/l
const REFERRAL_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REFERRAL_CODE_LENGTH = 8;

function generateReferralCode(): string {
  const randomValues = new Uint8Array(REFERRAL_CODE_LENGTH);
  // Use crypto.getRandomValues for secure randomness
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    // Fallback for environments without crypto
    for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
      randomValues[i] = Math.floor(Math.random() * 256);
    }
  }

  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CHARSET[randomValues[i] % REFERRAL_CHARSET.length];
  }
  return code;
}

// ============================================
// GET — Get current user's org referral code
// ============================================

export async function GET(request: NextRequest) {
  // 1. Authenticate the user
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Look up user's org membership
  const { data: orgMembership } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!orgMembership) {
    return NextResponse.json(
      { error: "No organization found for user" },
      { status: 404 },
    );
  }

  const orgId = orgMembership.org_id;

  // 3. Get org with referral code
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, referral_code")
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    console.error("[/api/referral] Org lookup failed:", orgError?.message);
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 },
    );
  }

  // 4. Generate referral code if org doesn't have one
  let referralCode = org.referral_code;

  if (!referralCode) {
    // Generate a unique referral code (retry if collision)
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      const candidateCode = generateReferralCode();

      // Check for uniqueness
      const { data: existing } = await supabase
        .from("organizations")
        .select("id")
        .eq("referral_code", candidateCode)
        .maybeSingle();

      if (!existing) {
        referralCode = candidateCode;
        break;
      }

      attempts++;
    }

    if (!referralCode) {
      console.error("[/api/referral] Failed to generate unique referral code");
      return NextResponse.json(
        { error: "Failed to generate referral code" },
        { status: 500 },
      );
    }

    // Update the org with the new referral code
    const { error: updateError } = await supabase
      .from("organizations")
      .update({ referral_code: referralCode })
      .eq("id", orgId);

    if (updateError) {
      console.error("[/api/referral] Failed to update org referral code:", updateError.message);
      return NextResponse.json(
        { error: "Failed to save referral code" },
        { status: 500 },
      );
    }

    // Track referral link generated event
    await trackServerEvent(
      EVENT_TYPES.REFERRAL_LINK_GENERATED,
      { referral_code: referralCode },
      user.id,
      orgId,
      request,
    );
  }

  // 5. Count how many referrals this org has
  const { count: referralCount } = await supabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_org_id", orgId);

  // 6. Build the referral link
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const referralLink = baseUrl
    ? `${baseUrl}/signup?ref=${referralCode}`
    : `/signup?ref=${referralCode}`;

  return NextResponse.json({
    referral_code: referralCode,
    referral_link: referralLink,
    referral_count: referralCount ?? 0,
  });
}

// ============================================
// POST — Track a referral signup
// ============================================

interface ReferralSignupRequest {
  referral_code: string;
}

export async function POST(request: NextRequest) {
  // 1. Authenticate the user
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse and validate request body
  let body: ReferralSignupRequest;
  try {
    body = await request.json();
  } catch (err) {
    console.error("[ReferralAPI] JSON parse failed:", err);
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.referral_code || typeof body.referral_code !== "string") {
    return NextResponse.json(
      { error: "referral_code is required" },
      { status: 400 },
    );
  }

  // 3. Look up the referral code in organizations table
  const { data: referrerOrg, error: referrerError } = await supabase
    .from("organizations")
    .select("id, referral_code")
    .eq("referral_code", body.referral_code)
    .single();

  if (referrerError || !referrerOrg) {
    return NextResponse.json(
      { error: "Invalid referral code" },
      { status: 404 },
    );
  }

  // 4. Prevent self-referral
  const { data: userOrgMembership } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (userOrgMembership?.org_id === referrerOrg.id) {
    return NextResponse.json(
      { error: "Cannot use your own referral code" },
      { status: 400 },
    );
  }

  // 5. Check for duplicate referral (same user already referred)
  const { data: existingReferral } = await supabase
    .from("referrals")
    .select("id")
    .eq("referred_user_id", user.id)
    .maybeSingle();

  if (existingReferral) {
    return NextResponse.json(
      { error: "User already has a referral record" },
      { status: 409 },
    );
  }

  // 6. Create a referral record
  const { error: insertError } = await supabase
    .from("referrals")
    .insert({
      referral_code: body.referral_code,
      referrer_org_id: referrerOrg.id,
      referred_org_id: userOrgMembership?.org_id || null,
      referred_user_id: user.id,
      status: "signed_up",
      reward_credits: 0,
    });

  if (insertError) {
    console.error("[/api/referral] Referral insert failed:", insertError.message);
    return NextResponse.json(
      { error: "Failed to create referral record" },
      { status: 500 },
    );
  }

  // 7. Track referral signup event
  await trackServerEvent(
    EVENT_TYPES.REFERRAL_SIGNUP,
    {
      referral_code: body.referral_code,
      referrer_org_id: referrerOrg.id,
    },
    user.id,
    userOrgMembership?.org_id || null,
    request,
  );

  // 8. Return success
  return NextResponse.json({ success: true });
}
