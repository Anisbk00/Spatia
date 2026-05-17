import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!url && !!key && url.startsWith("http");
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Reject requests without a valid code — prevents open redirect attacks
  if (!code) {
    return NextResponse.redirect(new URL("/auth/login?error=missing_code", request.url));
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/auth/login?error=service_unavailable", request.url));
  }

  // ── Accumulate ALL Set-Cookie directives from Supabase ──
  // We can't use cookies().set() from next/headers because those cookies
  // are NOT included in a separately created NextResponse.redirect().
  // We also can't just copy name+value from response.cookies.getAll()
  // because that loses the options (maxAge, path, httpOnly, secure, sameSite)
  // which makes cookies session-only — they vanish when the browser closes.
  const cookieDirectives: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              // Update request cookies so subsequent Supabase calls see them
              request.cookies.set(name, value);
              // Accumulate for the final response — preserving options
              cookieDirectives.push({ name, value, options: options ?? {} });
            });
          },
        },
      }
    );

    // Exchange the PKCE code for a session
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[Auth Callback] Code exchange failed:", error.message);
      return NextResponse.redirect(new URL("/auth/login?error=auth_failed", request.url));
    }

    // Fetch authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(new URL("/auth/login?error=no_session", request.url));
    }

    // Determine redirect path
    let redirectPath = "/";

    // If a specific "next" path was provided, validate it
    if (next !== "/") {
      const nextUrl = new URL(next, request.url);
      if (nextUrl.origin === new URL(request.url).origin) {
        redirectPath = next;
      }
    }

    // Check if user has completed onboarding (only if redirectPath is still "/")
    if (redirectPath === "/") {
      let role = "client";
      let hasCompletedOnboarding = false;

      try {
        const { data: profile } = await supabase
          .from("users")
          .select("role")
          .eq("id", user.id)
          .single();
        role = profile?.role || "client";

        const { data: onboardingState } = await supabase
          .from("onboarding_state")
          .select("is_completed")
          .eq("user_id", user.id)
          .single();
        hasCompletedOnboarding = onboardingState?.is_completed === true;
      } catch (err) {
        console.error("[Auth Callback] Profile/onboarding lookup failed:", err);
      }

      if (role === "agent") {
        redirectPath = hasCompletedOnboarding ? "/dashboard" : "/onboarding";
      } else {
        redirectPath = "/explore";
      }
    }

    // Build the final redirect response with ALL session cookies + their full options
    const finalResponse = NextResponse.redirect(new URL(redirectPath, request.url));
    for (const { name, value, options } of cookieDirectives) {
      // Spread options to preserve maxAge, path, httpOnly, secure, sameSite etc.
      // Without these, cookies become session-only and vanish when the browser closes.
      finalResponse.cookies.set(name, value, options as Record<string, unknown>);
    }

    return finalResponse;
  } catch (err) {
    console.error("[Auth Callback] Unhandled error:", err);
    return NextResponse.redirect(new URL("/auth/login?error=auth_failed", request.url));
  }
}
