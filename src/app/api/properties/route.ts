import { createClient } from "@/lib/supabase/server";
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

  // 3. Ensure user has a profile row in public.users
  //    (OAuth users may not have one yet if onboarding wasn't completed)
  let orgId: string | null = null;

  const { data: existingProfile } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!existingProfile) {
    // Auto-create profile row so FK constraints on properties/capture_sessions are satisfied
    const { error: profileError } = await supabase
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

  // 4. Fetch org membership (gracefully handle missing)
  try {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("org_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    orgId = membership?.org_id ?? null;
  } catch {
    // User may not have an org membership yet — that's OK
  }

  // 5. Parse and validate input
  const body: CreatePropertyInput = await request.json();
  const errors: FieldErrors = {};

  if (!body.title?.trim()) {
    errors.title = "Property title is required";
  }

  if (body.price !== undefined && body.price !== null && body.price < 0) {
    errors.price = "Price cannot be negative";
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  // 6. Create property
  const { data: property, error: propertyError } = await supabase
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

  if (propertyError || !property) {
    console.error("[Properties API] Property insert error:", propertyError);
    return NextResponse.json(
      { error: "Failed to create property" },
      { status: 500 }
    );
  }

  // 7. Update property status to 'capturing'
  await supabase
    .from("properties")
    .update({ status: "capturing" })
    .eq("id", property.id);

  // 8. Create capture session
  const { data: session, error: sessionError } = await supabase
    .from("capture_sessions")
    .insert({
      property_id: property.id,
      created_by: user.id,
      status: "started",
    })
    .select()
    .single();

  if (sessionError || !session) {
    console.error("[Properties API] Session insert error:", sessionError);
    // Rollback: archive the property if session creation fails
    await supabase
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
