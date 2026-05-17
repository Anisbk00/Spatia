"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface PipelineStage {
  stage: string;
  label: string;
  progress: number;
}

interface ProcessingStatusData {
  session: {
    id: string;
    status: string;
    totalImages: number;
    propertyId: string;
  };
  scene: {
    id: string;
    status: string;
    modelUrl: string | null;
    thumbnailUrl: string | null;
    qualityScore: number | null;
    processingTimeSec: number | null;
  } | null;
  pipeline: PipelineStage;
}

interface ProcessingStatusProps {
  sessionId: string;
}

const STAGE_ICONS = [
  { key: "upload", label: "Uploading images", icon: "📸" },
  { key: "queued", label: "Queued for processing", icon: "⏳" },
  { key: "sfm", label: "Analyzing images", icon: "🔍" },
  { key: "splat", label: "Building 3D model", icon: "🧊" },
  { key: "optimization", label: "Optimizing scene", icon: "⚡" },
  { key: "packaging", label: "Packaging for web", icon: "📦" },
  { key: "completed", label: "3D Scene Ready", icon: "✅" },
  { key: "failed", label: "Processing Failed", icon: "❌" },
];

export function ProcessingStatus({ sessionId }: ProcessingStatusProps) {
  const router = useRouter();
  const [data, setData] = useState<ProcessingStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/process/status?session_id=${sessionId}`
      );
      if (res.ok) {
        const statusData: ProcessingStatusData = await res.json();
        setData(statusData);

        // If complete, redirect to viewer
        if (
          statusData.pipeline.stage === "completed" &&
          statusData.scene?.modelUrl
        ) {
          router.push(`/viewer/${statusData.session.propertyId}`);
        }
      }
    } catch (err) {
      console.error("[ProcessingStatus] Status poll failed:", err);
      // Network error — will retry on next poll
    } finally {
      setLoading(false);
    }
  }, [sessionId, router]);

  // Poll every 3 seconds
  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus]);

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  const currentStageIdx = STAGE_ICONS.findIndex(
    (s) => s.key === data.pipeline.stage
  );
  const isFailed = data.pipeline.stage === "failed";

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{data.pipeline.label}</span>
          <span className="text-muted-foreground">{data.pipeline.progress}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-out ${
              isFailed
                ? "bg-destructive"
                : data.pipeline.stage === "completed"
                  ? "bg-emerald-600"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${data.pipeline.progress}%` }}
          />
        </div>
      </div>

      {/* Stage list */}
      <div className="space-y-2">
        {STAGE_ICONS.map((stage, i) => {
          const isCurrent = i === currentStageIdx;
          const isDone = i < currentStageIdx || data.pipeline.stage === "completed";
          const isPending = i > currentStageIdx;

          return (
            <div
              key={stage.key}
              className={`flex items-center gap-3 rounded-xl p-3 transition-colors ${
                isCurrent
                  ? "bg-emerald-50 ring-1 ring-emerald-200"
                  : isDone
                    ? "bg-emerald-50/50"
                    : "bg-muted/30"
              }`}
            >
              <span className="text-lg">{stage.icon}</span>
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${
                    isPending ? "text-muted-foreground" : ""
                  }`}
                >
                  {stage.label}
                </p>
              </div>
              {isDone && (
                <span className="text-xs font-medium text-emerald-600">Done</span>
              )}
              {isCurrent && !isFailed && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
              )}
              {isCurrent && isFailed && (
                <span className="text-xs font-medium text-destructive">
                  Failed
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div className="rounded-xl bg-muted/50 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          {isFailed
            ? "Processing failed. You can retry from the dashboard."
            : data.pipeline.stage === "completed"
              ? "Your 3D walkthrough is ready! Redirecting..."
              : `Processing ${data.session.totalImages} images • ${formatTime(elapsedSec)} elapsed`}
        </p>
      </div>

      {/* Failed state */}
      {isFailed && (
        <a href="/dashboard">
          <button className="h-12 w-full rounded-xl bg-destructive text-base font-semibold text-white hover:bg-destructive/90">
            Return to Dashboard
          </button>
        </a>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}
