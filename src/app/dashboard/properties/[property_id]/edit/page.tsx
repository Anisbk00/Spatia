import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  getPropertyDetail,
  getUserOrganization,
} from "@/lib/supabase/dashboard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { EditPropertyForm } from "./EditPropertyForm";

export default async function DashboardEditPropertyPage({
  params,
}: {
  params: Promise<{ property_id: string }>;
}) {
  const { property_id } = await params;

  const t = await getTranslations("property");
  const tc = await getTranslations("common");

  // Authenticate user
  const supabase = await createClient();
  if (!supabase) {
    notFound();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Get user's organization
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

  // Fetch property detail (already scoped to org)
  const property = await getPropertyDetail(property_id, organization.id);

  if (!property) {
    notFound();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <a
            href={`/dashboard/properties/${property_id}`}
            aria-label={tc("back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </a>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {t("editProperty")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground truncate">
            {property.title}
          </p>
        </div>
      </div>

      {/* Form Card */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t("editProperty")}</CardTitle>
          <CardDescription>
            {t("backToProperties")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditPropertyForm
            propertyId={property_id}
            orgRole={orgRole}
            initialData={{
              title: property.title,
              address: property.address ?? "",
              property_type: property.property_type ?? undefined,
              price: property.price ?? undefined,
              description: property.description ?? "",
              status: property.status,
              cover_image_url: property.cover_image_url ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
