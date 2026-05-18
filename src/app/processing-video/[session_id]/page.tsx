"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SpatiaLogo } from "@/components/SpatiaLogo";
import {
  Check,
  Loader2,
  AlertTriangle,
  ArrowLeft,
  RotateCcw,
  Video,
  ScanLine,
  Cpu,
  Box,
  Sparkles,
  Clock,
} from "lucide-react";

interface PipelineStage {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
}

const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: "uploaded",
    label: "Video Uploaded",
    description: "Your walkthrough video has been received.",
    icon: Video,
  },
  {
    id: "extracting",
    label: "Frame Extraction",
    description: "Extracting high-quality frames from your video...",
    icon: ScanLine,
  },
  {
    id: "reconstructing",
    label: "3D Reconstruction",
    description: "LingBot-Map is building the 3D spatial model...",
    icon: Cpu,
  },
  {
    id: "generating",
    label: "Scene Generation",
    description: "Converting 3D data into an interactive scene...",
    icon: Box,
  },
  {
    id: "optimizing",
    label: "Optimization",
    description: "Compressing and optimizing for smooth viewing...",
    icon: Sparkles,
  },
];

interface StatusResponse {
  session_id: string;
  property_id: string;
  scene_id: string | null;
  stage: string;
  progress: number;
  estimated_time_remaining: number;
  error: string | null;
  jobs: Array<{ type: string; status: string }>;
}

export default function VideoProcessingPage({
  params,
}: {
  params: Promise<{ session_id: string }>;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string>("");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth guard
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      if (!supabase) { router.push("/auth/login"); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/auth/login"); return; }
    };
    checkAuth();
  }, [router]);

  // Unwrap params
  useEffect(() => {
    params.then((p) => setSessionId(p.session_id));
  }, [params]);

  // Poll for status
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;

    try {
      const res = await fetch(`/api/video/status?session_id=${sessionId}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to fetch status");
        return;
      }

      setStatus(data);
      setError(null);

      // If complete, redirect to viewer
      if (data.stage === "completed" && data.property_id) {
        if (pollInterval.current) {
          clearInterval(pollInterval.current);
        }
        setTimeout(() => {
          router.push(`/view/${data.property_id}`);
        }, 2000);
      }
    } catch (err) {
      console.error("[ProcessingVideo] Status fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, router]);

  useEffect(() => {
    if (!sessionId) return;

    fetchStatus();
    pollInterval.current = setInterval(fetchStatus, 3000);

    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, [sessionId, fetchStatus]);

  const currentStageIndex = PIPELINE_STAGES.findIndex(
    (s) => s.id === status?.stage
  );
  const isFailed = status?.stage === "failed";
  const isCompleted = status?.stage === "completed";

  const formatTime = (seconds: number): string => {
    if (seconds <= 0) return "Almost done";
    if (seconds < 60) return `~${Math.round(seconds)}s remaining`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `~${mins}m ${secs}s remaining`;
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      {/* Top Nav */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <SpatiaLogo size="md" />
            <span className="font-semibold tracking-tight">Spatia</span>
          </div>
          <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50">
            <Cpu className="mr-1 h-3 w-3" />
            Processing
          </Badge>
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
            Back to Explore
          </a>

          <Card className="border-0 shadow-xl shadow-emerald-900/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-2xl font-bold tracking-tight">
                {isCompleted
                  ? "Scene Ready!"
                  : isFailed
                  ? "Processing Failed"
                  : "Creating Your 3D Scene"}
              </CardTitle>
              {!isCompleted && !isFailed && (
                <p className="text-sm text-muted-foreground mt-1">
                  {status?.estimated_time_remaining
                    ? formatTime(status.estimated_time_remaining)
                    : "This may take a few minutes"}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Progress bar */}
              {!isFailed && (
                <div className="space-y-2">
                  <Progress
                    value={status?.progress ?? 0}
                    className="h-2.5"
                  />
                  <p className="text-xs text-right text-muted-foreground">
                    {status?.progress ?? 0}%
                  </p>
                </div>
              )}

              {/* Pipeline timeline */}
              <div className="space-y-0">
                {PIPELINE_STAGES.map((stage, index) => {
                  const isDone =
                    isCompleted ||
                    currentStageIndex > index ||
                    (status?.jobs?.some(
                      (j) =>
                        (stage.id === "extracting" &&
                          j.type === "frame_extraction" &&
                          j.status === "completed") ||
                        (stage.id === "reconstructing" &&
                          j.type === "video_reconstruction" &&
                          j.status === "completed") ||
                        (stage.id === "generating" &&
                          j.type === "splat_generation" &&
                          j.status === "completed")
                    ) ??
                    false);

                  const isActive =
                    !isFailed &&
                    !isCompleted &&
                    currentStageIndex === index;

                  const isPending =
                    !isFailed && !isCompleted && currentStageIndex < index;

                  return (
                    <div key={stage.id} className="flex gap-3">
                      {/* Timeline connector */}
                      <div className="flex flex-col items-center">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                            isDone
                              ? "bg-emerald-600 border-emerald-600 text-white"
                              : isActive
                              ? "bg-emerald-50 border-emerald-300 text-emerald-600"
                              : isFailed && currentStageIndex === index
                              ? "bg-red-50 border-red-300 text-red-500"
                              : "bg-gray-50 border-gray-200 text-gray-400"
                          }`}
                        >
                          {isDone ? (
                            <Check className="h-4 w-4" />
                          ) : isActive ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isFailed && currentStageIndex === index ? (
                            <AlertTriangle className="h-4 w-4" />
                          ) : (
                            <stage.icon className="h-4 w-4" />
                          )}
                        </div>
                        {index < PIPELINE_STAGES.length - 1 && (
                          <div
                            className={`w-0.5 h-8 ${
                              isDone ? "bg-emerald-300" : "bg-gray-200"
                            }`}
                          />
                        )}
                      </div>

                      {/* Stage content */}
                      <div className="pb-4">
                        <p
                          className={`text-sm font-medium ${
                            isDone
                              ? "text-emerald-700"
                              : isActive
                              ? "text-foreground"
                              : isPending
                              ? "text-muted-foreground"
                              : "text-red-600"
                          }`}
                        >
                          {stage.label}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {stage.description}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Final stage: Complete */}
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${
                        isCompleted
                          ? "bg-emerald-600 border-emerald-600 text-white"
                          : "bg-gray-50 border-gray-200 text-gray-400"
                      }`}
                    >
                      {isCompleted ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </div>
                  </div>
                  <div>
                    <p
                      className={`text-sm font-medium ${
                        isCompleted ? "text-emerald-700" : "text-muted-foreground"
                      }`}
                    >
                      Complete
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {isCompleted
                        ? "Your 3D scene is ready to explore!"
                        : "Waiting for pipeline to complete..."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Error state */}
              {isFailed && status?.error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{status.error}</AlertDescription>
                </Alert>
              )}

              {/* Actions */}
              {isFailed && (
                <Button
                  onClick={() => fetchStatus()}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              )}

              {isCompleted && (
                <Button
                  onClick={() => {
                    if (status?.property_id) {
                      router.push(`/view/${status.property_id}`);
                    }
                  }}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Box className="mr-2 h-4 w-4" />
                  View 3D Scene
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Info card */}
          {!isCompleted && !isFailed && (
            <div className="mt-4 rounded-xl bg-emerald-50/50 p-4 flex gap-3">
              <Clock className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-emerald-800">
                  Processing in progress
                </p>
                <p className="text-xs text-emerald-700 mt-0.5">
                  You can leave this page and check back later from your dashboard.
                  We&apos;ll also send you a notification when it&apos;s ready.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        Spatia &middot; Immersive Spatial Platform
      </footer>
    </div>
  );
}
