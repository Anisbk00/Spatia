"use client";

import { useState, useMemo, useEffect } from "react";
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
  Eye,
  EyeOff,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { SpatiaLogo } from "@/components/SpatiaLogo";

interface ResetPasswordFormProps {
  appOrigin: string;
  hasRecoverySession?: boolean;
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

export function ResetPasswordForm({ appOrigin, hasRecoverySession: serverSessionHint }: ResetPasswordFormProps) {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [supabase] = useState(() => createClient());

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Use server hint for immediate render, then verify client-side
  const [hasValidSession, setHasValidSession] = useState<boolean | null>(
    serverSessionHint ?? null
  );

  const passwordStrength = useMemo(
    () => getPasswordStrength(newPassword, t),
    [newPassword, t],
  );
  const passwordsMatch =
    confirmPassword.length === 0 || newPassword === confirmPassword;

  // Verify session client-side (authoritative)
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasValidSession(!!session);
    });
  }, [supabase]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);

    if (newPassword.length < 8) {
      setError(t("passwordMinLength"));
      setLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setError(t("errorGeneric"));
      fireEvent("LOGIN_FAILED", { method: "password_reset" });
      setLoading(false);
      return;
    }

    fireEvent("LOGIN_SUCCESS", { method: "password_reset" });
    setSuccess(true);
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

  // ── Invalid/expired token (no session) ──
  if (hasValidSession === false) {
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
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-7 w-7 text-red-600" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                {t("invalidResetLink")}
              </CardTitle>
              <CardDescription className="text-base">
                {t("errorGeneric")}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button
                onClick={() => router.push("/auth/forgot-password")}
                className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
              >
                {t("requestNewLink")}
                <ArrowRight className="ml-2 h-4 w-4" />
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

  // ── Password updated successfully ──
  if (success) {
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
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                {t("resetPasswordSuccess")}
              </CardTitle>
              <CardDescription className="text-base">
                {t("resetPasswordSuccessDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button
                onClick={() => {
                  router.push("/dashboard");
                  router.refresh();
                }}
                className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
              >
                {t("signin")}
                <ArrowRight className="ml-2 h-4 w-4" />
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

  // ── Loading session check ──
  if (hasValidSession === null) {
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
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </main>
        <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
          Spatia · {tc("appName")}
        </footer>
      </div>
    );
  }

  // ── Main reset password form ──
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
              {t("resetPasswordTitle")}
            </CardTitle>
            <CardDescription className="text-base">
              {t("resetPasswordSubtitle")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleResetPassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-sm font-medium">
                  {t("newPasswordLabel")}
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    placeholder={t("newPasswordPlaceholder")}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
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

                {newPassword && (
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-new-password" className="text-sm font-medium">
                  {t("confirmPasswordLabel")}
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-new-password"
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
                  !newPassword ||
                  !confirmPassword ||
                  !passwordsMatch ||
                  newPassword.length < 8
                }
                className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("updatingPassword")}
                  </>
                ) : (
                  <>
                    {t("updatePassword")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
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
