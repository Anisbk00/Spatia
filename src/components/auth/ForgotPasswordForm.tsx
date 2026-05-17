"use client";

import { useState } from "react";
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
} from "lucide-react";
import { SpatiaLogo } from "@/components/SpatiaLogo";

interface ForgotPasswordFormProps {
  appOrigin: string;
}

function mapSupabaseError(message: string, t: (key: string) => string): string {
  if (message.includes("rate limit") || message.includes("over_email_send_rate_limit")) return t("errorRateLimit");
  // Generic response to prevent user enumeration
  return t("errorGeneric");
}

export function ForgotPasswordForm({ appOrigin }: ForgotPasswordFormProps) {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [supabase] = useState(() => createClient());

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetEmailSent, setResetEmailSent] = useState(false);

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

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${appOrigin}/auth/callback` },
    );
    if (resetError) {
      // Use generic error to prevent user enumeration
      setError(mapSupabaseError(resetError.message, t));
      setLoading(false);
      return;
    }
    // Always show success — even if email doesn't exist, to prevent enumeration
    setResetEmailSent(true);
    setLoading(false);
  };

  // ── Reset email sent ──
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
              <p className="text-sm text-muted-foreground">
                {t("clickResetLink")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("checkSpam")}
              </p>
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

  // ── Main forgot password form ──
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
              {t("resetPassword")}
            </CardTitle>
            <CardDescription className="text-base">
              {t("resetSubtitle")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleResetPassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="forgot-email" className="text-sm font-medium">
                  {t("emailLabel")}
                </Label>
                <Input
                  id="forgot-email"
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

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                disabled={loading || !email.trim()}
                className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("sendingReset")}
                  </>
                ) : (
                  <>
                    {t("sendResetLink")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {t("rememberPassword")}{" "}
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
