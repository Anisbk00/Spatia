import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getPropertyDetail,
  getUserOrganization,
} from "@/lib/supabase/dashboard";
import type { ProcessingJob } from "@/lib/types";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Edit,
  Eye,
  Camera,
  Box,
  Share2,
  Home,
  MapPin,
  DollarSign,
  Clock,
  ImageIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getTranslations } from "next-intl/server";
import { CopyButton } from "./CopyButton";
import { MediaLightbox } from "./MediaLightbox";
import { PublicUrlDisplay } from "./PublicUrlDisplay";

// ============================================
// Helper: status badge variants
// ============================================

function getPropertyStatusBadge(status: string, tprop: any) {
  const config: Record<string, { label: string; className: string }> = {
    draft: {
      label: tprop("statusDraft"),
      className: "bg-muted text-muted-foreground border-border",
    },
    capturing: {
      label: tprop("statusCapturing"),
      className: "bg-amber-100 text-amber-800 border-amber-200",
    },
    processing: {
      label: tprop("statusProcessing"),
      className: "bg-sky-100 text-sky-800 border-sky-200",
    },
    ready: {
      label: tprop("statusReady"),
      className: "bg-emerald-100 text-emerald-800 border-emerald-200",
    },
    archived: {
      label: tprop("statusArchived"),
      className: "bg-gray-100 text-gray-600 border-gray-200",
    },
  };
  const c = config[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={c.className}>
      {c.label}
    </Badge>
  );
}

function getSessionStatusBadge(status: string, tp: any, tcaptures: any) {
  const config: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    started: {
      label: tp("started"),
      className: "bg-muted text-muted-foreground border-border",
      icon: <Camera className="h-3 w-3" />,
    },
    uploading: {
      label: tp("uploading"),
      className: "bg-sky-100 text-sky-800 border-sky-200",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    processing: {
      label: tcaptures("processing"),
      className: "bg-amber-100 text-amber-800 border-amber-200",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    completed: {
      label: tp("completed"),
      className: "bg-emerald-100 text-emerald-800 border-emerald-200",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    failed: {
      label: tcaptures("failed"),
      className: "bg-red-100 text-red-800 border-red-200",
      icon: <AlertCircle className="h-3 w-3" />,
    },
  };
  const c = config[status] ?? { label: status, className: "", icon: null };
  return (
    <Badge variant="outline" className={`gap-1 ${c.className}`}>
      {c.icon}
      {c.label}
    </Badge>
  );
}

function getSceneStatusBadge(status: string, tprop: any, tdashboard: any) {
  const config: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    queued: {
      label: tdashboard("queued"),
      className: "bg-muted text-muted-foreground border-border",
      icon: <Clock className="h-3 w-3" />,
    },
    processing: {
      label: tprop("statusProcessing"),
      className: "bg-amber-100 text-amber-800 border-amber-200",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    ready: {
      label: tprop("statusReady"),
      className: "bg-emerald-100 text-emerald-800 border-emerald-200",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    failed: {
      label: tdashboard("failed"),
      className: "bg-red-100 text-red-800 border-red-200",
      icon: <AlertCircle className="h-3 w-3" />,
    },
  };
  const c = config[status] ?? { label: status, className: "", icon: null };
  return (
    <Badge variant="outline" className={`gap-1 ${c.className}`}>
      {c.icon}
      {c.label}
    </Badge>
  );
}

// ============================================
// Helper: format price
// ============================================

function formatPrice(price: number | null, currency: string): string {
  if (price === null || price === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  } catch (err) {
    console.error("[PropertyDetail] Price formatting failed:", err);
    return `${currency} ${price.toLocaleString()}`;
  }
}

// ============================================
// Helper: format processing time
// ============================================

function formatProcessingTime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

// ============================================
// Helper: property type label
// ============================================

function getPropertyTypeLabel(type: string | null, tprop: any): string {
  if (!type) return "—";
  const labels: Record<string, string> = {
    apartment: tprop("apartment"),
    house: tprop("house"),
    villa: tprop("villa"),
    office: tprop("office"),
    land: tprop("land"),
  };
  return labels[type] ?? type;
}

// ============================================
// Page component
// ============================================

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ property_id: string }>;
}) {
  const { property_id } = await params;

  // Get translations
  const tp = await getTranslations("propertyDetail");
  const tprop = await getTranslations("property");
  const tc = await getTranslations("common");
  const tcaptures = await getTranslations("captures");
  const tdashboard = await getTranslations("dashboard");

  // Get authenticated user
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    console.error("[PropertyDetailPage] Failed to create Supabase client:", err);
  }

  if (!supabase) {
    notFound();
  }

  let user;
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    user = authUser;
  } catch (err) {
    console.error("[PropertyDetailPage] Failed to get user:", err);
  }

  if (!user) {
    notFound();
  }

  // Get user's organization
  let organization;
  try {
    const orgResult = await getUserOrganization(user.id);
    organization = orgResult.organization;
  } catch (err) {
    console.error("[PropertyDetailPage] Failed to get organization:", err);
  }

  if (!organization) {
    notFound();
  }

  // Fetch property detail (already scoped to org)
  const property = await getPropertyDetail(property_id, organization.id);
  if (!property) {
    notFound();
  }

  // Fetch processing jobs for scenes
  const sceneIds = property.scenes.map((s) => s.id);
  let processingJobs: ProcessingJob[] = [];
  if (sceneIds.length > 0) {
    try {
      const { data: jobs, error: jobsError } = await supabase
        .from("processing_jobs")
        .select("*")
        .in("scene_id", sceneIds)
        .order("started_at", { ascending: false });
      if (jobsError) {
        console.error("[PropertyDetailPage] Processing jobs query error:", jobsError.message);
      }
      processingJobs = (jobs || []) as ProcessingJob[];
    } catch (err) {
      console.error("[PropertyDetailPage] Failed to fetch processing jobs:", err);
    }
  }

  // Derive the primary (latest) scene
  const primaryScene = property.scenes[0] ?? null;

  // Public viewer URL
  const publicViewerUrl = `/view/${property_id}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ======== Header ======== */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <a href="/dashboard/properties" aria-label={tc("back")}>
              <ArrowLeft className="h-4 w-4" />
            </a>
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight truncate sm:text-2xl">
                {property.title}
              </h1>
              {getPropertyStatusBadge(property.status, tprop)}
            </div>
            {property.address && (
              <p className="mt-0.5 text-sm text-muted-foreground truncate">
                {property.address}
                {property.city ? `, ${property.city}` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {primaryScene?.status === "ready" && (
            <Button asChild size="sm" className="gap-1.5">
              <a href={publicViewerUrl}>
                <Eye className="h-4 w-4" />
                {tp("openInViewer")}
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <a href={`/dashboard/properties/${property_id}/edit`}>
              <Edit className="h-4 w-4" />
              {tc("edit")}
            </a>
          </Button>
        </div>
      </div>

      <Separator />

      {/* ======== Tabbed Content ======== */}
      <Tabs defaultValue="info" className="w-full">
        <TabsList className="w-full sm:w-auto flex flex-wrap">
          <TabsTrigger value="info" className="gap-1.5">
            <Home className="h-3.5 w-3.5 hidden sm:inline-block" />
            {tp("info")}
          </TabsTrigger>
          <TabsTrigger value="media" className="gap-1.5">
            <ImageIcon className="h-3.5 w-3.5 hidden sm:inline-block" />
            {tp("media")}
            {property.media.length > 0 && (
              <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                {property.media.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="captures" className="gap-1.5">
            <Camera className="h-3.5 w-3.5 hidden sm:inline-block" />
            {tp("captures")}
          </TabsTrigger>
          <TabsTrigger value="scene" className="gap-1.5">
            <Box className="h-3.5 w-3.5 hidden sm:inline-block" />
            {tp("sceneTab")}
          </TabsTrigger>
          <TabsTrigger value="sharing" className="gap-1.5">
            <Share2 className="h-3.5 w-3.5 hidden sm:inline-block" />
            {tp("sharing")}
          </TabsTrigger>
        </TabsList>

        {/* ===== Info Tab ===== */}
        <TabsContent value="info" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{tp("propertyDetails")}</CardTitle>
              <CardDescription>
                {tp("propertyDetailsDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                {/* Title */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {tp("titleLabel")}
                  </p>
                  <p className="font-semibold">{property.title}</p>
                </div>

                {/* Price */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5" />
                    {tp("priceLabel")}
                  </p>
                  <p className="font-semibold text-lg">
                    {formatPrice(property.price, property.currency)}
                  </p>
                </div>

                {/* Address */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {tp("addressLabel")}
                  </p>
                  <p className="font-medium">
                    {property.address || "—"}
                  </p>
                </div>

                {/* City + Country */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {tp("locationLabel")}
                  </p>
                  <p className="font-medium">
                    {[property.city, property.country].filter(Boolean).join(", ") || "—"}
                  </p>
                </div>

                {/* Property Type */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Home className="h-3.5 w-3.5" />
                    {tp("propertyTypeLabel")}
                  </p>
                  <p className="font-medium">
                    {getPropertyTypeLabel(property.property_type, tprop)}
                  </p>
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {tp("statusLabel")}
                  </p>
                  <div>{getPropertyStatusBadge(property.status, tprop)}</div>
                </div>

                {/* Views */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Eye className="h-3.5 w-3.5" />
                    {tp("totalViewsLabel")}
                  </p>
                  <p className="font-medium tabular-nums">{property.view_count}</p>
                </div>

                {/* Created Date */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {tp("createdLabel")}
                  </p>
                  <p className="font-medium">
                    {formatDistanceToNow(new Date(property.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </div>

              {/* Description */}
              {property.description && (
                <>
                  <Separator className="my-6" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      {tp("descriptionLabel")}
                    </p>
                    <p className="whitespace-pre-line text-sm leading-relaxed">
                      {property.description}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Media Tab ===== */}
        <TabsContent value="media" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                {tp("mediaGallery")}
              </CardTitle>
              <CardDescription>
                {property.media.length > 0
                  ? tp("imageCount", { count: property.media.length })
                  : tp("noImages")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MediaLightbox
                media={property.media.map((m) => ({
                  id: m.id,
                  url: m.url,
                  type: m.type,
                  order_index: m.order_index,
                }))}
                propertyTitle={property.title}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Captures Tab ===== */}
        <TabsContent value="captures" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5" />
                {tp("captureSessions")}
              </CardTitle>
              <CardDescription>
                {property.capture_sessions.length > 0
                  ? tp("sessionCount", { count: property.capture_sessions.length })
                  : tp("noCaptureSessions")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {property.capture_sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Camera className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-muted-foreground">
                    {tp("noCaptureSessions")}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground/70">
                    {tp("noSessionsDesc")}
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {property.capture_sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between rounded-lg border p-4 gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">
                            Session {session.id.slice(0, 8)}
                          </p>
                          {getSessionStatusBadge(session.status, tp, tcaptures)}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" />
                            {tp("imageCountShort", { count: session.total_images })}
                          </span>
                          {session.device_type && (
                            <span>{session.device_type}</span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(session.started_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </div>
                      {session.status === "completed" && (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={`/capture/${session.id}`}>{tp("viewSession")}</a>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== 3D Scene Tab ===== */}
        <TabsContent value="scene" className="mt-4 space-y-4">
          {primaryScene ? (
            <>
              {/* Scene Overview */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Box className="h-5 w-5" />
                    {tp("threeDScene")}
                  </CardTitle>
                  <CardDescription>
                    {tp("sceneDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-6 sm:grid-cols-2">
                    {/* Scene Status */}
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">
                        {tp("statusLabel")}
                      </p>
                      <div>{getSceneStatusBadge(primaryScene.status, tprop, tdashboard)}</div>
                    </div>

                    {/* Quality Score */}
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">
                        {tp("qualityScore")}
                      </p>
                      {primaryScene.quality_score !== null ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold tabular-nums">
                              {Math.round(primaryScene.quality_score * 100)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              / 100
                            </span>
                          </div>
                          <Progress
                            value={Math.round(primaryScene.quality_score * 100)}
                            className="h-2"
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {tp("notEvaluated")}
                        </p>
                      )}
                    </div>

                    {/* Processing Time */}
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {tp("processingTime")}
                      </p>
                      <p className="font-medium">
                        {formatProcessingTime(primaryScene.processing_time_seconds)}
                      </p>
                    </div>

                    {/* Created */}
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">
                        {tp("createdLabel")}
                      </p>
                      <p className="font-medium">
                        {formatDistanceToNow(new Date(primaryScene.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>

                  {/* Open in Viewer CTA */}
                  {primaryScene.status === "ready" && (
                    <>
                      <Separator className="my-6" />
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-200 p-4">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-emerald-900">
                            {tp("sceneReady")}
                          </p>
                          <p className="text-sm text-emerald-700">
                            {tp("sceneReadyDesc")}
                          </p>
                        </div>
                        <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
                          <a href={publicViewerUrl}>
                            <Eye className="h-4 w-4 mr-1.5" />
                            {tp("openInViewer")}
                          </a>
                        </Button>
                      </div>
                    </>
                  )}

                  {/* Processing message */}
                  {primaryScene.status === "processing" && (
                    <>
                      <Separator className="my-6" />
                      <div className="flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4">
                        <Loader2 className="h-5 w-5 text-amber-600 animate-spin shrink-0" />
                        <div className="flex-1">
                          <p className="font-medium text-amber-900">
                            {tp("sceneProcessing")}
                          </p>
                          <p className="text-sm text-amber-700">
                            {tp("sceneProcessingDesc")}
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Failed message */}
                  {primaryScene.status === "failed" && (
                    <>
                      <Separator className="my-6" />
                      <div className="flex items-center gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
                        <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                        <div className="flex-1">
                          <p className="font-medium text-red-900">
                            {tp("sceneFailed")}
                          </p>
                          <p className="text-sm text-red-700">
                            {tp("sceneFailedDesc")}
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Processing Logs */}
              {processingJobs.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {tp("processingLogs")}
                    </CardTitle>
                    <CardDescription>
                      {tp("processingLogsDesc")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {processingJobs.map((job) => {
                        const jobStatusConfig: Record<string, { className: string }> = {
                          queued: { className: "bg-muted text-muted-foreground border-border" },
                          running: { className: "bg-sky-100 text-sky-800 border-sky-200" },
                          completed: { className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
                          failed: { className: "bg-red-100 text-red-800 border-red-200" },
                        };
                        const statusStyle = jobStatusConfig[job.status] ?? { className: "" };

                        return (
                          <div
                            key={job.id}
                            className="flex items-center justify-between rounded-md border p-3 text-sm gap-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium font-mono text-xs">
                                  {job.job_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                </span>
                                <Badge variant="outline" className={statusStyle.className}>
                                  {job.status}
                                </Badge>
                                {job.retry_count > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    {tp("retryCount", { count: job.retry_count })}
                                  </span>
                                )}
                              </div>
                              {job.logs && (
                                <p className="mt-1 text-xs text-muted-foreground truncate max-w-md">
                                  {job.logs}
                                </p>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground shrink-0">
                              {job.started_at
                                ? formatDistanceToNow(new Date(job.started_at), { addSuffix: true })
                                : tp("pending")}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Additional scenes (if multiple) */}
              {property.scenes.length > 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {tp("allScenes", { count: property.scenes.length })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {property.scenes.map((scene, index) => (
                        <div
                          key={scene.id}
                          className="flex items-center justify-between rounded-md border p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              #{index + 1}
                            </span>
                            {getSceneStatusBadge(scene.status, tprop, tdashboard)}
                            {scene.quality_score !== null && (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {tp("scoreLabel")}: {Math.round(scene.quality_score * 100)}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(scene.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            /* No scene — show CTA */
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <Box className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold">{tp("noSceneYet")}</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {tp("noSceneDesc")}
                </p>
                <Button asChild className="mt-6 gap-1.5">
                  <a href={`/capture/new?property_id=${property_id}`}>
                    <Camera className="h-4 w-4" />
                    {tp("startCaptureSession")}
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== Sharing Tab ===== */}
        <TabsContent value="sharing" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                {tp("publicSharing")}
              </CardTitle>
              <CardDescription>
                {tp("publicSharingDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Public URL */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {tp("publicViewerUrl")}
                </p>
                <div className="flex items-center gap-2">
                  <PublicUrlDisplay path={publicViewerUrl} />
                  <CopyButton path={publicViewerUrl} />
                </div>
              </div>

              {/* Open Viewer */}
              {primaryScene?.status === "ready" ? (
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button asChild className="gap-1.5">
                    <a href={publicViewerUrl}>
                      <Eye className="h-4 w-4" />
                      {tp("openInViewer")}
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-900">
                        {tp("viewerNotAvailable")}
                      </p>
                      <p className="mt-0.5 text-sm text-amber-700">
                        {primaryScene?.status === "processing"
                          ? tp("viewerProcessing")
                          : primaryScene?.status === "failed"
                            ? tp("viewerFailed")
                            : tp("viewerNoScene")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* View count */}
              <Separator />
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Eye className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {property.view_count}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {tp("totalViewsOnProperty")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
