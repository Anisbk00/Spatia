"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

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

const BASE_INTERVAL_MS = 3000;
const MAX_INTERVAL_MS = 30000;
const STALE_POLL_THRESHOLD = 30;

export function ProcessingStatus({ sessionId }: ProcessingStatusProps) {
  const router = useRouter();
  const [data, setData] = useState<ProcessingStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pollError, setPollError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIntervalRef = useRef(BASE_INTERVAL_MS);
  const consecutivePollsRef = useRef(0);
  const lastStageRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch status with exponential backoff
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/process/status?session_id=${sessionId}`
      );
      if (res.ok) {
        const statusData: ProcessingStatusData = await res.json();
        setData(statusData);

        // Reset error state on successful poll
        setPollError(null);

        // Reset backoff to base interval
        currentIntervalRef.current = BASE_INTERVAL_MS;

        // Track stale detection — reset on stage change
        const currentStage = statusData.pipeline.stage;
        if (currentStage !== lastStageRef.current) {
          lastStageRef.current = currentStage;
          consecutivePollsRef.current = 0;
          setIsStale(false);
        } else {
          consecutivePollsRef.current += 1;
          if (consecutivePollsRef.current >= STALE_POLL_THRESHOLD) {
            setIsStale(true);
          }
        }

        // If complete, redirect to viewer
        if (
          statusData.pipeline.stage === "completed" &&
          statusData.scene?.modelUrl
        ) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          router.push(`/view/${statusData.session.propertyId}`);
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("[ProcessingStatus] Status poll failed:", err);
      setPollError("Connection issue — retrying...");

      // Exponential backoff on error
      currentIntervalRef.current = Math.min(
        currentIntervalRef.current * 2,
        MAX_INTERVAL_MS
      );

      // Restart interval with new backoff
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchStatus, currentIntervalRef.current);
    } finally {
      setLoading(false);
    }
  }, [sessionId, router]);

  // Poll with interval management
  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, currentIntervalRef.current);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchStatus]);

  // Elapsed timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
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

      {/* Polling error */}
      {pollError && (
        <Alert variant="destructive">
          <RefreshCw className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{pollError}</span>
            <Button
              variant="outline"
              size="sm"
              className="ml-2 h-7 shrink-0"
              onClick={() => {
                setPollError(null);
                currentIntervalRef.current = BASE_INTERVAL_MS;
                fetchStatus();
              }}
            >
              Retry Now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Info */}
      <div className="rounded-xl bg-muted/50 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          {isFailed
            ? "Processing failed. You can retry from the dashboard."
            : data.pipeline.stage === "completed"
              ? "Your 3D walkthrough is ready! Redirecting..."
              : isStale
                ? `Checking status... • ${formatTime(elapsedSec)} elapsed`
                : `Processing ${data.session.totalImages} images • ${formatTime(elapsedSec)} elapsed`}
        </p>
      </div>

      {/* Failed state */}
      {isFailed && (
        <Link href="/dashboard">
          <button className="h-12 w-full rounded-xl bg-destructive text-base font-semibold text-white hover:bg-destructive/90">
            Return to Dashboard
          </button>
        </Link>
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
