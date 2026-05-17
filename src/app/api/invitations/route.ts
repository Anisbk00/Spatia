import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

function generateInvitationToken(): string {
  return randomBytes(32).toString("hex");
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const dataClient = adminClient || supabase;

    const body = await request.json();
    const { email, role, orgId } = body;

    if (!email || !role || !orgId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // Verify the inviter is a member of the org with owner/agent role
    const { data: membership } = await dataClient
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .single();

    if (!membership || (membership.role !== "owner" && membership.role !== "agent")) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    // Check for existing pending invitation to this email for this org
    const { data: existingInvitation } = await dataClient
      .from("invitations")
      .select("id, status, expires_at")
      .eq("org_id", orgId)
      .eq("email", email)
      .eq("status", "pending")
      .single();

    if (existingInvitation) {
      // Check if it's still valid
      const expiresAt = new Date(existingInvitation.expires_at);
      if (expiresAt > new Date()) {
        return NextResponse.json(
          { error: "A pending invitation already exists for this email" },
          { status: 409 }
        );
      }
      // Expired — mark it and create a new one
      await dataClient
        .from("invitations")
        .update({ status: "expired" })
        .eq("id", existingInvitation.id);
    }

    // Check if user already exists
    const { data: existingUser } = await dataClient
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existingUser) {
      // Check if already a member
      const { data: existingMember } = await dataClient
        .from("organization_members")
        .select("id")
        .eq("org_id", orgId)
        .eq("user_id", existingUser.id)
        .single();

      if (existingMember) {
        return NextResponse.json({ error: "User is already a member" }, { status: 409 });
      }

      // Add existing user as member directly
      const { error: insertError } = await dataClient
        .from("organization_members")
        .insert({
          org_id: orgId,
          user_id: existingUser.id,
          role: role,
        });

      if (insertError) {
        return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: "Member added directly" });
    }

    // User doesn't exist yet — create invitation
    const token = generateInvitationToken();
    const { data: invitation, error: inviteError } = await dataClient
      .from("invitations")
      .insert({
        org_id: orgId,
        invited_by: user.id,
        email,
        role,
        token,
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      })
      .select("id, token, expires_at")
      .single();

    if (inviteError || !invitation) {
      console.error("[InvitationsAPI] Failed to create invitation:", inviteError);
      return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 });
    }

    // TODO: Send invitation email with magic link
    // The invitation link would be: `${APP_URL}/auth/invite?token=${invitation.token}`
    // For now, return the token so the caller can construct the link

    return NextResponse.json({
      success: true,
      message: "Invitation created. The user will be added once they sign up.",
      invitation: {
        id: invitation.id,
        token: invitation.token,
        expiresAt: invitation.expires_at,
      },
    });
  } catch (error) {
    console.error("[InvitationsAPI] Error creating invitation:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET: List invitations for an org
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const dataClient = adminClient || supabase;

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");

    if (!orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    // Verify the user is a member of the org
    const { data: membership } = await dataClient
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const { data: invitations, error } = await dataClient
      .from("invitations")
      .select("id, email, role, status, expires_at, accepted_at, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch invitations" }, { status: 500 });
    }

    return NextResponse.json({ invitations });
  } catch (error) {
    console.error("[InvitationsAPI] Error listing invitations:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
