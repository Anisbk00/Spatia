import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { PropertyForm } from "@/components/property-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut } from "lucide-react";
import { SpatiaLogo } from "@/components/SpatiaLogo";
import { signOutAction } from "@/lib/actions/auth";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function NewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const isVideoMode = mode === "video";

  const t = await getTranslations("property");
  const tc = await getTranslations("common");
  const tl = await getTranslations("landing");

  const supabase = await createClient();

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-xl">
          <CardHeader className="text-center">
            <CardTitle>{t("supabaseNotConfigured")}</CardTitle>
            <CardDescription>
              {t("supabaseNotConfiguredDesc")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      {/* Top Nav */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <SpatiaLogo size="md" />
            <span className="font-semibold tracking-tight">{tc("appName")}</span>
          </div>

          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <form action={signOutAction}>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
              >
                <LogOut className="mr-1 h-4 w-4" />
                {tc("signOut")}
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-lg">
          <a
            href="/explore"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToExplore")}
          </a>

          <Card className="border-0 shadow-xl shadow-emerald-900/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-2xl font-bold tracking-tight">
                {isVideoMode ? t("videoCaptureTitle") : t("newProperty")}
              </CardTitle>
              <CardDescription className="text-base">
                {isVideoMode
                  ? t("videoDescription")
                  : t("photoDescription")}
              </CardDescription>
            </CardHeader>

            <CardContent>
              <PropertyForm onCancel={() => {}} mode={isVideoMode ? "video" : "photo"} />
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        {tl("footer")}
      </footer>
    </div>
  );
}
