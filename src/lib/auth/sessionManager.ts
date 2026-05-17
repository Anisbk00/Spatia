"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

// ============================================
// Types
// ============================================

export interface AuthSessionState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
}

// ============================================
// Debounce helper
// ============================================

function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
    }, delayMs);
  };
}

// ============================================
// Hook
// ============================================

/**
 * React hook that subscribes to Supabase auth state changes and
 * provides the current user, session, loading, and error state.
 *
 * - Handles TOKEN_REFRESHED events silently
 * - Handles SIGNED_OUT events by clearing state
 * - Prevents hydration mismatches by only running client-side
 * - Cleans up subscription on unmount
 * - Debounces rapid auth state changes (e.g. token refreshes)
 */
export function useAuthSession(): AuthSessionState {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const updateAuthStateRef = useRef<((s: Session | null, u: User | null) => void) | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    // Initialize the debounced updater inside the effect
    updateAuthStateRef.current = debounce(
      (newSession: Session | null, newUser: User | null) => {
        if (!mountedRef.current) return;
        setSession(newSession);
        setUser(newUser);
        setLoading(false);
      },
      50,
    ) as (newSession: Session | null, newUser: User | null) => void;

    // useEffect only runs on the client, so no window check needed
    const supabase = createClient();
    if (!supabase) {
      // Supabase not configured — mark as not loading via the debounced path
      // Using the updater ensures we don't call setState directly in effect body
      updateAuthStateRef.current(null, null);
      return;
    }

    // Subscribe to auth state changes.
    // The INITIAL_SESSION event fires immediately with the current session,
    // which will set loading=false via the debounced updater.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mountedRef.current) return;

      const updater = updateAuthStateRef.current;

      switch (event) {
        case "TOKEN_REFRESHED":
          // Silent refresh — just update session, no error
          updater?.(newSession, newSession?.user ?? null);
          break;

        case "SIGNED_OUT":
          // Clear all state on sign out — immediate, no debounce
          setSession(null);
          setUser(null);
          setLoading(false);
          setError(null);
          break;

        case "SIGNED_IN":
        case "INITIAL_SESSION":
          updater?.(newSession, newSession?.user ?? null);
          break;

        case "PASSWORD_RECOVERY":
          updater?.(newSession, newSession?.user ?? null);
          break;

        case "USER_UPDATED":
          updater?.(newSession, newSession?.user ?? null);
          break;

        default:
          updater?.(newSession, newSession?.user ?? null);
      }
    });

    subscriptionRef.current = subscription;

    // Cleanup on unmount
    return () => {
      mountedRef.current = false;
      updateAuthStateRef.current = null;
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, []);

  return { user, session, loading, error };
}
