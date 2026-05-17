import { createClient } from "@/lib/supabase/server";
import { rateLimiter } from "@/lib/security/rate-limit";

// ============================================
// Types
// ============================================

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

interface PropertyOrgJoinResult {
  org_id: string;
}

// ============================================
// validateOrgOwnership
// ============================================

/**
 * Verifies user is a member of the org that owns the property.
 */
export async function validateOrgOwnership(
  userId: string,
  propertyId: string
): Promise<boolean> {
  const supabase = await createClient();
  if (!supabase) return false;

  // Get the property's org_id
  const { data: property } = await supabase
    .from("properties")
    .select("org_id")
    .eq("id", propertyId)
    .single();

  if (!property?.org_id) return false;

  // Check if user is a member of that org
  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("org_id", property.org_id)
    .eq("user_id", userId)
    .single();

  return !!membership;
}

// ============================================
// validateSessionOwnership
// ============================================

/**
 * Verifies user's org owns the capture session.
 */
export async function validateSessionOwnership(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const supabase = await createClient();
  if (!supabase) return false;

  // Get the session's property and through it the org
  const { data: session } = await supabase
    .from("capture_sessions")
    .select("property_id, properties!inner(org_id)")
    .eq("id", sessionId)
    .single();

  if (!session) return false;

  const orgId = (session.properties as unknown as PropertyOrgJoinResult)?.org_id;
  if (!orgId) return false;

  // Check if user is a member of that org
  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single();

  return !!membership;
}

// ============================================
// getSignedStorageUrl
// ============================================

/**
 * Generates a signed URL for private storage access.
 */
export async function getSignedStorageUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600
): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data) return null;

  return data.signedUrl;
}

// ============================================
// validateStorageAccess
// ============================================

/**
 * Checks if user should access a storage path.
 * Validates that the user belongs to the org that owns the resource
 * referenced in the storage path.
 *
 * Expected path format: {org_id}/{resource_type}/{resource_id}/{filename}
 * or: uploads/{org_id}/{session_id}/{filename}
 */
export async function validateStorageAccess(
  userId: string,
  storagePath: string
): Promise<boolean> {
  const supabase = await createClient();
  if (!supabase) return false;

  // Parse org_id from the storage path
  const parts = storagePath.split("/");
  let orgId: string | undefined;

  // Pattern: uploads/{org_id}/... or {org_id}/...
  if (parts[0] === "uploads" && parts.length >= 2) {
    orgId = parts[1];
  } else if (parts.length >= 1) {
    orgId = parts[0];
  }

  if (!orgId) return false;

  // Check if user is a member of that org
  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single();

  return !!membership;
}

// ============================================
// checkRateLimit
// ============================================

/**
 * Persistent rate limiter with file-based storage.
 * Tracks requests per identifier per action per time window.
 *
 * Returns { allowed, remaining, resetAt }
 *
 * Used for: upload endpoints (100/min), API calls (300/min)
 */
export function checkRateLimit(
  identifier: string,
  action: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const key = `${action}:${identifier}`;
  return rateLimiter.check(key, limit, windowMs);
}

// ============================================
// Predefined rate limit configs
// ============================================

export const RATE_LIMITS = {
  UPLOAD: { limit: 100, windowMs: 60 * 1000 },        // 100/min
  API: { limit: 300, windowMs: 60 * 1000 },            // 300/min
  CAPTURE_START: { limit: 10, windowMs: 60 * 1000 },   // 10/min
  PROCESSING_START: { limit: 20, windowMs: 60 * 1000 }, // 20/min
  AUTH: { limit: 10, windowMs: 15 * 60 * 1000 },       // 10/15min
} as const;
