"use client";

import { createClient } from "@/lib/supabase/client";
import type { User, Session, AuthError } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/types";

// ============================================
// Types
// ============================================

/** Translation-key error codes — consumers resolve via i18n */
export type AuthErrorKey =
  | "auth.errorEmailNotConfirmed"
  | "auth.errorInvalidCredentials"
  | "auth.errorRateLimit"
  | "auth.errorAlreadyRegistered"
  | "auth.errorPasswordWeak"
  | "auth.errorGeneric"
  | "auth.errorGoogleNotAvailable"
  | "auth.errorMissingCode"
  | "auth.errorAuthFailed"
  | "auth.errorNoSession";

export interface AuthResult<T = null> {
  data: T;
  error: AuthErrorKey | null;
}

// ============================================
// Error mapping
// ============================================

/**
 * Map a Supabase AuthError to a translation-key string.
 * These keys match the `auth.*` namespace in /messages/{locale}.json.
 */
function mapAuthError(error: AuthError): AuthErrorKey {
  const msg = error.message ?? "";

  if (msg === "Email not confirmed") return "auth.errorEmailNotConfirmed";
  if (msg === "Invalid login credentials") return "auth.errorInvalidCredentials";
  if (msg.includes("rate limit") || msg.includes("over_email_send_rate_limit"))
    return "auth.errorRateLimit";
  if (msg === "User already registered" || msg.includes("already registered"))
    return "auth.errorAlreadyRegistered";
  if (msg.includes("password") && msg.includes("weak"))
    return "auth.errorPasswordWeak";
  if (msg.includes("not enabled") || msg.includes("Unsupported provider"))
    return "auth.errorGoogleNotAvailable";

  return "auth.errorGeneric";
}

// ============================================
// Lazy singleton client
// ============================================

let _supabase: ReturnType<typeof createClient> | null = undefined as unknown as null;

function getSupabase() {
  if (_supabase === undefined) {
    _supabase = createClient();
  }
  return _supabase;
}

// ============================================
// Auth operations
// ============================================

/**
 * Sign in with email and password.
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthResult<Session | null>> {
  const supabase = getSupabase();
  if (!supabase) {
    return { data: null, error: "auth.errorGeneric" };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    return { data: null, error: mapAuthError(error) };
  }

  return { data: data.session, error: null };
}

/**
 * Sign up with email, password, and optional user metadata.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  metadata?: Record<string, unknown>,
): Promise<AuthResult<{ user: User | null; session: Session | null }>> {
  const supabase = getSupabase();
  if (!supabase) {
    return { data: { user: null, session: null }, error: "auth.errorGeneric" };
  }

  const appUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "";

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: appUrl ? `${appUrl}/auth/callback` : undefined,
      data: metadata,
    },
  });

  if (error) {
    return { data: { user: null, session: null }, error: mapAuthError(error) };
  }

  return {
    data: { user: data.user ?? null, session: data.session ?? null },
    error: null,
  };
}

/**
 * Sign in with an OAuth provider (e.g. "google").
 */
export async function signInWithOAuth(
  provider: "google" | "github" | "apple",
  redirectTo?: string,
): Promise<AuthResult<null>> {
  const supabase = getSupabase();
  if (!supabase) {
    return { data: null, error: "auth.errorGeneric" };
  }

  const appUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "";

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: redirectTo ?? (appUrl ? `${appUrl}/auth/callback` : undefined),
    },
  });

  if (error) {
    return { data: null, error: mapAuthError(error) };
  }

  return { data: null, error: null };
}

/**
 * Sign out the current user.
 */
export async function signOut(): Promise<AuthResult<null>> {
  const supabase = getSupabase();
  if (!supabase) {
    return { data: null, error: null };
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    return { data: null, error: mapAuthError(error) };
  }

  return { data: null, error: null };
}

/**
 * Send a password-reset email.
 */
export async function resetPasswordForEmail(
  email: string,
  redirectTo?: string,
): Promise<AuthResult<null>> {
  const supabase = getSupabase();
  if (!supabase) {
    return { data: null, error: "auth.errorGeneric" };
  }

  const appUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "";

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: redirectTo ?? (appUrl ? `${appUrl}/auth/callback` : undefined),
  });

  if (error) {
    return { data: null, error: mapAuthError(error) };
  }

  return { data: null, error: null };
}

/**
 * Update the user's password (used in the reset-password flow).
 */
export async function updatePassword(
  newPassword: string,
): Promise<AuthResult<User | null>> {
  const supabase = getSupabase();
  if (!supabase) {
    return { data: null, error: "auth.errorGeneric" };
  }

  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    return { data: null, error: mapAuthError(error) };
  }

  return { data: data.user ?? null, error: null };
}

/**
 * Get the current session.
 */
export async function getSession(): Promise<AuthResult<Session | null>> {
  const supabase = getSupabase();
  if (!supabase) {
    return { data: null, error: null };
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    return { data: null, error: mapAuthError(error) };
  }

  return { data: session, error: null };
}

/**
 * Get the currently authenticated user.
 */
export async function getUser(): Promise<AuthResult<User | null>> {
  const supabase = getSupabase();
  if (!supabase) {
    return { data: null, error: null };
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return { data: null, error: mapAuthError(error) };
  }

  return { data: user ?? null, error: null };
}

/**
 * Subscribe to auth state changes.
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(
  callback: (event: string, session: Session | null) => void,
): () => void {
  const supabase = getSupabase();
  if (!supabase) {
    return () => {};
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });

  return () => {
    subscription.unsubscribe();
  };
}

/**
 * Resend an email verification link.
 */
export async function resendVerification(
  email: string,
  redirectTo?: string,
): Promise<AuthResult<null>> {
  const supabase = getSupabase();
  if (!supabase) {
    return { data: null, error: "auth.errorGeneric" };
  }

  const appUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "";

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.trim(),
    options: {
      emailRedirectTo: redirectTo ?? (appUrl ? `${appUrl}/auth/callback` : undefined),
    },
  });

  if (error) {
    return { data: null, error: mapAuthError(error) };
  }

  return { data: null, error: null };
}
