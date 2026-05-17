// ============================================
// POST /api/feedback
// ============================================
// Accepts feedback submissions (bug, feature, NPS, capture, general),
// validates auth, inserts into feedback_events, and tracks events.
// ============================================

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { trackServerEvent, EVENT_TYPES } from "@/lib/event-tracking/server";
import { NextRequest, NextResponse } from "next/server";
import type { FeedbackType, FeedbackSentiment } from "@/lib/types";

// ============================================
// Request / Response types
// ============================================

interface FeedbackRequest {
  type: FeedbackType;
  sentiment?: FeedbackSentiment;
  rating?: number;
  comment?: string;
  property_id?: string;
  metadata?: Record<string, unknown>;
}

const VALID_FEEDBACK_TYPES: FeedbackType[] = ["bug", "feature", "nps", "capture", "general"];
const VALID_SENTIMENTS: FeedbackSentiment[] = ["positive", "neutral", "negative"];

// ============================================
// POST — Submit feedback
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

  const adminClient = createAdminClient();
  const dataClient = adminClient || supabase;

  // 2. Parse and validate request body
  let body: FeedbackRequest;
  try {
    body = await request.json();
  } catch (err) {
    console.error("[FeedbackAPI] JSON parse failed:", err);
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Validate type
  if (!body.type || !VALID_FEEDBACK_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_FEEDBACK_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  // Validate sentiment if provided
  if (body.sentiment && !VALID_SENTIMENTS.includes(body.sentiment)) {
    return NextResponse.json(
      { error: `sentiment must be one of: ${VALID_SENTIMENTS.join(", ")}` },
      { status: 400 },
    );
  }

  // Validate rating if provided
  if (body.rating !== undefined) {
    if (typeof body.rating !== "number" || body.rating < 0 || body.rating > 10 || !Number.isInteger(body.rating)) {
      return NextResponse.json(
        { error: "rating must be an integer between 0 and 10" },
        { status: 400 },
      );
    }
  }

  // Validate NPS type requires rating
  if (body.type === "nps" && body.rating === undefined) {
    return NextResponse.json(
      { error: "rating is required for NPS feedback" },
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

  // 4. Insert into feedback_events table
  const insertData = {
    user_id: user.id,
    org_id: orgId,
    property_id: body.property_id || null,
    type: body.type,
    sentiment: body.sentiment || null,
    rating: body.rating !== undefined ? body.rating : null,
    comment: body.comment || null,
    metadata: body.metadata || {},
  };

  const { data, error } = await dataClient
    .from("feedback_events")
    .insert(insertData)
    .select("id")
    .single();

  if (error) {
    console.error("[/api/feedback] Insert failed:", error.message);
    return NextResponse.json(
      { error: "Failed to submit feedback" },
      { status: 500 },
    );
  }

  // 5. Track appropriate event
  const eventType = body.type === "nps"
    ? EVENT_TYPES.NPS_SCORE_SUBMITTED
    : EVENT_TYPES.FEEDBACK_SUBMITTED;

  await trackServerEvent(
    eventType,
    {
      feedback_id: data.id,
      feedback_type: body.type,
      sentiment: body.sentiment || null,
      rating: body.rating !== undefined ? body.rating : null,
      has_comment: !!body.comment,
      property_id: body.property_id || null,
    },
    user.id,
    orgId,
    request,
  );

  // 6. Return success response
  return NextResponse.json({
    success: true,
    id: data.id,
  });
}
