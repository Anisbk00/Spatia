import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ensure user has a profile row (for FK constraints)
  const { data: existingProfile } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!existingProfile) {
    const { error: profileError } = await supabase
      .from("users")
      .insert({
        id: user.id,
        email: user.email ?? "",
        full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
        role: "client",
      });

    if (profileError) {
      console.error("[VideoSession] Failed to create user profile:", profileError);
      return NextResponse.json(
        { error: "Failed to set up user profile. Please try again." },
        { status: 500 }
      );
    }
  }

  // Get org_id
  let orgId: string | null = null;
  const { data: membership } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  orgId = membership?.org_id ?? null;

  const body = await request.json();
  const { title, address, property_type, price, description } = body;

  if (!title?.trim()) {
    return NextResponse.json({ error: "Property title is required" }, { status: 422 });
  }

  // Create property
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .insert({
      org_id: orgId,
      created_by: user.id,
      title: title.trim(),
      address: address?.trim() || null,
      property_type: property_type || null,
      price: price || null,
      description: description?.trim() || null,
      status: "capturing",
    })
    .select()
    .single();

  if (propertyError || !property) {
    console.error("[VideoSession] Property insert error:", propertyError);
    return NextResponse.json({ error: "Failed to create property" }, { status: 500 });
  }

  // Create capture session (video mode)
  const { data: session, error: sessionError } = await supabase
    .from("capture_sessions")
    .insert({
      property_id: property.id,
      created_by: user.id,
      status: "started",
      capture_type: "video",
      device_type: "phone_video",
    })
    .select()
    .single();

  if (sessionError || !session) {
    console.error("[VideoSession] Session insert error:", sessionError);
    // Rollback: archive the property
    await supabase
      .from("properties")
      .update({ status: "draft" })
      .eq("id", property.id);

    return NextResponse.json({ error: "Failed to create capture session" }, { status: 500 });
  }

  return NextResponse.json({
    property_id: property.id,
    session_id: session.id,
  }, { status: 201 });
}
