import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // If OAuth code is present in URL AND we're not already on the callback route,
  // redirect to the server-side callback handler.
  // MUST check pathname to avoid infinite redirect loop:
  //   /?code=xxx → /auth/callback?code=xxx → /auth/callback?code=xxx → ...
  const code = request.nextUrl.searchParams.get("code");
  if (code && request.nextUrl.pathname !== "/auth/callback") {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";
    // Preserve any other query params like "next"
    return NextResponse.redirect(callbackUrl);
  }

  // Just refresh the Supabase session cookie
  const response = await updateSession(request);

  const { pathname } = request.nextUrl;

  // ─── Authenticated user on landing page → redirect to explore ─────────
  if (pathname === "/") {
    const hasSession = request.cookies.getAll().some(c => c.name.startsWith('sb-'));
    if (hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/explore";
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Simple route protection (no profile check - that's done in page components)
  const publicRoutes = ["/login", "/auth/callback", "/auth/complete", "/auth/login", "/auth/signup", "/auth/forgot-password", "/auth/reset-password", "/auth/redirect", "/explore", "/viewer", "/view", "/property", "/about", "/privacy", "/terms", "/api"];
  const isPublicRoute = publicRoutes.some((route) =>
    route === "/" ? pathname === "/" : pathname.startsWith(route)
  );

  // Auth-only routes: redirect authenticated users away
  const authOnlyRoutes = ["/login", "/auth/login", "/auth/signup", "/auth/forgot-password"];
  const isAuthOnlyRoute = authOnlyRoutes.some((route) => pathname === route || pathname.startsWith(route + "/"));
  if (isAuthOnlyRoute) {
    const hasSession = request.cookies.getAll().some(c => c.name.startsWith('sb-'));
    if (hasSession) {
      // Redirect to a server page that determines the correct post-login
      // destination based on the user's role and properties
      const url = request.nextUrl.clone();
      url.pathname = "/auth/redirect";
      return NextResponse.redirect(url);
    }
    return response;
  }

  // For protected routes, check if user has a session cookie
  // (the actual auth check is done by Supabase in the page components)
  if (!isPublicRoute) {
    const hasSession = request.cookies.getAll().some(c => c.name.startsWith('sb-'));
    if (!hasSession) {
      // Preserve intended destination for post-login redirect
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
