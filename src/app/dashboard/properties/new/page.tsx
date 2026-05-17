import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/supabase/dashboard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { CreatePropertyForm } from "./CreatePropertyForm";

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
    <div className="flex min-h-[60vh] items-center justify-center p-4">
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
              <a href="/dashboard/properties">Back to Properties</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function DashboardNewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  // Phase 1: Data fetching — all async operations with error capture
  let isVideoMode = false;
  let t: Awaited<ReturnType<typeof getTranslations>> | null = null;
  let tc: Awaited<ReturnType<typeof getTranslations>> | null = null;
  let user: { id: string } | null = null;
  let orgId: string | null = null;
  let orgRole = "agent";
  let fetchError: unknown = null;

  try {
    const { mode } = await searchParams;
    isVideoMode = mode === "video";

    t = await getTranslations("property");
    tc = await getTranslations("common");

    let supabase;
    try {
      supabase = await createClient();
    } catch (err) {
      console.error("[DashboardNewProperty] createClient failed:", err);
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          console.error("[DashboardNewProperty] getUser error:", error.message);
        }
        user = data.user;
      } catch (err) {
        console.error("[DashboardNewProperty] getUser threw:", err);
      }

      if (user) {
        try {
          const orgResult = await getUserOrganization(user.id);
          orgId = orgResult.organization?.id ?? null;
          orgRole = (orgResult.membership as { role: string } | null)?.role ?? "agent";
        } catch (err) {
          console.error("[DashboardNewProperty] getUserOrganization failed:", err);
        }
      }
    }
  } catch (err) {
    if (isNextRedirect(err)) {
      throw err;
    }
    console.error("[DashboardNewProperty] Data fetch error:", err);
    fetchError = err;
  }

  // Phase 2: Render — if there was an error, show debug info
  if (fetchError) {
    return <DebugErrorCard error={fetchError} />;
  }

  // Not configured
  if (!t || !tc) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">Service Not Configured</h2>
          <p className="text-sm text-muted-foreground">
            Please configure your Supabase environment variables.
          </p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    redirect("/auth/login");
  }

  // Phase 3: Normal render
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <a href="/dashboard/properties" aria-label={tc("back")}>
            <ArrowLeft className="h-4 w-4" />
          </a>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {isVideoMode ? t("videoCaptureTitle") : t("newProperty")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isVideoMode ? t("videoDescription") : t("photoDescription")}
          </p>
        </div>
      </div>

      {/* Form Card */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{isVideoMode ? t("videoCaptureTitle") : t("createProperty")}</CardTitle>
          <CardDescription>
            {isVideoMode ? t("videoDescription") : t("photoDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreatePropertyForm
            orgId={orgId}
            orgRole={orgRole}
            isVideoMode={isVideoMode}
          />
        </CardContent>
      </Card>
    </div>
  );
}
