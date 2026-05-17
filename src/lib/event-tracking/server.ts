// ============================================
// Server-Side Event Tracking
// ============================================
// Direct Supabase insertion for server contexts:
// - No buffering (immediate persistence)
// - Extracts device_type from User-Agent header
// - Captures IP address for geo analytics
// - Uses Supabase server client with auth context
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { Event } from "@/lib/types";
import { EVENT_TYPES } from "./index";

// ============================================
// User-Agent parsing
// ============================================

/**
 * Extract device type from a User-Agent string.
 *
 * Simple heuristic-based detection:
 * - mobile: phones
 * - tablet: iPads, Android tablets
 * - desktop: everything else
 *
 * @param userAgent - The User-Agent header value
 * @returns Detected device type string
 */
export function extractDeviceType(userAgent: string | null): string {
  if (!userAgent) return "unknown";

  const ua = userAgent.toLowerCase();

  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/.test(ua)) {
    return "mobile";
  }
  if (/ipad|tablet|android(?!.*mobile)/.test(ua)) {
    return "tablet";
  }
  return "desktop";
}

/**
 * Truncate user agent string for storage.
 * We keep the first 256 characters which contain the most useful info.
 */
function truncateUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;
  return userAgent.substring(0, 256);
}

// ============================================
// IP Address extraction
// ============================================

/**
 * Extract client IP address from a Next.js request.
 *
 * Checks multiple headers to handle proxies and CDNs:
 * 1. x-forwarded-for (standard proxy header)
 * 2. x-real-ip (Nginx)
 * 3. cf-connecting-ip (Cloudflare)
 *
 * @param request - The Next.js request object
 * @returns The client IP address or null
 */
export function extractIpAddress(request: Request): string | null {
  // x-forwarded-for may contain multiple IPs; take the first (original client)
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  // x-real-ip (Nginx proxy)
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  // Cloudflare connecting IP
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;

  return null;
}

// ============================================
// Server-side event tracking
// ============================================

/**
 * Track an event from a server-side context.
 *
 * Inserts directly into the events table with Supabase server client.
 * Automatically extracts device_type and IP address from the request.
 *
 * @param eventType - The event type (use EVENT_TYPES constants)
 * @param metadata - Additional event metadata
 * @param userId - The user ID
 * @param orgId - The organization ID
 * @param request - Optional Next.js request (for IP + device extraction)
 * @returns The inserted event row or null on failure
 */
export async function trackServerEvent(
  eventType: string,
  metadata: Record<string, unknown> = {},
  userId?: string | null,
  orgId?: string | null,
  request?: Request | null,
): Promise<Event | null> {
  const supabase = await createClient();
  if (!supabase) {
    console.warn("[trackServerEvent] Supabase not configured, event not tracked");
    return null;
  }

  // Extract request-derived data
  const userAgent = request?.headers?.get("user-agent") ?? null;
  const deviceType = extractDeviceType(userAgent);
  const ipAddress = request ? extractIpAddress(request) : null;

  // Validate IP address format for PostgreSQL inet type
  const isValidInet = (ip: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(ip);
  const safeIpAddress = ipAddress && isValidInet(ipAddress) ? ipAddress : null;

  const insertData = {
    user_id: userId || null,
    org_id: orgId || null,
    event_type: eventType,
    metadata,
    device_type: deviceType,
    user_agent: truncateUserAgent(userAgent),
    ip_address: safeIpAddress,
  };

  const { data, error } = await supabase
    .from("events")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    console.error("[trackServerEvent] Failed to insert event:", {
      eventType,
      error: error.message,
    });
    return null;
  }

  return data as Event;
}

/**
 * Track multiple events in a single batch from server-side.
 *
 * Useful for bulk event ingestion (e.g., syncing offline captures).
 *
 * @param events - Array of event data to insert
 * @param userId - Common user ID for all events
 * @param orgId - Common org ID for all events
 * @param request - Optional request for IP + device extraction
 * @returns Number of successfully inserted events
 */
export async function trackServerEventBatch(
  events: Array<{
    event_type: string;
    metadata?: Record<string, unknown>;
    session_id?: string | null;
    property_id?: string | null;
    scene_id?: string | null;
  }>,
  userId?: string | null,
  orgId?: string | null,
  request?: Request | null,
): Promise<number> {
  const supabase = await createClient();
  if (!supabase) return 0;

  const userAgent = request?.headers?.get("user-agent") ?? null;
  const deviceType = extractDeviceType(userAgent);
  const ipAddress = request ? extractIpAddress(request) : null;

  // Validate IP address format for PostgreSQL inet type
  const isValidInet = (ip: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(ip);
  const safeIpAddress = ipAddress && isValidInet(ipAddress) ? ipAddress : null;

  const rows = events.map((event) => ({
    user_id: userId || null,
    org_id: orgId || null,
    event_type: event.event_type,
    metadata: event.metadata || {},
    session_id: event.session_id || null,
    property_id: event.property_id || null,
    scene_id: event.scene_id || null,
    device_type: deviceType,
    user_agent: truncateUserAgent(userAgent),
    ip_address: safeIpAddress,
  }));

  const { data, error } = await supabase
    .from("events")
    .insert(rows)
    .select();

  if (error) {
    console.error("[trackServerEventBatch] Batch insert failed:", {
      count: events.length,
      error: error.message,
    });
    return 0;
  }

  return data?.length || 0;
}

// Re-export EVENT_TYPES for convenience
export { EVENT_TYPES };
