import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization, getOrgProperties } from "@/lib/supabase/dashboard";
import type { PropertyRow } from "@/lib/supabase/dashboard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Home, Building2 } from "lucide-react";
import { PropertiesFilters } from "./PropertiesFilters";
import { PropertyActions } from "./PropertyActions";
import { PropertiesPagination } from "./PropertiesPagination";
import { getTranslations } from "next-intl/server";

const PAGE_SIZE = 20;

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const td = await getTranslations("dashboard");
  const tp = await getTranslations("property");
  const tc = await getTranslations("common");

  const statusConfig: Record<
    string,
    { label: string; className: string }
  > = {
    draft: {
      label: tp("statusDraft"),
      className:
        "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
    },
    capturing: {
      label: tp("statusCapturing"),
      className:
        "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
    },
    processing: {
      label: tp("statusProcessing"),
      className:
        "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800",
    },
    ready: {
      label: tp("statusReady"),
      className:
        "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
    },
    archived: {
      label: tp("statusArchived"),
      className:
        "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
    },
  };

  const sceneStatusConfig: Record<
    string,
    { label: string; className: string }
  > = {
    queued: {
      label: td("queued"),
      className:
        "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
    },
    processing: {
      label: tp("statusProcessing"),
      className:
        "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
    },
    ready: {
      label: tp("statusReady"),
      className:
        "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
    },
    failed: {
      label: td("failed"),
      className:
        "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
    },
  };

  const params = await searchParams;
  const status = params.status;
  const propertyType = params.type;
  const search = params.search;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  // Get authenticated user
  const supabase = await createClient();
  if (!supabase) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">{tp("supabaseNotConfigured")}</h2>
          <p className="text-sm text-muted-foreground">
            Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in
            your .env.local file.
          </p>
        </div>
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">{tc("notAuthenticated")}</h2>
          <p className="text-sm text-muted-foreground">
            Please sign in to view properties.
          </p>
        </div>
      </div>
    );
  }

  // Get user's organization
  const { organization } = await getUserOrganization(user.id);
  if (!organization) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">{tc("noOrganization")}</h2>
          <p className="text-sm text-muted-foreground">
            You are not part of any organization.
          </p>
        </div>
      </div>
    );
  }

  // Fetch properties with filters
  const { properties, total } = await getOrgProperties(organization.id, {
    status,
    propertyType,
    search,
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{td("properties")}</h1>
          <p className="text-sm text-muted-foreground">
            {total > 0
              ? td("propertyCountTotal", { total })
              : td("manageProperties")}
          </p>
        </div>
        <Link href="/properties/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            {td("newProperty")}
          </Button>
        </Link>
      </div>

      {/* Filters bar */}
      <PropertiesFilters
        status={status}
        propertyType={propertyType}
        search={search}
      />

      {/* Table */}
      {properties.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">{td("noPropertiesFound")}</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {search || status || propertyType
                ? td("noPropertiesFilterHint")
                : td("noPropertiesCreateHint")}
            </p>
            {!search && !status && !propertyType && (
              <Link href="/properties/new" className="mt-6">
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  {tp("createProperty")}
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">{td("cover")}</TableHead>
                  <TableHead>{td("title")}</TableHead>
                  <TableHead>{td("status")}</TableHead>
                  <TableHead>{td("scene")}</TableHead>
                  <TableHead className="text-right">{td("views")}</TableHead>
                  <TableHead>{td("created")}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((property: PropertyRow) => {
                  const statusConf = statusConfig[property.status] ?? {
                    label: property.status,
                    className: "",
                  };
                  const sceneConf = property.scene_status
                    ? sceneStatusConfig[property.scene_status] ?? {
                        label: property.scene_status,
                        className: "",
                      }
                    : null;

                  return (
                    <TableRow key={property.id}>
                      {/* Cover image */}
                      <TableCell>
                        <Avatar className="h-12 w-12 rounded-md">
                          <AvatarImage
                            src={property.cover_image_url ?? undefined}
                            alt={property.title}
                            className="rounded-md object-cover"
                          />
                          <AvatarFallback className="rounded-md bg-muted">
                            {property.property_type === "office" ||
                            property.property_type === "land" ? (
                              <Building2 className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <Home className="h-5 w-5 text-muted-foreground" />
                            )}
                          </AvatarFallback>
                        </Avatar>
                      </TableCell>

                      {/* Title + Address */}
                      <TableCell>
                        <div className="max-w-[280px]">
                          <Link
                            href={`/property/${property.id}`}
                            className="font-medium hover:underline truncate block"
                          >
                            {property.title}
                          </Link>
                          {property.address && (
                            <p className="truncate text-xs text-muted-foreground mt-0.5">
                              {property.address}
                            </p>
                          )}
                        </div>
                      </TableCell>

                      {/* Status badge */}
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={statusConf.className}
                        >
                          {statusConf.label}
                        </Badge>
                      </TableCell>

                      {/* Scene status badge */}
                      <TableCell>
                        {sceneConf ? (
                          <Badge
                            variant="outline"
                            className={sceneConf.className}
                          >
                            {sceneConf.label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>

                      {/* Views */}
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(property.view_count)}
                      </TableCell>

                      {/* Created date */}
                      <TableCell className="text-muted-foreground">
                        {formatDate(property.created_at)}
                      </TableCell>

                      {/* Actions dropdown */}
                      <TableCell>
                        <PropertyActions propertyId={property.id} propertyStatus={property.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <PropertiesPagination
              currentPage={page}
              totalPages={totalPages}
              status={status}
              propertyType={propertyType}
              search={search}
            />
          )}
        </>
      )}
    </div>
  );
}
