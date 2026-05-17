// ============================================
// GET /api/auth/check-email
// ============================================
// Checks whether a given email already has an
// account. Uses service-role key server-side so
// we can query the users table bypassing RLS.
// Rate-limited to prevent enumeration abuse.
// ============================================

import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// Simple in-memory rate limiter (per-IP, 10 req / 60 s)
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT;
}

export async function GET(request: NextRequest) {
  // ── Rate limit ──
  const ip =
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    "unknown";

  if (isRateLimited(ip.trim())) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // ── Validate email param ──
  const email = request.nextUrl.searchParams.get("email");

  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { error: "Email parameter is required" },
      { status: 400 },
    );
  }

  const trimmed = email.trim().toLowerCase();

  // Basic format check — don't query DB for obviously invalid emails
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(trimmed)) {
    return NextResponse.json({ exists: false });
  }

  // ── Query users table with service-role key ──
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    // Graceful degradation — don't block signup if key is missing
    return NextResponse.json({ exists: false });
  }

  const admin = createSupabaseAdmin(supabaseUrl, serviceRoleKey);

  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("email", trimmed)
    .maybeSingle();

  if (error) {
    // Never expose internal errors — treat as "not found" to avoid blocking signup
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({ exists: !!data });
}
