import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
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

function isNextRedirect(err: unknown): boolean {
  if (err && typeof err === "object" && "digest" in err) {
    const digest = (err as { digest: string }).digest;
    return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND");
  }
  return false;
}

// Error display component for debugging
function DebugErrorCard({ error }: { error: unknown }) {
  const realMessage = error instanceof Error ? error.message : String(error);
  const realStack = error instanceof Error ? error.stack : undefined;
  const realName = error instanceof Error ? error.constructor.name : "Unknown";
  const digest = (error as { digest?: string })?.digest;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg border-2 border-red-200 shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <span className="text-xl">⚠️</span>
          </div>
          <CardTitle>Page Error (Debug)</CardTitle>
          <CardDescription>The real error is shown below to help debug</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-xs font-semibold text-red-800 mb-1">Error Type:</p>
            <p className="text-sm text-red-900 font-mono break-all">{realName}</p>
          </div>
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-xs font-semibold text-red-800 mb-1">Message:</p>
            <p className="text-sm text-red-900 font-mono break-all whitespace-pre-wrap">{realMessage}</p>
          </div>
          {digest && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">Digest:</p>
              <p className="text-sm text-amber-900 font-mono">{digest}</p>
            </div>
          )}
          {realStack && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 max-h-48 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-800 mb-1">Stack:</p>
              <p className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-all">{realStack}</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button onClick={() => window.location.reload()} variant="outline" className="flex-1">
              Try again
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <a href="/explore">Back to Explore</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function NewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  // Phase 1: Data fetching — all async operations with error capture
  let isVideoMode = false;
  let t: Awaited<ReturnType<typeof getTranslations>> | null = null;
  let tc: Awaited<ReturnType<typeof getTranslations>> | null = null;
  let tl: Awaited<ReturnType<typeof getTranslations>> | null = null;
  let user: { id: string } | null = null;
  let fetchError: unknown = null;

  try {
    const { mode } = await searchParams;
    isVideoMode = mode === "video";

    t = await getTranslations("property");
    tc = await getTranslations("common");
    tl = await getTranslations("landing");

    let supabase;
    try {
      supabase = await createClient();
    } catch (err) {
      console.error("[NewPropertyPage] createClient failed:", err);
    }

    if (!supabase) {
      // Not an error — just not configured. Will be handled in render phase.
    } else {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          console.error("[NewPropertyPage] getUser error:", error.message);
        }
        user = data.user;
      } catch (err) {
        console.error("[NewPropertyPage] getUser threw:", err);
      }
    }
  } catch (err) {
    if (isNextRedirect(err)) {
      throw err;
    }
    console.error("[NewPropertyPage] Data fetch error:", err);
    fetchError = err;
  }

  // Phase 2: Render — if there was an error, show debug info
  if (fetchError) {
    return <DebugErrorCard error={fetchError} />;
  }

  // Not configured
  if (!t || !tc || !tl) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-xl">
          <CardHeader className="text-center">
            <CardTitle>Service Not Configured</CardTitle>
            <CardDescription>
              Please configure your Supabase environment variables.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    redirect("/auth/login");
  }

  // Phase 3: Normal render
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
              <PropertyForm cancelHref="/explore" mode={isVideoMode ? "video" : "photo"} />
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
