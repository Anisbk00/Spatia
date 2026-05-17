"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  ArrowRight,
  Loader2,
  AlertTriangle,
  Lock,
  Eye,
  EyeOff,
} from "lucide-react";
import { SpatiaLogo } from "@/components/SpatiaLogo";

/* ── Inline SVG icons for OAuth providers (standard branding) ── */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

interface LoginFormProps {
  appOrigin: string;
}

function mapSupabaseError(message: string, t: (key: string) => string): string {
  if (message === "Email not confirmed") return t("errorEmailNotConfirmed");
  if (message === "Invalid login credentials") return t("errorInvalidCredentials");
  if (message.includes("rate limit") || message.includes("over_email_send_rate_limit")) return t("errorRateLimit");
  if (message === "User already registered" || message.includes("already registered")) return t("errorAlreadyRegistered");
  if (message.includes("password") && message.includes("weak")) return t("errorPasswordWeak");
  return t("errorGeneric");
}

/** Fire-and-forget analytics event to /api/events */
function fireEvent(eventType: string, metadata?: Record<string, unknown>) {
  try {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [{ event_type: eventType, metadata: metadata || {} }] }),
    }).catch(() => {});
  } catch {
    // Silently ignore — analytics must not break UX
  }
}

export function LoginForm({ appOrigin }: LoginFormProps) {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [supabase] = useState(() => createClient());

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  // Read the "next" redirect parameter for post-login redirect
  const [redirectPath] = useState<string>(() => {
    if (typeof window === "undefined") return "/dashboard";
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    // Validate: only allow relative paths, no external URLs
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
    return "/dashboard";
  });

  // Parse URL error param and initialize error state with it
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const errParam = params.get("error");
    if (!errParam) return null;
    const errorMessages: Record<string, string> = {
      missing_code: t("errorMissingCode"),
      auth_failed: t("errorAuthFailed"),
      no_session: t("errorNoSession"),
    };
    return errorMessages[errParam] ?? t("errorGeneric");
  });

  useEffect(() => {
    // Clean URL error param on mount (preserve next param)
    if (window.location.search.includes("error=")) {
      const nextParam = new URLSearchParams(window.location.search).get("next");
      const cleanUrl = nextParam ? `/auth/login?next=${encodeURIComponent(nextParam)}` : "/auth/login";
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

  // ── Service unavailable ──
  if (!supabase) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
        <header className="w-full px-4 py-5 sm:px-6">
          <div className="mx-auto flex max-w-md items-center justify-between">
            <div className="flex items-center gap-2">
              <SpatiaLogo size="lg" />
              <span className="text-lg font-semibold tracking-tight">Spatia</span>
            </div>
            <LanguageSwitcher />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-4 py-8">
          <Card className="w-full max-w-md border-0 shadow-xl shadow-emerald-900/5">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="h-7 w-7 text-amber-600" />
              </div>
              <CardTitle className="text-xl">{t("serviceUnavailable")}</CardTitle>
              <CardDescription>{t("serviceUnavailableDesc")}</CardDescription>
            </CardHeader>
          </Card>
        </main>
        <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
          Spatia · {tc("appName")}
        </footer>
      </div>
    );
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError(mapSupabaseError(signInError.message, t));
      fireEvent("LOGIN_FAILED", { method: "email" });
      setLoading(false);
      return;
    }
    fireEvent("LOGIN_SUCCESS", { method: "email" });

    // Determine redirect based on user role and properties
    try {
      const res = await fetch("/api/auth/redirect");
      if (res.ok) {
        const data = await res.json();
        router.push(data.redirect || redirectPath);
      } else {
        router.push(redirectPath);
      }
    } catch {
      router.push(redirectPath);
    }
    router.refresh();
  };

  const handleOAuthSignIn = async () => {
    setOauthLoading("google");
    setError(null);
    fireEvent("SIGNUP_STARTED", { method: "google" });
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${appOrigin}/auth/callback` },
    });
    if (oauthError) {
      if (
        oauthError.message.includes("not enabled") ||
        oauthError.message.includes("Unsupported provider")
      ) {
        setError(t("errorGoogleNotAvailable"));
      } else {
        setError(mapSupabaseError(oauthError.message, t));
      }
      setOauthLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      <header className="w-full px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <div className="flex items-center gap-2">
            <SpatiaLogo size="lg" />
            <span className="text-lg font-semibold tracking-tight">Spatia</span>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md border-0 shadow-xl shadow-emerald-900/5">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <Lock className="h-7 w-7 text-emerald-600" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              {t("welcomeBack")}
            </CardTitle>
            <CardDescription className="text-base">
              {t("signinSubtitle")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="space-y-3 mb-5">
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full text-base font-medium border-gray-300 hover:bg-gray-50"
                disabled={loading || oauthLoading !== null}
                onClick={handleOAuthSignIn}
              >
                {oauthLoading === "google" ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <GoogleIcon className="mr-2 h-5 w-5" />
                )}
                {t("signinWithGoogle")}
              </Button>

              <div className="relative my-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    {t("orContinueWithEmail")}
                  </span>
                </div>
              </div>
            </div>

            <form onSubmit={handleSignIn} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  {t("emailLabel")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-12 text-base"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  {t("passwordLabel")}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={t("passwordPlaceholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="h-12 text-base pr-11"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                    aria-label={
                      showPassword ? t("hidePassword") : t("showPassword")
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => router.push("/auth/forgot-password")}
                    className="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                  >
                    {t("forgotPassword")}
                  </button>
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                disabled={loading || !email.trim() || !password}
                className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("signingIn")}
                  </>
                ) : (
                  <>
                    {t("signin")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {t("noAccount")}{" "}
                <button
                  type="button"
                  onClick={() => router.push("/auth/signup")}
                  className="font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                >
                  {t("createOne")}
                </button>
              </p>
            </form>
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        Spatia · {tc("appName")}
      </footer>
    </div>
  );
}
