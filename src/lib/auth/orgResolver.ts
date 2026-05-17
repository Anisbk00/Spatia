import { createClient } from "@/lib/supabase/server";
import type {
  Organization,
  OrganizationMember,
  OrgRole,
} from "@/lib/types";

// ============================================
// Types
// ============================================

export interface OrgResolution {
  organization: Organization | null;
  membership: OrganizationMember | null;
  members: OrganizationMember[];
}

export interface OrgResult<T> {
  data: T;
  error: string | null;
}

// ============================================
// Organization resolution
// ============================================

/**
 * Resolve the user's primary organization membership.
 * Returns the first organization the user belongs to, along with
 * their membership record and all members of that org.
 *
 * If the user has no org membership, returns nulls.
 */
export async function resolveUserOrg(
  userId: string,
): Promise<OrgResult<OrgResolution>> {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return {
        data: { organization: null, membership: null, members: [] },
        error: "auth.errorServiceNotConfigured",
      };
    }

    // 1. Find the user's first org membership (owner > agent > viewer priority)
    const { data: memberships, error: memberError } = await supabase
      .from("organization_members")
      .select("*, organizations(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (memberError) {
      return {
        data: { organization: null, membership: null, members: [] },
        error: "auth.errorOrgResolutionFailed",
      };
    }

    if (!memberships || memberships.length === 0) {
      return {
        data: { organization: null, membership: null, members: [] },
        error: null,
      };
    }

    // Pick the first membership — prefer owner role
    const ownerMembership = memberships.find(
      (m: Record<string, unknown>) => m.role === "owner",
    );
    const primaryMembership = (ownerMembership ?? memberships[0]) as OrganizationMember & {
      organizations: Organization | null;
    };

    const organization = primaryMembership.organizations as Organization | null;

    // 2. Get all members of that org
    let members: OrganizationMember[] = [];
    if (primaryMembership.org_id) {
      const { data: orgMembers } = await supabase
        .from("organization_members")
        .select("*")
        .eq("org_id", primaryMembership.org_id);

      members = (orgMembers as OrganizationMember[]) ?? [];
    }

    // Strip the joined organizations key from membership
    const { organizations: _, ...cleanMembership } = primaryMembership;

    return {
      data: {
        organization,
        membership: cleanMembership as unknown as OrganizationMember,
        members,
      },
      error: null,
    };
  } catch {
    return {
      data: { organization: null, membership: null, members: [] },
      error: "auth.errorOrgResolutionFailed",
    };
  }
}

// ============================================
// Organization creation
// ============================================

/**
 * Create a new organization and add the user as owner.
 * Also attempts to generate a referral code via RPC.
 *
 * @param userId — The user who will be the org owner
 * @param name — The organization name
 * @returns The created organization and owner membership
 */
export async function createOrganization(
  userId: string,
  name: string,
): Promise<
  OrgResult<{
    organization: Organization | null;
    membership: OrganizationMember | null;
  }>
> {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return {
        data: { organization: null, membership: null },
        error: "auth.errorServiceNotConfigured",
      };
    }

    // Generate referral code
    let referralCode = "";
    try {
      const { data: rpcCode } = await supabase.rpc("generate_referral_code");
      referralCode = rpcCode || "";
    } catch {
      // Fallback: generate a random code
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const arr = new Uint8Array(8);
      // Simple pseudo-random fallback for server-side (no crypto in this context)
      for (let i = 0; i < 8; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      referralCode = Array.from(arr, (b) => chars[b % chars.length]).join("");
    }

    // Create organization
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .insert({
        name: name.trim(),
        owner_id: userId,
        plan: "free",
        referral_code: referralCode,
      })
      .select()
      .single();

    if (orgError || !org) {
      return {
        data: { organization: null, membership: null },
        error: "auth.errorOrgCreationFailed",
      };
    }

    // Add owner membership
    const { data: membership, error: memberError } = await supabase
      .from("organization_members")
      .insert({
        org_id: org.id,
        user_id: userId,
        role: "owner" as OrgRole,
      })
      .select()
      .single();

    if (memberError) {
      // Org was created but membership failed — still return the org
      return {
        data: { organization: org as Organization, membership: null },
        error: "auth.errorMembershipCreationFailed",
      };
    }

    return {
      data: {
        organization: org as Organization,
        membership: membership as OrganizationMember,
      },
      error: null,
    };
  } catch {
    return {
      data: { organization: null, membership: null },
      error: "auth.errorOrgCreationFailed",
    };
  }
}

// ============================================
// Ensure org membership
// ============================================

/**
 * Ensure the user has at least one org membership.
 * If they have none, create a default "Personal" org with
 * the user as owner.
 *
 * This is useful for OAuth users who sign up directly
 * without going through onboarding.
 */
export async function ensureOrgMembership(
  userId: string,
): Promise<OrgResult<OrgResolution>> {
  try {
    // First, check if user already has an org
    const existing = await resolveUserOrg(userId);
    if (existing.error) {
      return existing;
    }

    if (existing.data.organization) {
      return existing;
    }

    // User has no org — create a default one
    // Fetch user email for the org name
    const supabase = await createClient();
    if (!supabase) {
      return {
        data: { organization: null, membership: null, members: [] },
        error: "auth.errorServiceNotConfigured",
      };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const orgName = user?.email
      ? `${user.email.split("@")[0]}'s Agency`
      : "My Agency";

    const createResult = await createOrganization(userId, orgName);
    if (createResult.error || !createResult.data.organization) {
      return {
        data: { organization: null, membership: null, members: [] },
        error: createResult.error ?? "auth.errorOrgCreationFailed",
      };
    }

    return {
      data: {
        organization: createResult.data.organization,
        membership: createResult.data.membership,
        members: createResult.data.membership
          ? [createResult.data.membership]
          : [],
      },
      error: null,
    };
  } catch {
    return {
      data: { organization: null, membership: null, members: [] },
      error: "auth.errorOrgCreationFailed",
    };
  }
}

// ============================================
// Role lookup
// ============================================

/**
 * Get the user's role in a specific organization.
 * Returns null if the user is not a member.
 */
export async function getOrgRole(
  userId: string,
  orgId: string,
): Promise<OrgResult<OrgRole | null>> {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return { data: null, error: "auth.errorServiceNotConfigured" };
    }

    const { data, error } = await supabase
      .from("organization_members")
      .select("role")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) {
      return { data: null, error: "auth.errorRoleLookupFailed" };
    }

    return { data: (data?.role as OrgRole) ?? null, error: null };
  } catch {
    return { data: null, error: "auth.errorRoleLookupFailed" };
  }
}
