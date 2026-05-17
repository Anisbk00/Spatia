import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  getDashboardKPIs,
  getRecentActivity,
  getProcessingQueue,
  getUserOrganization,
  type ActivityItem,
  type ProcessingQueueStatus,
} from "@/lib/supabase/dashboard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Home,
  Camera,
  Box,
  BarChart3,
  Plus,
  ArrowUpRight,
  Activity,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  HardDrive,
  Eye,
  Building2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ============================================
// Helper: format storage in MB/GB
// ============================================
function formatStorage(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb.toFixed(0)} MB`;
}

// ============================================
// Helper: format large numbers
// ============================================
function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toLocaleString();
}

// ============================================
// Helper: activity icon by type
// ============================================
function ActivityIcon({ type }: { type: ActivityItem["type"] }) {
  switch (type) {
    case "property_created":
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
          <Building2 className="h-4 w-4" />
        </div>
      );
    case "capture_completed":
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
          <Camera className="h-4 w-4" />
        </div>
      );
    case "scene_ready":
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400">
          <CheckCircle2 className="h-4 w-4" />
        </div>
      );
    case "scene_failed":
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
        </div>
      );
  }
}

// ============================================
// Helper: job status badge
// ============================================
function JobStatusBadge({
  status,
  td,
}: {
  status: string;
  td: Awaited<ReturnType<typeof getTranslations>>;
}) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          {td("completed")}
        </Badge>
      );
    case "running":
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          {td("running")}
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border-0">
          <AlertCircle className="mr-1 h-3 w-3" />
          {td("failed")}
        </Badge>
      );
    case "queued":
      return (
        <Badge variant="secondary" className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-0">
          <Clock className="mr-1 h-3 w-3" />
          {td("queued")}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ============================================
// Helper: job type display name
// ============================================
function jobTypeLabel(
  type: string,
  td: Awaited<ReturnType<typeof getTranslations>>
): string {
  switch (type) {
    case "sfm_reconstruction":
      return td("jobSfm");
    case "gaussian_splat_generation":
      return td("jobSplat");
    case "optimization":
      return td("jobOptimization");
    case "thumbnail_generation":
      return td("jobThumbnail");
    default:
      return type;
  }
}

// ============================================
// No Organization CTA
// ============================================
function NoOrganizationCTA({
  tc,
}: {
  tc: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">{tc("noOrganization")}</CardTitle>
          <CardDescription>
            {tc("noOrganizationDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild size="lg">
            <Link href="/onboarding">
              <Plus className="mr-2 h-4 w-4" />
              {tc("createOrganization")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// KPI Card
// ============================================
function KPICard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  value,
  description,
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card className="py-0">
      <CardContent className="p-6">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

// ============================================
// Main Page
// ============================================
export default async function DashboardPage() {
  const td = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  const supabase = await createClient();

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>{td("supabaseNotConfigured")}</CardTitle>
            <CardDescription>
              {td("supabaseNotConfiguredDesc")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Get user's organization
  const { organization } = await getUserOrganization(user.id);

  // No organization — show CTA
  if (!organization) {
    return <NoOrganizationCTA tc={tc} />;
  }

  const orgId = organization.id;

  // Fetch all dashboard data in parallel
  const [kpis, activity, queue] = await Promise.all([
    getDashboardKPIs(orgId),
    getRecentActivity(orgId, 10),
    getProcessingQueue(orgId),
  ]);

  return (
    <div className="flex flex-col gap-8 p-4 sm:p-6 lg:p-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {td("title")}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {td("overviewDesc")}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <KPICard
          icon={Home}
          iconBg="bg-emerald-100 dark:bg-emerald-950"
          iconColor="text-emerald-600 dark:text-emerald-400"
          title={td("totalProperties")}
          value={formatNumber(kpis.totalProperties)}
          description={td("propertyCount", { count: kpis.totalProperties })}
        />
        <KPICard
          icon={Box}
          iconBg="bg-sky-100 dark:bg-sky-950"
          iconColor="text-sky-600 dark:text-sky-400"
          title={td("activeScenes")}
          value={formatNumber(kpis.activeScenes)}
          description={td("scenesReadyToView")}
        />
        <KPICard
          icon={Eye}
          iconBg="bg-amber-100 dark:bg-amber-950"
          iconColor="text-amber-600 dark:text-amber-400"
          title={td("monthlyViews")}
          value={formatNumber(kpis.monthlyViews)}
          description={td("viewsThisMonth")}
        />
        <KPICard
          icon={HardDrive}
          iconBg="bg-violet-100 dark:bg-violet-950"
          iconColor="text-violet-600 dark:text-violet-400"
          title={td("storageUsed")}
          value={formatStorage(kpis.storageUsedMB)}
          description={td("totalStorageConsumed")}
        />
        <KPICard
          icon={BarChart3}
          iconBg="bg-rose-100 dark:bg-rose-950"
          iconColor="text-rose-600 dark:text-rose-400"
          title={td("scenesThisMonth")}
          value={formatNumber(kpis.scenesGeneratedThisMonth)}
          description={td("scenesGenerated")}
        />
      </div>

      {/* Two-column layout: Activity + Queue */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Recent Activity Feed */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{td("recentActivity")}</CardTitle>
              <CardDescription>
                {td("latestEvents")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Activity className="mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="font-medium text-muted-foreground">
                    {td("noActivityYet")}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground/70">
                    {td("noActivityDesc")}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {activity.map((item, i) => (
                    <div key={item.id}>
                      <Link
                        href={
                          item.propertyId
                            ? `/property/${item.propertyId}`
                            : "#"
                        }
                        className="flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50"
                      >
                        <ActivityIcon type={item.type} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-tight">
                            {item.title}
                          </p>
                          <p className="mt-0.5 truncate text-sm text-muted-foreground">
                            {item.description}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(item.timestamp), {
                            addSuffix: true,
                          })}
                        </span>
                      </Link>
                      {i < activity.length - 1 && (
                        <Separator className="ml-14" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Processing Queue Widget */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{td("processingQueue")}</CardTitle>
              <CardDescription>
                {td("activeRecentJobs")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Queue Summary */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/50 p-3 text-center">
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-400">
                    {queue.running}
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    {td("running")}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 text-center">
                  <p className="text-lg font-bold text-gray-600 dark:text-gray-400">
                    {queue.queued}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    {td("queued")}
                  </p>
                </div>
                <div className="rounded-lg bg-red-50 dark:bg-red-950/50 p-3 text-center">
                  <p className="text-lg font-bold text-red-700 dark:text-red-400">
                    {queue.failed}
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-500">
                    {td("failed")}
                  </p>
                </div>
              </div>

              {/* Recent Jobs */}
              {queue.jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Loader2 className="mb-2 h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {td("noProcessingJobs")}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">
                    {td("jobsWillAppear")}
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {queue.jobs.slice(0, 8).map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {jobTypeLabel(job.job_type, td)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {td("scene")} {job.scene_id.slice(0, 8)}…
                          {job.started_at && (
                            <span className="ml-1">
                              ·{" "}
                              {formatDistanceToNow(new Date(job.started_at), {
                                addSuffix: true,
                              })}
                            </span>
                          )}
                        </p>
                      </div>
                      <JobStatusBadge status={job.status} td={td} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">{td("quickActions")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/properties/new" className="group">
            <Card className="h-full transition-shadow hover:shadow-md py-0">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 transition-colors group-hover:bg-emerald-600 group-hover:text-white dark:bg-emerald-950 dark:text-emerald-400 dark:group-hover:bg-emerald-600 dark:group-hover:text-white">
                  <Plus className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{td("newProperty")}</p>
                  <p className="text-sm text-muted-foreground">
                    {td("newPropertyDesc")}
                  </p>
                </div>
                <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/dashboard/captures" className="group">
            <Card className="h-full transition-shadow hover:shadow-md py-0">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 transition-colors group-hover:bg-amber-600 group-hover:text-white dark:bg-amber-950 dark:text-amber-400 dark:group-hover:bg-amber-600 dark:group-hover:text-white">
                  <Camera className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{td("startCapture")}</p>
                  <p className="text-sm text-muted-foreground">
                    {td("startCaptureDesc")}
                  </p>
                </div>
                <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/dashboard/billing" className="group">
            <Card className="h-full transition-shadow hover:shadow-md py-0">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 transition-colors group-hover:bg-violet-600 group-hover:text-white dark:bg-violet-950 dark:text-violet-400 dark:group-hover:bg-violet-600 dark:group-hover:text-white">
                  <BarChart3 className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{td("upgradePlan")}</p>
                  <p className="text-sm text-muted-foreground">
                    {td("upgradePlanDesc")}
                  </p>
                </div>
                <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
