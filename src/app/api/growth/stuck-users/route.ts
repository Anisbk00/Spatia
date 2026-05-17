// ============================================
// GET /api/growth/stuck-users
// ============================================
// Admin-only endpoint that finds users who signed up
// but never completed activation (no FIRST_PROPERTY_CREATED
// event within 48 hours of signup).
// ============================================

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// ============================================
// Response types
// ============================================

interface StuckUser {
  user_id: string;
  email: string;
  signed_up_at: string;
  days_since_signup: number;
}

// ============================================
// GET — Find stuck users (admin only)
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

  // 2. Check for admin role
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (userError || !userData || userData.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden: admin access required" },
      { status: 403 },
    );
  }

  // 3. Find users who signed up but never activated
  // We look for users whose created_at is more than 48 hours ago
  // and who have no FIRST_PROPERTY_CREATED event.
  const fortyEightHoursAgo = new Date(
    Date.now() - 48 * 60 * 60 * 1000,
  ).toISOString();

  // Get all users who signed up more than 48 hours ago
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, email, created_at")
    .lt("created_at", fortyEightHoursAgo);

  if (usersError) {
    console.error("[/api/growth/stuck-users] Users query failed:", usersError.message);
    return NextResponse.json(
      { error: "Failed to query users" },
      { status: 500 },
    );
  }

  if (!users || users.length === 0) {
    return NextResponse.json({ stuck_users: [] });
  }

  // Get user IDs that have FIRST_PROPERTY_CREATED events
  const userIds = users.map((u) => u.id);

  const { data: activatedEvents, error: eventsError } = await supabase
    .from("events")
    .select("user_id")
    .in("user_id", userIds)
    .eq("event_type", "FIRST_PROPERTY_CREATED");

  if (eventsError) {
    console.error("[/api/growth/stuck-users] Events query failed:", eventsError.message);
    return NextResponse.json(
      { error: "Failed to query events" },
      { status: 500 },
    );
  }

  // Build a set of activated user IDs for O(1) lookup
  const activatedUserIds = new Set(
    (activatedEvents || []).map((e) => e.user_id),
  );

  // Filter out activated users
  const stuckUsers: StuckUser[] = users
    .filter((u) => !activatedUserIds.has(u.id))
    .map((u) => ({
      user_id: u.id,
      email: u.email,
      signed_up_at: u.created_at,
      days_since_signup: Math.floor(
        (Date.now() - new Date(u.created_at).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    }));

  return NextResponse.json({ stuck_users: stuckUsers });
}
