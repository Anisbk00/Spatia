import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
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

export default async function DashboardNewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const isVideoMode = mode === "video";

  const t = await getTranslations("property");
  const tc = await getTranslations("common");
  const td = await getTranslations("dashboard");

  const supabase = await createClient();

  if (!supabase) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">{t("supabaseNotConfigured")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("supabaseNotConfiguredDesc")}
          </p>
        </div>
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { organization, membership } = await getUserOrganization(user.id);

  if (!organization) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <ArrowLeft className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">{tc("noOrganization")}</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            {tc("noOrganizationDesc")}
          </p>
          <Button asChild>
            <a href="/onboarding">{tc("createOrganization")}</a>
          </Button>
        </div>
      </div>
    );
  }

  const orgRole = (membership as { role: string } | null)?.role ?? "agent";

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
            orgId={organization.id}
            orgRole={orgRole}
            isVideoMode={isVideoMode}
          />
        </CardContent>
      </Card>
    </div>
  );
}
