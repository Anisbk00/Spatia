// ============================================
// POST /api/events
// ============================================
// API route for client-side event tracking.
// Accepts batched events, validates authentication,
// and inserts into the events table.
// ============================================

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// ============================================
// Request / Response types
// ============================================

interface ClientEventInput {
  event_type: string;
  metadata?: Record<string, unknown>;
  session_id?: string;
  property_id?: string;
  scene_id?: string;
  device_type?: string;
  user_agent?: string;
  timestamp?: string;
}

interface BatchEventRequest {
  events: ClientEventInput[];
}

const MAX_BATCH_SIZE = 50;
const MAX_METADATA_SIZE = 32_768; // 32KB per event metadata
const MAX_USER_AGENT_LENGTH = 256;

// ============================================
// Validation
// ============================================

function validateEventType(eventType: string): boolean {
  const validTypes = [
    // Core product events
    "PROPERTY_CREATED",
    "CAPTURE_STARTED",
    "IMAGE_UPLOADED",
    "CAPTURE_COMPLETED",
    "PROCESSING_STARTED",
    "SCENE_GENERATED",
    "SCENE_FAILED",
    "VIEWER_OPENED",
    "PROPERTY_SHARED",
    "PROPERTY_VIEWED",
    // Upload resilience events
    "UPLOAD_FAILED",
    "UPLOAD_RETRIED",
    "OFFLINE_CAPTURE",
    "SYNC_COMPLETED",
    "SYNC_FAILED",
    // Auth events
    "SIGNUP_STARTED",
    "SIGNUP_COMPLETED",
    "LOGIN_SUCCESS",
    "LOGIN_FAILED",
    "PASSWORD_RESET_REQUESTED",
    "PASSWORD_RESET_COMPLETED",
    // Onboarding & activation events
    "ONBOARDING_STARTED",
    "ONBOARDING_STEP_COMPLETED",
    "ONBOARDING_COMPLETED",
    "FIRST_PROPERTY_CREATED",
    "FIRST_CAPTURE_STARTED",
    "FIRST_SCENE_GENERATED",
    "FIRST_VIEW_SHARED",
    // Growth & referral events
    "REFERRAL_LINK_GENERATED",
    "REFERRAL_SIGNUP",
    "FEEDBACK_SUBMITTED",
    "NPS_SCORE_SUBMITTED",
    "SHARE_LINK_COPIED",
    "SHARE_QR_GENERATED",
  ];

  return validTypes.includes(eventType);
}

function sanitizeEvent(
  event: ClientEventInput,
  userId: string,
  orgId: string | null,
  requestUserAgent: string | null,
  requestIp: string | null,
): Record<string, unknown> {
  // Truncate metadata if too large
  let metadata = event.metadata || {};
  try {
    const serialized = JSON.stringify(metadata);
    if (serialized.length > MAX_METADATA_SIZE) {
      metadata = { _truncated: true, _original_size: serialized.length };
    }
  } catch (err) {
    console.error("[EventsAPI] Metadata serialization failed:", err);
    metadata = {};
  }

  // Prefer the client-provided device_type, fall back to server detection
  let deviceType = event.device_type || "unknown";
  if (!event.device_type && requestUserAgent) {
    const ua = requestUserAgent.toLowerCase();
    if (/mobile|iphone|ipod|android.*mobile/.test(ua)) {
      deviceType = "mobile";
    } else if (/ipad|tablet|android(?!.*mobile)/.test(ua)) {
      deviceType = "tablet";
    } else {
      deviceType = "desktop";
    }
  }

  // Prefer client-provided user_agent, fall back to request header
  const userAgent = (event.user_agent || requestUserAgent || "")
    .substring(0, MAX_USER_AGENT_LENGTH) || null;

  return {
    user_id: userId,
    org_id: orgId,
    event_type: event.event_type,
    metadata,
    session_id: event.session_id || null,
    property_id: event.property_id || null,
    scene_id: event.scene_id || null,
    device_type: deviceType,
    user_agent: userAgent,
    ip_address: requestIp,
  };
}

// ============================================
// IP extraction
// ============================================

function extractIpAddress(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;

  return null;
}

// ============================================
// GET — Health check
// ============================================

export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "/api/events" });
}

// ============================================
// POST — Track events
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

  // 2. Parse and validate request body
  let body: BatchEventRequest;
  try {
    body = await request.json();
  } catch (err) {
    console.error("[EventsAPI] JSON parse failed:", err);
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.events || !Array.isArray(body.events)) {
    return NextResponse.json(
      { error: "events array is required" },
      { status: 400 },
    );
  }

  if (body.events.length === 0) {
    return NextResponse.json(
      { error: "events array must not be empty" },
      { status: 400 },
    );
  }

  if (body.events.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} events` },
      { status: 400 },
    );
  }

  // 3. Validate individual events
  for (let i = 0; i < body.events.length; i++) {
    const event = body.events[i];
    if (!event || typeof event !== "object") {
      return NextResponse.json(
        { error: `Event at index ${i} must be an object` },
        { status: 400 },
      );
    }

    if (!event.event_type || typeof event.event_type !== "string") {
      return NextResponse.json(
        { error: `Event at index ${i} must have a valid event_type` },
        { status: 400 },
      );
    }

    if (!validateEventType(event.event_type)) {
      return NextResponse.json(
        { error: `Invalid event_type at index ${i}: ${event.event_type}` },
        { status: 400 },
      );
    }
  }

  // 4. Look up user's org membership
  const { data: orgMembership } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const orgId = orgMembership?.org_id || null;

  // 5. Extract request context
  const requestUserAgent = request.headers.get("user-agent");
  const requestIp = extractIpAddress(request);

  // 6. Sanitize and prepare events for insertion
  const rows = body.events.map((event) =>
    sanitizeEvent(event, user.id, orgId, requestUserAgent, requestIp),
  );

  // 7. Insert into events table
  const { data, error } = await supabase
    .from("events")
    .insert(rows)
    .select("id");

  if (error) {
    console.error("[/api/events] Insert failed:", error.message);
    return NextResponse.json(
      { error: "Failed to track events" },
      { status: 500 },
    );
  }

  // 8. Return success response
  return NextResponse.json({
    tracked: data?.length || 0,
    event_ids: data?.map((row: { id: string }) => row.id) || [],
  });
}
