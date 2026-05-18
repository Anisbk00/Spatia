// ============================================
// POST /api/analytics
// ============================================
// Public, privacy-safe analytics endpoint for
// landing page and marketing events.
// No authentication required.
// ============================================

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// ============================================
// Types
// ============================================

interface AnalyticsEvent {
  event_type: string;
  metadata?: Record<string, unknown>;
  device_type?: string;
  user_agent?: string;
}

interface AnalyticsRequest {
  events: AnalyticsEvent[];
}

// ============================================
// Constants
// ============================================

const MAX_BATCH_SIZE = 10;
const MAX_METADATA_SIZE = 4_096; // 4KB for anonymous events (stricter than authenticated)
const MAX_USER_AGENT_LENGTH = 128;

// Only allow these specific anonymous event types
const ALLOWED_ANONYMOUS_TYPES = [
  "LANDING_PAGE_VIEW",
  "CTA_CLICK",
  "DEMO_OPENED",
  "SIGNUP_STARTED",
] as const;

// Rate limiting (in-memory, per-IP)
// NOTE: In-memory rate limiting is only effective for single-instance deployments.
// TODO: For distributed/multi-server deployments, use Redis or a shared rate-limit store.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30; // 30 requests per window
const RATE_LIMIT_WINDOW = 60_000; // 1 minute

// ============================================
// Helpers
// ============================================

function isAllowedType(eventType: string): boolean {
  return (ALLOWED_ANONYMOUS_TYPES as readonly string[]).includes(eventType);
}

function detectDeviceType(ua: string): string {
  const lower = ua.toLowerCase();
  if (/mobile|iphone|ipod|android.*mobile/.test(lower)) return "mobile";
  if (/ipad|tablet|android(?!.*mobile)/.test(lower)) return "tablet";
  return "desktop";
}

function extractIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip) return ip;
  }
  return request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || null;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// Clean up expired entries periodically
if (typeof globalThis !== "undefined") {
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetAt) {
        rateLimitMap.delete(key);
      }
    }
  }, 120_000);

  // Don't prevent the Node.js process from exiting
  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }
}

// ============================================
// Sanitize — strip PII and limit sizes
// ============================================

function sanitizeAnonymousEvent(
  event: AnalyticsEvent,
  requestUa: string | null,
  requestIp: string | null,
): Record<string, unknown> {
  // Sanitize metadata — remove any PII-like fields
  let metadata: Record<string, unknown> = {};
  if (event.metadata && typeof event.metadata === "object") {
    try {
      const serialized = JSON.stringify(event.metadata);
      if (serialized.length <= MAX_METADATA_SIZE) {
        metadata = { ...event.metadata };
        // Strip potential PII
        delete metadata.email;
        delete metadata.name;
        delete metadata.phone;
        delete metadata.address;
        delete metadata.userId;
        delete metadata.user_id;
      }
    } catch {
      metadata = {};
    }
  }

  // Device type detection
  const ua = requestUa || "";
  const deviceType = event.device_type || detectDeviceType(ua);

  // Truncate user agent
  const userAgent = (event.user_agent || ua).substring(0, MAX_USER_AGENT_LENGTH) || null;

  // IP address: must be valid inet format or null for Supabase
  const ipAddress = requestIp && /^\d{1,3}(\.\d{1,3}){3}$/.test(requestIp) ? requestIp : null;

  return {
    user_id: null, // anonymous
    org_id: null,
    event_type: event.event_type,
    metadata,
    session_id: null,
    property_id: null,
    scene_id: null,
    device_type: deviceType,
    user_agent: userAgent,
    ip_address: ipAddress,
  };
}

// ============================================
// GET — Health check
// ============================================

export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "/api/analytics" });
}

// ============================================
// POST — Track anonymous analytics events
// ============================================

export async function POST(request: NextRequest) {
  // 1. Rate limit by IP
  const clientIp = extractIp(request) || "unknown";
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  // 2. Parse request body
  let body: AnalyticsRequest;
  try {
    body = await request.json();
  } catch {
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

  if (body.events.length === 0 || body.events.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `events array must contain 1-${MAX_BATCH_SIZE} events` },
      { status: 400 },
    );
  }

  // 3. Validate event types
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

    if (!isAllowedType(event.event_type)) {
      return NextResponse.json(
        { error: `Invalid event_type at index ${i}: ${event.event_type}` },
        { status: 400 },
      );
    }
  }

  // 4. Connect to Supabase (service role for anonymous inserts)
  const supabase = await createClient();
  if (!supabase) {
    // Silently succeed — analytics should never break UX
    return NextResponse.json({ tracked: 0, anonymous: true });
  }

  // 5. Sanitize and prepare events
  const requestUa = request.headers.get("user-agent");
  const requestIp = extractIp(request);

  const rows = body.events.map((event) =>
    sanitizeAnonymousEvent(event, requestUa, requestIp),
  );

  // 6. Insert into events table
  try {
    const { data, error } = await supabase
      .from("events")
      .insert(rows)
      .select("id");

    if (error) {
      console.error("[/api/analytics] Insert failed:", error.message);
      // Still return 200 to not break client — analytics is best-effort
      return NextResponse.json({ tracked: 0, anonymous: true });
    }

    return NextResponse.json({
      tracked: data?.length || 0,
      anonymous: true,
    });
  } catch {
    // Never throw for analytics
    return NextResponse.json({ tracked: 0, anonymous: true });
  }
}
