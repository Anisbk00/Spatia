import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { CreatePropertyInput, CreatePropertyResponse, FieldErrors } from "@/lib/types";

export async function POST(request: NextRequest) {
  // 1. Verify Supabase is configured
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    console.error("[Properties API] Failed to create Supabase client:", err);
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 }
    );
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 }
    );
  }

  // 2. Authenticate user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use admin client for ALL data operations to bypass RLS
  const adminClient = createAdminClient();
  const dataClient = adminClient || supabase;

  // 3. Ensure user has a profile row in public.users
  //    (OAuth users may not have one yet if onboarding wasn't completed)
  let orgId: string | null = null;

  const { data: existingProfile, error: profileQueryError } = await dataClient
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileQueryError) {
    console.error("[Properties API] Profile query error:", profileQueryError);
  }

  if (!existingProfile) {
    // Auto-create profile row so FK constraints on properties/capture_sessions are satisfied
    const { error: profileError } = await dataClient
      .from("users")
      .insert({
        id: user.id,
        email: user.email ?? "",
        full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
        role: "client",
      });

    if (profileError) {
      console.error("[Properties API] Failed to create user profile:", profileError);
      return NextResponse.json(
        { error: "Failed to set up user profile. Please try again." },
        { status: 500 }
      );
    }
  }

  // 3b. Verify user has agent/admin role
  const { data: profile } = await dataClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden — agent/admin required" }, { status: 403 });
  }

  // 4. Fetch org membership — use admin client to bypass potential RLS on organization_members
  try {
    const { data: membership, error: memberError } = await dataClient
      .from("organization_members")
      .select("org_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (memberError) {
      console.error("[Properties API] Org membership query error:", memberError);
    }
    orgId = membership?.org_id ?? null;
  } catch (err) {
    // User may not have an org membership yet — that's OK
    console.error("[Properties API] Org membership catch:", err);
  }

  // 5. Parse and validate input
  let body: CreatePropertyInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 }
    );
  }

  const errors: FieldErrors = {};

  const VALID_PROPERTY_TYPES = ["apartment", "house", "condo", "commercial", "land", "villa", "office", "other"];

  if (!body.title?.trim()) {
    errors.title = "Property title is required";
  }

  if (body.property_type && !VALID_PROPERTY_TYPES.includes(body.property_type)) {
    errors.property_type = `property_type must be one of: ${VALID_PROPERTY_TYPES.join(", ")}`;
  }

  if (body.price !== undefined && body.price !== null && body.price < 0) {
    errors.price = "Price cannot be negative";
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  // 6. Create property — use admin client to bypass RLS
  //    Wrap property+session creation in try/catch with rollback on failure
  let property: any;
  let propertyError: any;

  try {
    const result = await dataClient
      .from("properties")
      .insert({
        org_id: orgId,
        created_by: user.id,
        title: body.title.trim(),
        address: body.address?.trim() || null,
        property_type: body.property_type || null,
        price: body.price || null,
        description: body.description?.trim() || null,
        status: "draft",
      })
      .select()
      .single();

    property = result.data;
    propertyError = result.error;
  } catch (err) {
    console.error("[Properties API] Property insert exception:", err);
    return NextResponse.json(
      { error: "Failed to create property" },
      { status: 500 }
    );
  }

  if (propertyError || !property) {
    console.error("[Properties API] Property insert error:", propertyError);
    return NextResponse.json(
      { error: "Failed to create property" },
      { status: 500 }
    );
  }

  // 7. Update property status to 'capturing'
  const { error: statusUpdateError } = await dataClient
    .from("properties")
    .update({ status: "capturing" })
    .eq("id", property.id);

  if (statusUpdateError) {
    console.error("[Properties API] Status update error:", statusUpdateError);
    // Rollback: delete the property if status update fails
    await dataClient
      .from("properties")
      .delete()
      .eq("id", property.id);
    return NextResponse.json(
      { error: "Failed to create property" },
      { status: 500 }
    );
  }

  // 8. Create capture session
  let session: any;
  let sessionError: any;

  try {
    const result = await dataClient
      .from("capture_sessions")
      .insert({
        property_id: property.id,
        created_by: user.id,
        status: "started",
      })
      .select()
      .single();

    session = result.data;
    sessionError = result.error;
  } catch (err) {
    console.error("[Properties API] Session insert exception:", err);
    // Rollback: archive the property
    await dataClient
      .from("properties")
      .update({ status: "draft" })
      .eq("id", property.id);
    return NextResponse.json(
      { error: "Failed to create capture session" },
      { status: 500 }
    );
  }

  if (sessionError || !session) {
    console.error("[Properties API] Session insert error:", sessionError);
    // Rollback: archive the property if session creation fails
    await dataClient
      .from("properties")
      .update({ status: "draft" })
      .eq("id", property.id);

    return NextResponse.json(
      { error: "Failed to create capture session" },
      { status: 500 }
    );
  }

  // 9. Return both records
  const response: CreatePropertyResponse = { property, session };
  return NextResponse.json(response, { status: 201 });
}
