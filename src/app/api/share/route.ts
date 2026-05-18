// ============================================
// POST /api/share
// ============================================
// Tracks share events for properties.
// Tracks method-specific event (SHARE_LINK_COPIED or SHARE_QR_GENERATED)
// and a general PROPERTY_SHARED event.
// ============================================

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { trackServerEvent, EVENT_TYPES } from "@/lib/event-tracking/server";
import { NextRequest, NextResponse } from "next/server";

// ============================================
// Request / Response types
// ============================================

interface ShareRequest {
  property_id: string;
  share_method: "link" | "qr" | "social";
  platform?: string;
}

const VALID_SHARE_METHODS = ["link", "qr", "social"] as const;

// Per-user rate limiting (max 50 share events/user/minute)
const SHARE_RATE_LIMIT = 50;
const SHARE_RATE_WINDOW = 60_000;
const shareRateMap = new Map<string, { count: number; resetAt: number }>();

// ============================================
// POST — Track share event
// ============================================

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

  // Per-user rate limiting
  const now = Date.now();
  const shareUserKey = user.id;
  const shareLimit = shareRateMap.get(shareUserKey);
  if (shareLimit && now < shareLimit.resetAt && shareLimit.count >= SHARE_RATE_LIMIT) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  if (!shareLimit || now >= shareLimit.resetAt) {
    shareRateMap.set(shareUserKey, { count: 0, resetAt: now + SHARE_RATE_WINDOW });
  }
  shareRateMap.get(shareUserKey)!.count += 1;

  const adminClient = createAdminClient();
  const dataClient = adminClient || supabase;

  // 2. Parse and validate request body
  let body: ShareRequest;
  try {
    body = await request.json();
  } catch (err) {
    console.error("[ShareAPI] JSON parse failed:", err);
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Validate property_id
  if (!body.property_id || typeof body.property_id !== "string") {
    return NextResponse.json(
      { error: "property_id is required" },
      { status: 400 },
    );
  }

  // Validate share_method
  if (!body.share_method || !VALID_SHARE_METHODS.includes(body.share_method)) {
    return NextResponse.json(
      { error: `share_method must be one of: ${VALID_SHARE_METHODS.join(", ")}` },
      { status: 400 },
    );
  }

  // 3. Look up user's org membership
  const { data: orgMembership } = await dataClient
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const orgId = orgMembership?.org_id || null;

  // 4. Verify the property exists and check org ownership
  const { data: property } = await dataClient
    .from("properties")
    .select("id, org_id")
    .eq("id", body.property_id)
    .maybeSingle();

  if (!property) {
    return NextResponse.json(
      { error: "Property not found" },
      { status: 404 },
    );
  }

  // 4b. Verify the requesting user's org owns this property
  if (property.org_id) {
    const { data: membership } = await dataClient
      .from("organization_members")
      .select("id")
      .eq("org_id", property.org_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json(
        { error: "You don't have access to this property" },
        { status: 403 },
      );
    }
  }

  // 5. Build shared metadata
  const shareMetadata: Record<string, unknown> = {
    property_id: body.property_id,
    share_method: body.share_method,
  };

  if (body.platform) {
    shareMetadata.platform = body.platform;
  }

  // 6. Track method-specific event
  const methodEventType = body.share_method === "qr"
    ? EVENT_TYPES.SHARE_QR_GENERATED
    : EVENT_TYPES.SHARE_LINK_COPIED;

  await trackServerEvent(
    methodEventType,
    shareMetadata,
    user.id,
    orgId,
    request,
  );

  // 7. Track general PROPERTY_SHARED event
  await trackServerEvent(
    EVENT_TYPES.PROPERTY_SHARED,
    shareMetadata,
    user.id,
    orgId,
    request,
  );

  // 8. Return success
  return NextResponse.json({ success: true });
}
