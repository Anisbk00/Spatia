import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json({ error: "Invitation token is required" }, { status: 400 });
    }

    // Look up the invitation
    const { data: invitation, error: inviteError } = await supabase
      .from("invitations")
      .select("id, org_id, email, role, status, expires_at")
      .eq("token", token)
      .single();

    if (inviteError || !invitation) {
      return NextResponse.json({ error: "Invalid invitation token" }, { status: 404 });
    }

    // Check if invitation is still valid
    if (invitation.status !== "pending") {
      return NextResponse.json(
        { error: `Invitation has already been ${invitation.status}` },
        { status: 410 }
      );
    }

    if (new Date(invitation.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from("invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      return NextResponse.json({ error: "Invitation has expired" }, { status: 410 });
    }

    // Get the authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Please sign in to accept this invitation", requireAuth: true },
        { status: 401 }
      );
    }

    // Verify the user's email matches the invitation
    if (user.email !== invitation.email) {
      return NextResponse.json(
        { error: "This invitation was sent to a different email address" },
        { status: 403 }
      );
    }

    // Check if already a member
    const { data: existingMember } = await supabase
      .from("organization_members")
      .select("id")
      .eq("org_id", invitation.org_id)
      .eq("user_id", user.id)
      .single();

    if (existingMember) {
      // Mark invitation as accepted
      await supabase
        .from("invitations")
        .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: user.id })
        .eq("id", invitation.id);
      return NextResponse.json({ message: "Already a member of this organization" });
    }

    // Add user as a member
    const { error: insertError } = await supabase
      .from("organization_members")
      .insert({
        org_id: invitation.org_id,
        user_id: user.id,
        role: invitation.role,
      });

    if (insertError) {
      console.error("[AcceptInvitation] Failed to add member:", insertError);
      return NextResponse.json({ error: "Failed to join organization" }, { status: 500 });
    }

    // Mark invitation as accepted
    await supabase
      .from("invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: user.id,
      })
      .eq("id", invitation.id);

    return NextResponse.json({
      success: true,
      message: "Invitation accepted",
      orgId: invitation.org_id,
      role: invitation.role,
    });
  } catch (error) {
    console.error("[AcceptInvitation] Error accepting invitation:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
