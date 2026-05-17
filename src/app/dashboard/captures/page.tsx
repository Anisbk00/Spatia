import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  getUserOrganization,
  getOrgCaptureSessions,
} from "@/lib/supabase/dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Camera, Eye } from "lucide-react";
import { format } from "date-fns";
import type { SessionStatus } from "@/lib/types";

const statusBadgeStyles: Record<
  SessionStatus,
  { bg: string; text: string; border: string }
> = {
  started: { bg: "bg-gray-100", text: "text-gray-700", border: "border-gray-200" },
  uploading: {
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
  },
  processing: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  completed: {
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
  failed: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
};

// ── Page Component ──────────────────────────────────────────────────────────

export default async function CapturesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const tcap = await getTranslations("captures");
  const tc = await getTranslations("common");

  const statusOptions: { value: string; label: string }[] = [
    { value: "all", label: tcap("all") },
    { value: "started", label: tcap("started") },
    { value: "uploading", label: tcap("uploading") },
    { value: "processing", label: tcap("processing") },
    { value: "completed", label: tcap("completed") },
    { value: "failed", label: tcap("failed") },
  ];

  function getUploadStatusLabel(status: SessionStatus) {
    switch (status) {
      case "completed":
        return <span className="text-sm text-green-600 font-medium">{tcap("uploaded")}</span>;
      case "uploading":
        return (
          <span className="text-sm text-yellow-600 font-medium">{tcap("inProgress")}</span>
        );
      case "failed":
        return <span className="text-sm text-red-600 font-medium">{tcap("failed")}</span>;
      case "processing":
        return (
          <span className="text-sm text-blue-600 font-medium">{tcap("processing")}</span>
        );
      default:
        return (
          <span className="text-sm text-muted-foreground">{tcap("pending")}</span>
        );
    }
  }

  const supabase = await createClient();
  if (!supabase) redirect("/auth/login");

  let user;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("[DashboardCaptures] getUser error:", error.message);
    }
    user = data.user;
  } catch (err) {
    console.error("[DashboardCaptures] getUser threw:", err);
  }
  if (!user) redirect("/auth/login");

  const { organization } = await getUserOrganization(user.id);

  if (!organization) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Card className="max-w-md border-0 shadow-lg">
          <CardHeader>
            <CardTitle>{tc("noOrganization")}</CardTitle>
            <CardDescription>
              {tcap("noOrganizationDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><a href="/onboarding">{tc("createOrganization")}</a></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const params = await searchParams;
  const statusFilter = params.status;
  const currentStatus = statusFilter || "all";

  const { sessions, total } = await getOrgCaptureSessions(organization.id, {
    status:
      currentStatus !== "all" ? currentStatus : undefined,
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tcap("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {tcap("sessionTotal", { count: total })}
        </p>
      </div>

      {/* Status Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {statusOptions.map((opt) => {
          const isActive = currentStatus === opt.value;
          return (
            <Link
              key={opt.value}
              href={
                opt.value === "all"
                  ? "/dashboard/captures"
                  : `/dashboard/captures?status=${opt.value}`
              }
              className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors border ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      {/* Table or Empty State */}
      {sessions.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Camera className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">{tcap("noSessions")}</h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              {statusFilter
                ? tcap("noSessionsFilterHint", { status: statusFilter })
                : tcap("noSessionsEmpty")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tcap("propertyLabel")}</TableHead>
                  <TableHead>{tcap("statusLabel")}</TableHead>
                  <TableHead className="text-right">{tcap("totalImagesLabel")}</TableHead>
                  <TableHead>{tcap("uploadStatusLabel")}</TableHead>
                  <TableHead>{tcap("createdLabel")}</TableHead>
                  <TableHead className="text-right">{tcap("actionsLabel")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => {
                  const badgeStyle = statusBadgeStyles[session.status];
                  return (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {session.property_title}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                        >
                          {session.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {session.total_images}
                      </TableCell>
                      <TableCell>{getUploadStatusLabel(session.status)}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {format(new Date(session.started_at), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/property/${session.property_id}`}>
                            <Eye className="mr-1 h-4 w-4" />
                            {tcap("viewProperty")}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
