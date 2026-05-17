"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  generateCaptureFlow,
  getCurrentStep,
  getEstimatedTotalPhotos,
  estimateRoomCount,
} from "@/lib/captureFlow";
import { UploadQueue } from "@/lib/uploadMedia";
import type { QueuedUpload } from "@/lib/uploadMedia";
import { CameraView } from "@/components/capture/CameraView";
import { InstructionPanel } from "@/components/capture/InstructionPanel";
import { ProgressBar } from "@/components/capture/ProgressBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Home,
  LogOut,
  CheckCircle2,
  X,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type { CaptureSession, Property } from "@/lib/types";

interface CaptureSessionData {
  session: CaptureSession;
  property: Property;
}

export default function CaptureSessionClient({
  sessionId,
  initialData,
}: {
  sessionId: string;
  initialData: CaptureSessionData | null;
}) {
  const router = useRouter();
  const queueRef = useRef<UploadQueue | null>(null);

  // Session data
  const [sessionData] = useState(initialData);
  const property = sessionData?.property;

  // Capture flow
  const roomCount = estimateRoomCount(property?.property_type);
  const steps = generateCaptureFlow(roomCount);

  // Photo tracking
  const [photosTaken, setPhotosTaken] = useState(
    sessionData?.session?.total_images ?? 0
  );
  const [capturedPreviews, setCapturedPreviews] = useState<string[]>([]);
  const [capturedFiles, setCapturedFiles] = useState<
    { file: File; preview: string }[]
  >([]);

  // Upload queue
  const [uploadQueue, setUploadQueue] = useState<QueuedUpload[]>([]);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Current step
  const { step: currentStep, stepIndex } = getCurrentStep(
    steps,
    photosTaken
  );
  const estimatedTotal = getEstimatedTotalPhotos(steps);
  const uploadingCount = uploadQueue.filter(
    (i) => i.status === "uploading" || i.status === "pending"
  ).length;
  const failedCount = uploadQueue.filter((i) => i.status === "failed").length;

  // Initialize upload queue
  useEffect(() => {
    if (!sessionData?.session || !property) return;

    const queue = new UploadQueue(
      sessionId,
      property.id,
      (updated) => setUploadQueue(updated)
    );
    queueRef.current = queue;

    return () => {
      // Cleanup: queue is per-mount
    };
  }, [sessionId, property, sessionData]);

  // Handle photo capture
  const handleCapture = useCallback(
    (file: File, previewUrl: string) => {
      setError(null);
      const newIndex = photosTaken + 1;

      // Optimistic update
      setPhotosTaken(newIndex);
      setCapturedPreviews((prev) => [...prev, previewUrl]);
      setCapturedFiles((prev) => [...prev, { file, preview: previewUrl }]);

      // Background upload
      queueRef.current?.add(file, newIndex);
    },
    [photosTaken]
  );

  // Delete last photo
  const handleDeleteLast = useCallback(() => {
    if (capturedPreviews.length === 0) return;

    setCapturedPreviews((prev) => prev.slice(0, -1));
    setCapturedFiles((prev) => prev.slice(0, -1));
    setPhotosTaken((prev) => Math.max(0, prev - 1));

    // Note: actual deletion from storage happens via the last uploaded result
    // For MVP, we just remove from the local list
  }, [capturedPreviews]);

  // Finish capture session
  const handleFinish = useCallback(async () => {
    setFinishing(true);
    setError(null);

    try {
      const res = await fetch(`/api/capture/${sessionId}/finish`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to finish session");
      }

      router.push(`/processing/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setFinishing(false);
    }
  }, [sessionId, router]);

  // Sign out handler
  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.push("/auth/login");
  }, [router]);

  if (!sessionData || !property) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-xl">
          <CardContent className="flex flex-col items-center py-8 text-center">
            <AlertTriangle className="mb-3 h-10 w-10 text-amber-500" />
            <p className="font-medium">Session not found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This capture session doesn&apos;t exist or you don&apos;t have
              access.
            </p>
            <a href="/dashboard">
              <Button variant="outline" className="mt-4">
                Back to Dashboard
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canFinish = photosTaken >= 6;
  const canAdvance = photosTaken >= currentStep.minPhotos;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50 to-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
              <Home className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">
                {property.title}
              </p>
              <p className="text-xs text-muted-foreground">
                Capture Session
              </p>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 space-y-5 px-4 py-5">
        <div className="mx-auto max-w-lg space-y-5">
          {/* Progress */}
          <ProgressBar
            photosTaken={photosTaken}
            estimatedTotal={estimatedTotal}
            currentStepIndex={stepIndex}
            totalSteps={steps.length}
            uploading={uploadingCount}
          />

          {/* Instruction Panel */}
          <InstructionPanel
            step={currentStep}
            stepIndex={stepIndex}
            totalSteps={steps.length}
          />

          {/* Camera */}
          <CameraView
            onCapture={handleCapture}
            lastPreview={
              capturedPreviews.length > 0
                ? capturedPreviews[capturedPreviews.length - 1]
                : null
            }
          />

          {/* Step advancement hint */}
          {canAdvance && stepIndex < steps.length - 1 && (
            <div className="rounded-xl bg-emerald-50 p-3 text-center">
              <p className="text-sm font-medium text-emerald-700">
                ✓ Enough photos for this step — continue to next area
              </p>
            </div>
          )}

          {/* Photo review strip */}
          {capturedPreviews.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Captured Photos</p>
                {capturedPreviews.length > 0 && (
                  <button
                    onClick={handleDeleteLast}
                    className="flex items-center gap-1 text-xs text-destructive hover:underline"
                  >
                    <X className="h-3 w-3" />
                    Remove last
                  </button>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {capturedPreviews.map((preview, i) => (
                  <div
                    key={i}
                    className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border"
                  >
                    <img
                      src={preview}
                      alt={`Capture ${i + 1}`}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 text-center text-[10px] text-white">
                      {i + 1}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Failed uploads warning */}
          {failedCount > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-700">
                {failedCount} photo(s) failed to upload
              </p>
              <p className="text-xs text-amber-600">
                They will be retried automatically. You can still finish the session.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">{error}</p>
            </div>
          )}

          {/* Finish button */}
          <div className="pt-2">
            <Button
              onClick={handleFinish}
              disabled={!canFinish || finishing}
              className="h-13 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
            >
              {finishing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Finishing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-5 w-5" />
                  Finish Capture Session
                </>
              )}
            </Button>
            {!canFinish && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Capture at least 6 photos to finish the session
              </p>
            )}
          </div>

          {/* Back link */}
          <div className="pb-4 text-center">
            <a
              href="/dashboard"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Save & exit to dashboard
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
