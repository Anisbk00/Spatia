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
 */
export async function createClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

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
            console.error("[SupabaseServer] Cookie set failed:", err);
          }
        },
      },
    }
  );
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
}
