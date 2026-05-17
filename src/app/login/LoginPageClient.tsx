"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
  Mail,
  ArrowRight,
  Loader2,
  AlertTriangle,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from "lucide-react";

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

import { SpatiaLogo } from "@/components/SpatiaLogo";

interface LoginPageClientProps {
  appOrigin: string;
}

type AuthMode = "signin" | "signup" | "forgotPassword";

const RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_CHECK_DEBOUNCE_MS = 600;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mapSupabaseError(message: string, t: (key: string) => string): string {
  if (message === "Email not confirmed") return t("errorEmailNotConfirmed");
  if (message === "Invalid login credentials") return t("errorInvalidCredentials");
  if (message.includes("rate limit") || message.includes("over_email_send_rate_limit")) return t("errorRateLimit");
  if (message === "User already registered" || message.includes("already registered")) return t("errorAlreadyRegistered");
  if (message.includes("password") && message.includes("weak")) return t("errorPasswordWeak");
  return t("errorGeneric");
}

type PasswordStrength = {
  score: number;
  label: string;
  color: string;
  textColor: string;
};

function getPasswordStrength(password: string, t: (key: string) => string): PasswordStrength {
  if (!password) return { score: 0, label: "", color: "", textColor: "" };

  let criteria = 0;
  if (/[a-z]/.test(password)) criteria++;
  if (/[A-Z]/.test(password)) criteria++;
  if (/[0-9]/.test(password)) criteria++;
  if (/[^a-zA-Z0-9]/.test(password)) criteria++;

  if (password.length < 8) {
    return { score: 1, label: t("passwordWeak"), color: "bg-red-500", textColor: "text-red-600" };
  }

  if (criteria <= 1) return { score: 1, label: t("passwordWeak"), color: "bg-red-500", textColor: "text-red-600" };
  if (criteria === 2) return { score: 2, label: t("passwordFair"), color: "bg-amber-500", textColor: "text-amber-600" };
  if (criteria === 3) return { score: 3, label: t("passwordStrong"), color: "bg-emerald-500", textColor: "text-emerald-600" };
  return { score: 4, label: t("passwordVeryStrong"), color: "bg-emerald-600", textColor: "text-emerald-600" };
}

export function LoginPageClient({ appOrigin }: LoginPageClientProps) {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [supabase] = useState(() => createClient());

  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [emailChecking, setEmailChecking] = useState(false);
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const emailCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedEmailRef = useRef<string>("");

  const [urlError] = useState<string | null>(() => {
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
  const [error, setError] = useState<string | null>(urlError);
  const [verificationSent, setVerificationSent] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkEmailExists = useCallback(async (emailToCheck: string) => {
    const trimmed = emailToCheck.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setEmailExists(null);
      setEmailChecking(false);
      return;
    }
    setEmailChecking(true);
    try {
      const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        const data = await res.json();
        setEmailExists(data.exists === true);
      } else {
        setEmailExists(null);
      }
    } catch {
      setEmailExists(null);
    } finally {
      setEmailChecking(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== "signup") {
      setEmailExists(null);
      setEmailChecking(false);
      return;
    }
    const trimmed = email.trim().toLowerCase();
    if (emailCheckTimerRef.current) clearTimeout(emailCheckTimerRef.current);
    if (!trimmed || !EMAIL_RE.test(trimmed)) {
      setEmailExists(null);
      setEmailChecking(false);
      lastCheckedEmailRef.current = "";
      return;
    }
    if (lastCheckedEmailRef.current === trimmed) return;
    emailCheckTimerRef.current = setTimeout(() => {
      checkEmailExists(trimmed);
      lastCheckedEmailRef.current = trimmed;
    }, EMAIL_CHECK_DEBOUNCE_MS);
    return () => {
      if (emailCheckTimerRef.current) clearTimeout(emailCheckTimerRef.current);
    };
  }, [email, mode, checkEmailExists]);

  useEffect(() => {
    if (window.location.search.includes("error=")) {
      window.history.replaceState({}, "", "/auth/login");
    }
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const startResendCooldown = useCallback(() => {
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const passwordStrength = useMemo(() => getPasswordStrength(password, t), [password, t]);
  const passwordHasWhitespace = password.length > 0 && password !== password.trim();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(mapSupabaseError(error.message, t));
      setLoading(false);
      return;
    }
    // Navigate to server redirect page that checks role + properties.
    // Using window.location.href to force a full page navigation
    // ensures session cookies are available server-side.
    window.location.href = "/auth/redirect";
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    if (password.length < 8) {
      setError(t("passwordMinLength"));
      setLoading(false);
      return;
    }
    if (emailExists === true) {
      setError(t("errorAlreadyRegistered"));
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${appOrigin}/auth/callback`,
        data: { role: "agent" },
      },
    });
    if (error) {
      setError(mapSupabaseError(error.message, t));
      setLoading(false);
      return;
    }
    if (data.session) {
      // Navigate to server redirect page that checks role + properties.
      window.location.href = "/auth/redirect";
      return;
    }
    setVerificationSent(true);
    startResendCooldown();
    setLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${appOrigin}/auth/callback`,
    });
    if (error) {
      setError(mapSupabaseError(error.message, t));
      setLoading(false);
      return;
    }
    setResetEmailSent(true);
    setLoading(false);
  };

  const handleResendVerification = async () => {
    if (!supabase || resendCooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${appOrigin}/auth/callback` },
    });
    setResending(false);
    if (error) {
      setError(mapSupabaseError(error.message, t));
      return;
    }
    startResendCooldown();
  };

  const handleOAuthSignIn = async () => {
    if (!supabase) return;
    setOauthLoading("google");
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${appOrigin}/auth/callback` },
    });
    if (error) {
      if (error.message.includes("not enabled") || error.message.includes("Unsupported provider")) {
        setError(t("errorGoogleNotAvailable"));
      } else {
        setError(mapSupabaseError(error.message, t));
      }
      setOauthLoading(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    if (mode === "signin") handleSignIn(e);
    else if (mode === "signup") handleSignUp(e);
    else if (mode === "forgotPassword") handleResetPassword(e);
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setError(null);
    setPassword("");
    setEmailExists(null);
    setEmailChecking(false);
    lastCheckedEmailRef.current = "";
  };

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
          <Card className="w-full max-w-md border-0 shadow-xl">
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

  // ── Password reset email sent ──
  if (resetEmailSent) {
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
                <Mail className="h-7 w-7 text-emerald-600" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                {t("checkEmail")}
              </CardTitle>
              <CardDescription className="text-base">
                {t("resetSentTo")}{" "}
                <span className="font-medium text-foreground">{email}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">{t("clickResetLink")}</p>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <p className="text-xs text-muted-foreground">{t("checkSpam")}</p>
              <Button
                variant="ghost"
                className="text-sm text-muted-foreground"
                onClick={() => { setResetEmailSent(false); setMode("signin"); setPassword(""); setError(null); }}
              >
                {t("backToSignin")}
              </Button>
            </CardContent>
          </Card>
        </main>
        <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
          Spatia · {tc("appName")}
        </footer>
      </div>
    );
  }

  // ── Email verification sent ──
  if (verificationSent) {
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
                <Mail className="h-7 w-7 text-emerald-600" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                {t("verifyEmail")}
              </CardTitle>
              <CardDescription className="text-base">
                {t("verifySentTo")}{" "}
                <span className="font-medium text-foreground">{email}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">{t("clickVerifyLink")}</p>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={handleResendVerification}
                disabled={resendCooldown > 0 || resending}
              >
                {resending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("sending")}</>
                ) : resendCooldown > 0 ? (
                  <><RefreshCw className="mr-2 h-4 w-4" />{t("resendIn")} {resendCooldown}s</>
                ) : (
                  <><RefreshCw className="mr-2 h-4 w-4" />{t("resendVerification")}</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">{t("checkSpam")}</p>
              <Button
                variant="ghost"
                className="text-sm text-muted-foreground"
                onClick={() => { setVerificationSent(false); setMode("signin"); setPassword(""); setError(null); }}
              >
                {t("backToSignin")}
              </Button>
            </CardContent>
          </Card>
        </main>
        <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
          Spatia · {tc("appName")}
        </footer>
      </div>
    );
  }

  // ── Main auth form ──
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
              {mode === "forgotPassword" ? (
                <Lock className="h-7 w-7 text-emerald-600" />
              ) : mode === "signin" ? (
                <Lock className="h-7 w-7 text-emerald-600" />
              ) : (
                <Mail className="h-7 w-7 text-emerald-600" />
              )}
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              {mode === "forgotPassword"
                ? t("resetPassword")
                : mode === "signin"
                  ? t("welcomeBack")
                  : t("createAccount")}
            </CardTitle>
            <CardDescription className="text-base">
              {mode === "forgotPassword"
                ? t("resetSubtitle")
                : mode === "signin"
                  ? t("signinSubtitle")
                  : t("signupSubtitle")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {mode !== "forgotPassword" && (
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
                  {mode === "signin" ? t("signinWithGoogle") : t("signupWithGoogle")}
                </Button>

                <div className="relative my-1">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">{t("orContinueWithEmail")}</span>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  {t("emailLabel")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailExists !== null) setEmailExists(null);
                  }}
                  required
                  autoComplete="email"
                  className="h-12 text-base"
                  disabled={loading}
                />

                {mode === "signup" && email.trim() && EMAIL_RE.test(email.trim()) && (
                  <div className="flex items-center gap-1.5 min-h-[20px]">
                    {emailChecking ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("emailChecking")}
                      </span>
                    ) : emailExists === true ? (
                      <span className="flex items-center gap-1.5 text-xs text-amber-600">
                        <XCircle className="h-3.5 w-3.5" />
                        {t("emailExists")}
                      </span>
                    ) : emailExists === false ? (
                      <span className="flex items-center gap-1.5 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("emailAvailable")}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {mode !== "forgotPassword" && (
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">
                    {t("passwordLabel")}
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={
                        mode === "signin"
                          ? t("passwordPlaceholder")
                          : t("passwordCreatePlaceholder")
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={mode === "signup" ? 8 : undefined}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      className="h-12 text-base pr-11"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                      aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {mode === "signup" && password && (
                    <div className="space-y-1.5">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              i <= passwordStrength.score ? passwordStrength.color : "bg-muted"
                            }`}
                          />
                        ))}
                      </div>
                      <p className={`text-xs ${passwordStrength.textColor}`}>
                        {passwordStrength.label}
                      </p>
                    </div>
                  )}

                  {passwordHasWhitespace && (
                    <p className="text-xs text-amber-600">{t("passwordWhitespace")}</p>
                  )}

                  {mode === "signin" && (
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => switchMode("forgotPassword")}
                        className="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                      >
                        {t("forgotPassword")}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                disabled={
                  loading ||
                  !email.trim() ||
                  (mode !== "forgotPassword" && !password) ||
                  (mode === "signup" && emailExists === true)
                }
                className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {mode === "forgotPassword"
                      ? t("sendingReset")
                      : mode === "signin"
                        ? t("signingIn")
                        : t("creatingAccount")}
                  </>
                ) : (
                  <>
                    {mode === "forgotPassword"
                      ? t("sendResetLink")
                      : mode === "signin"
                        ? t("signin")
                        : t("signup")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {mode === "forgotPassword" ? (
                  <>
                    {t("rememberPassword")}{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("signin")}
                      className="font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                    >
                      {t("signinLink")}
                    </button>
                  </>
                ) : mode === "signin" ? (
                  <>
                    {t("noAccount")}{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("signup")}
                      className="font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                    >
                      {t("createOne")}
                    </button>
                  </>
                ) : (
                  <>
                    {t("haveAccount")}{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("signin")}
                      className="font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                    >
                      {t("signinLink")}
                    </button>
                  </>
                )}
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
