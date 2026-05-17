"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out the current user and redirect to login.
 *
 * IMPORTANT: redirect() must NOT be inside try/catch — it throws a special
 * NEXT_REDIRECT error that catch blocks will intercept, breaking the redirect.
 */
export async function signOutAction() {
  const supabase = await createClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  // redirect() is at the top level of the server action — NOT inside try/catch
  redirect("/auth/login");
}
