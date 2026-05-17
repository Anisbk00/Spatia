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
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
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

interface SignupFormProps {
  appOrigin: string;
}

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

export function SignupForm({ appOrigin }: SignupFormProps) {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [supabase] = useState(() => createClient());

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Email existence check
  const [emailChecking, setEmailChecking] = useState(false);
  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const emailCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedEmailRef = useRef<string>("");

  // Verification sent state
  const [verificationSent, setVerificationSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const passwordStrength = useMemo(() => getPasswordStrength(password, t), [password, t]);
  const passwordHasWhitespace = password.length > 0 && password !== password.trim();
  const passwordsMatch = confirmPassword.length === 0 || password === confirmPassword;

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
  }, [email, checkEmailExists]);

  useEffect(() => {
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

  const handleResendVerification = async () => {
    if (!supabase || resendCooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${appOrigin}/auth/callback` },
    });
    setResending(false);
    if (resendError) {
      setError(mapSupabaseError(resendError.message, t));
      return;
    }
    startResendCooldown();
  };

  const handleOAuthSignIn = async () => {
    if (!supabase) return;
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

    if (password !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      setLoading(false);
      return;
    }

    if (emailExists === true) {
      setError(t("errorAlreadyRegistered"));
      setLoading(false);
      return;
    }

    fireEvent("SIGNUP_STARTED", { method: "email" });

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${appOrigin}/auth/callback`,
        data: { role: "agent" },
      },
    });

    if (signUpError) {
      setError(mapSupabaseError(signUpError.message, t));
      fireEvent("LOGIN_FAILED", { method: "email", context: "signup" });
      setLoading(false);
      return;
    }

    if (data.session) {
      // Auto-confirm — redirect to onboarding
      fireEvent("LOGIN_SUCCESS", { method: "email", context: "signup_autoconfirm" });
      router.push("/onboarding");
      router.refresh();
      return;
    }

    // Email verification needed
    setVerificationSent(true);
    startResendCooldown();
    setLoading(false);
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
              <p className="text-sm text-muted-foreground">
                {t("clickVerifyLink")}
              </p>
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
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("sending")}
                  </>
                ) : resendCooldown > 0 ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t("resendIn")} {resendCooldown}s
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t("resendVerification")}
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">{t("checkSpam")}</p>
              <Button
                variant="ghost"
                className="text-sm text-muted-foreground"
                onClick={() => router.push("/auth/login")}
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

  // ── Main signup form ──
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
              {t("createAccount")}
            </CardTitle>
            <CardDescription className="text-base">
              {t("signupSubtitle")}
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
                {t("signupWithGoogle")}
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

            <form onSubmit={handleSignUp} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="signup-email" className="text-sm font-medium">
                  {t("emailLabel")}
                </Label>
                <Input
                  id="signup-email"
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

                {email.trim() && EMAIL_RE.test(email.trim()) && (
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

              <div className="space-y-2">
                <Label htmlFor="signup-password" className="text-sm font-medium">
                  {t("passwordLabel")}
                </Label>
                <div className="relative">
                  <Input
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    placeholder={t("passwordCreatePlaceholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
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

                {password && (
                  <div className="space-y-1.5">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i <= passwordStrength.score
                              ? passwordStrength.color
                              : "bg-muted"
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
                  <p className="text-xs text-amber-600">
                    {t("passwordWhitespace")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-confirm-password" className="text-sm font-medium">
                  {t("confirmPasswordLabel")}
                </Label>
                <div className="relative">
                  <Input
                    id="signup-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder={t("confirmPasswordPlaceholder")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="h-12 text-base pr-11"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                    aria-label={
                      showConfirmPassword ? t("hidePassword") : t("showPassword")
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {!passwordsMatch && (
                  <p className="text-xs text-red-600">
                    {t("passwordsDoNotMatch")}
                  </p>
                )}
              </div>

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
                  !password ||
                  !confirmPassword ||
                  !passwordsMatch ||
                  emailExists === true
                }
                className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("creatingAccount")}
                  </>
                ) : (
                  <>
                    {t("signup")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {t("haveAccount")}{" "}
                <button
                  type="button"
                  onClick={() => router.push("/auth/login")}
                  className="font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                >
                  {t("signinLink")}
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
