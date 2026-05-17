import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { User, Session } from "@supabase/supabase-js";
import type {
  User as PublicUser,
  UserRole,
  OnboardingState,
} from "@/lib/types";

// ============================================
// Types
// ============================================

export interface ServerAuthResult<T> {
  data: T;
  error: string | null;
}

// ============================================
// Auth retrieval
// ============================================

/**
 * Get the authenticated user from cookies.
 * Returns null if not authenticated or Supabase is not configured.
 *
 * IMPORTANT: This function never throws.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  try {
    const supabase = await createClient();
    if (!supabase) return null;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    return user ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the full session from cookies.
 * Returns null if not authenticated or Supabase is not configured.
 *
 * IMPORTANT: This function never throws.
 */
export async function getAuthenticatedSession(): Promise<Session | null> {
  try {
    const supabase = await createClient();
    if (!supabase) return null;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session ?? null;
  } catch {
    return null;
  }
}

/**
 * Require authentication — returns user or null.
 * The calling code is responsible for handling the redirect.
 *
 * CRITICAL: We do NOT call redirect() inside this function.
 * In Next.js, redirect() throws NEXT_REDIRECT which must NOT be
 * caught by try/catch blocks. Let the caller handle redirects at
 * the top level of server components / route handlers.
 *
 * IMPORTANT: This function never throws.
 */
export async function requireAuth(): Promise<User | null> {
  return getAuthenticatedUser();
}

// ============================================
// Profile management
// ============================================

/**
 * Create a public.users row for a user.
 * This is needed because OAuth sign-ups don't automatically create
 * a public.users row, which causes FK constraint violations on
 * properties, capture_sessions, etc.
 *
 * Uses admin client to bypass RLS.
 * Returns the created profile or error.
 */
export async function createUserProfile(
  userId: string,
  email: string,
  role: UserRole = "client",
): Promise<ServerAuthResult<PublicUser | null>> {
  try {
    const adminClient = createAdminClient();
    const supabase = adminClient || await createClient();
    if (!supabase) {
      return { data: null, error: "auth.errorServiceNotConfigured" };
    }

    const { data, error } = await supabase
      .from("users")
      .insert({
        id: userId,
        email,
        full_name: null,
        role,
      })
      .select()
      .single();

    if (error) {
      // Unique violation — profile already exists
      if (error.code === "23505") {
        return { data: null, error: "auth.errorProfileAlreadyExists" };
      }
      return { data: null, error: "auth.errorProfileCreationFailed" };
    }

    return { data: data as PublicUser, error: null };
  } catch {
    return { data: null, error: "auth.errorProfileCreationFailed" };
  }
}

/**
 * Get or create a public.users profile row.
 * If the profile doesn't exist, it will be created with the given
 * email and a default "client" role.
 *
 * Uses admin client to bypass RLS.
 * This is the safe way to ensure FK constraints are satisfied
 * before inserting into properties, capture_sessions, etc.
 */
export async function ensureUserProfile(
  userId: string,
  email: string,
): Promise<ServerAuthResult<PublicUser | null>> {
  try {
    const adminClient = createAdminClient();
    const supabase = adminClient || await createClient();
    if (!supabase) {
      return { data: null, error: "auth.errorServiceNotConfigured" };
    }

    // Try to fetch existing profile
    const { data: existing, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) {
      return { data: null, error: "auth.errorProfileLookupFailed" };
    }

    if (existing) {
      return { data: existing as PublicUser, error: null };
    }

    // Profile doesn't exist — create it
    const { data: created, error: createError } = await supabase
      .from("users")
      .insert({
        id: userId,
        email,
        full_name: null,
        role: "client",
      })
      .select()
      .single();

    if (createError) {
      // Race condition: another request may have created it
      if (createError.code === "23505") {
        const { data: retryData } = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .single();

        return { data: (retryData as PublicUser) ?? null, error: null };
      }
      return { data: null, error: "auth.errorProfileCreationFailed" };
    }

    return { data: created as PublicUser, error: null };
  } catch {
    return { data: null, error: "auth.errorProfileCreationFailed" };
  }
}

// ============================================
// Onboarding state
// ============================================

/**
 * Initialize or return existing onboarding state for a user.
 * If the user has no onboarding_state row, one is created.
 *
 * Uses admin client to bypass RLS on organization_members and onboarding_state.
 *
 * @param userId — The authenticated user's ID
 * @param orgId — Optional org ID to associate with the onboarding state
 */
export async function upsertOnboardingState(
  userId: string,
  orgId?: string,
): Promise<ServerAuthResult<OnboardingState | null>> {
  try {
    const adminClient = createAdminClient();
    const supabase = adminClient || await createClient();
    if (!supabase) {
      return { data: null, error: "auth.errorServiceNotConfigured" };
    }

    // Resolve org_id if not provided — use admin client to bypass RLS on organization_members
    let resolvedOrgId = orgId ?? null;
    if (!resolvedOrgId) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("org_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      resolvedOrgId = membership?.org_id ?? null;
    }

    const { data, error } = await supabase
      .from("onboarding_state")
      .upsert(
        {
          user_id: userId,
          org_id: resolvedOrgId,
          current_step: 0,
          completed_steps: [],
          is_completed: false,
          skipped: false,
        },
        {
          onConflict: "user_id",
        },
      )
      .select()
      .single();

    if (error) {
      return { data: null, error: "auth.errorOnboardingStateFailed" };
    }

    return { data: data as OnboardingState, error: null };
  } catch {
    return { data: null, error: "auth.errorOnboardingStateFailed" };
  }
}
