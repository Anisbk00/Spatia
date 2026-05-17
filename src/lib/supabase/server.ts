import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!url && !!key && url.startsWith("http");
}

function isServiceRoleConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return !!url && !!key && url.startsWith("http");
}

/**
 * Create a Supabase server client that operates within the user's auth context.
 * This client respects RLS policies — use for read operations and auth checks.
 *
 * Returns null if Supabase is not configured or if client creation fails.
 */
export async function createClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const cookieStore = await cookies();

    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch (err) {
              // Cookie setting can fail in Server Components (read-only context)
              // This is expected and safe to ignore
            }
          },
        },
      }
    );
  } catch (err) {
    console.error("[SupabaseServer] Failed to create client:", err);
    return null;
  }
}

/**
 * Create a Supabase admin client that bypasses RLS policies.
 * Uses the service role key — only use for trusted server-side write operations.
 *
 * IMPORTANT: Never expose this client to the browser or use it for user-facing reads
 * where RLS should be enforced.
 */
export function createAdminClient() {
  if (!isServiceRoleConfigured()) {
    return null;
  }

  try {
    return createSupabaseJsClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  } catch (err) {
    console.error("[SupabaseAdmin] Failed to create client:", err);
    return null;
  }
}

/**
 * Get a Supabase client for read operations.
 * Prefers admin client (bypasses RLS) to ensure server-side reads always succeed,
 * falls back to user-context client if admin is unavailable.
 *
 * Use this for all server-side data queries to avoid RLS-related failures.
 */
export async function getReadClient() {
  const adminClient = createAdminClient();
  if (adminClient) return adminClient;

  const userClient = await createClient();
  return userClient;
}
