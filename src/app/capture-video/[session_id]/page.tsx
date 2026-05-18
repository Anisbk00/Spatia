"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SpatiaLogo } from "@/components/SpatiaLogo";
import {
  Video,
  Upload,
  Check,
  Clock,
  AlertTriangle,
  ArrowLeft,
  RotateCcw,
  Smartphone,
  Eye,
  Move,
  Lightbulb,
  Loader2,
} from "lucide-react";
import {
  uploadVideoFile,
  getVideoMetadata,
  formatFileSize,
  formatDuration,
  validateVideoFile,
} from "@/lib/video/videoUpload";

type Phase = "instructions" | "preview" | "uploading" | "complete";

interface RecordingTip {
  icon: React.ElementType;
  title: string;
  description: string;
}

const RECORDING_TIPS: RecordingTip[] = [
  {
    icon: Move,
    title: "Walk slowly through the property",
    description: "Move at a steady, deliberate pace to capture smooth footage.",
  },
  {
    icon: Eye,
    title: "Keep camera stable and steady",
    description: "Hold your phone with both hands and minimize shaking.",
  },
  {
    icon: Smartphone,
    title: "Cover each room fully",
    description: "Sweep the camera across each room in a wide arc, floor to ceiling.",
  },
  {
    icon: RotateCcw,
    title: "Avoid rapid camera movement",
    description: "Quick pans or rotations reduce 3D reconstruction quality.",
  },
  {
    icon: Lightbulb,
    title: "Ensure good lighting",
    description: "Turn on all lights. Avoid dark rooms and bright windows.",
  },
];

const MIN_DURATION = 30; // seconds
const MAX_DURATION = 600; // 10 minutes

export default function VideoCapturePage({
  params,
}: {
  params: Promise<{ session_id: string }>;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("instructions");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [videoCaptureId, setVideoCaptureId] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadStartTimeRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validate file
    const validation = validateVideoFile(file);
    if (!validation.valid) {
      setError(validation.error || "Invalid video file");
      return;
    }

    try {
      const metadata = await getVideoMetadata(file);

      if (metadata.duration < MIN_DURATION) {
        setError(`Video is too short (${formatDuration(metadata.duration)}). Minimum is ${formatDuration(MIN_DURATION)}.`);
        return;
      }

      if (metadata.duration > MAX_DURATION) {
        setError(`Video is too long (${formatDuration(metadata.duration)}). Maximum is ${formatDuration(MAX_DURATION)}.`);
        return;
      }

      setVideoFile(file);
      setVideoDuration(metadata.duration);
      setVideoDimensions({ width: metadata.width, height: metadata.height });
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      const url = URL.createObjectURL(file);
      setVideoPreviewUrl(url);
      setPhase("preview");
    } catch {
      setError("Could not read video metadata. Please try another file.");
    }
  }, []);

  const handleStartRecording = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleReRecord = useCallback(() => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(null);
    setVideoFile(null);
    setVideoDuration(0);
    setPhase("instructions");
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [videoPreviewUrl]);

  // Cleanup: revoke video preview URL when component unmounts or URL changes
  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  // Cleanup: abort upload on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleUpload = useCallback(async () => {
    if (!videoFile || !sessionId) return;

    setPhase("uploading");
    setError(null);
    uploadStartTimeRef.current = Date.now();

    try {
      // Step 1: Get signed upload URL
      const uploadRes = await fetch("/api/video/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          property_id: propertyId,
          file_name: videoFile.name,
          file_size: videoFile.size,
          content_type: videoFile.type,
        }),
      });

      const uploadData = await uploadRes.json();

      if (!uploadRes.ok) {
        throw new Error(uploadData.error || "Failed to prepare upload");
      }

      setVideoCaptureId(uploadData.video_capture_id);
      setStoragePath(uploadData.path);
      setPropertyId(uploadData.property_id);

      // Step 2: Upload the video file to Supabase Storage
      abortControllerRef.current = new AbortController();
      await uploadVideoFile(
        videoFile,
        uploadData.path,
        (progress, uploaded, total) => {
          setUploadProgress(progress);
          setUploadedBytes(uploaded);

          // Calculate speed
          const elapsed = (Date.now() - uploadStartTimeRef.current) / 1000;
          if (elapsed > 0) {
            setUploadSpeed(uploaded / elapsed);
          }
        },
        abortControllerRef.current.signal,
      );

      // Step 3: Confirm the upload
      const confirmRes = await fetch("/api/video/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          property_id: uploadData.property_id || propertyId,
          video_capture_id: uploadData.video_capture_id,
          storage_path: uploadData.path,
          duration_seconds: videoDuration,
          width: videoDimensions.width,
          height: videoDimensions.height,
        }),
      });

      const confirmData = await confirmRes.json();

      if (!confirmRes.ok) {
        throw new Error(confirmData.error || "Failed to confirm upload");
      }

      setPropertyId(confirmData.property_id);
      setPhase("complete");

      // Auto-redirect to processing page after 2 seconds
      setTimeout(() => {
        router.push(`/processing-video/${sessionId}`);
      }, 2000);
    } catch (err) {
      console.error("[VideoCapture] Upload failed:", err);
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setPhase("preview");
    }
  }, [videoFile, sessionId, propertyId, videoDuration, videoDimensions, router]);

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
            <Video className="mr-1 h-3 w-3" />
            Video Capture
          </Badge>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-lg">
          {/* Back link */}
          <a
            href="/properties/new"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </a>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Phase: Instructions */}
          {phase === "instructions" && (
            <Card className="border-0 shadow-xl shadow-emerald-900/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-2xl font-bold tracking-tight">
                  Record Walkthrough Video
                </CardTitle>
                <CardDescription className="text-base">
                  Follow these tips for the best 3D reconstruction quality.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {RECORDING_TIPS.map((tip, i) => (
                    <div key={i} className="flex gap-3 p-3 rounded-xl bg-emerald-50/50">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                        <tip.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{tip.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{tip.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Minimum {formatDuration(MIN_DURATION)} · Maximum {formatDuration(MAX_DURATION)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Video className="h-3.5 w-3.5" />
                    <span>MP4 or MOV format · Max 2GB</span>
                  </div>
                </div>

                <Button
                  onClick={handleStartRecording}
                  className="w-full h-13 text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
                >
                  <Video className="mr-2 h-5 w-5" />
                  Select Video
                </Button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </CardContent>
            </Card>
          )}

          {/* Phase: Preview */}
          {phase === "preview" && videoFile && (
            <Card className="border-0 shadow-xl shadow-emerald-900/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-2xl font-bold tracking-tight">
                  Video Preview
                </CardTitle>
                <CardDescription className="text-base">
                  Review your video before uploading.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Video preview */}
                <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                  <video
                    src={videoPreviewUrl || undefined}
                    controls
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* Video metadata */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-emerald-50/50 p-3">
                    <p className="text-xs text-muted-foreground">Duration</p>
                    <p className="text-sm font-semibold">{formatDuration(videoDuration)}</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50/50 p-3">
                    <p className="text-xs text-muted-foreground">File Size</p>
                    <p className="text-sm font-semibold">{formatFileSize(videoFile.size)}</p>
                  </div>
                  {videoDimensions.width > 0 && (
                    <div className="rounded-xl bg-emerald-50/50 p-3">
                      <p className="text-xs text-muted-foreground">Resolution</p>
                      <p className="text-sm font-semibold">{videoDimensions.width}×{videoDimensions.height}</p>
                    </div>
                  )}
                  <div className="rounded-xl bg-emerald-50/50 p-3">
                    <p className="text-xs text-muted-foreground">Format</p>
                    <p className="text-sm font-semibold">{videoFile.name.split(".").pop()?.toUpperCase()}</p>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <Button
                    onClick={handleUpload}
                    className="w-full h-13 text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Upload className="mr-2 h-5 w-5" />
                    Upload Video
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={handleReRecord}
                    className="w-full h-12 text-base text-muted-foreground"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Choose Different Video
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Phase: Uploading */}
          {phase === "uploading" && (
            <Card className="border-0 shadow-xl shadow-emerald-900/5">
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-2xl font-bold tracking-tight">
                  Uploading Video
                </CardTitle>
                <CardDescription className="text-base">
                  Please don&apos;t close this page while uploading.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Progress value={uploadProgress} className="h-3" />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{uploadProgress}%</span>
                    <span className="text-muted-foreground">
                      {formatFileSize(uploadedBytes)} / {videoFile ? formatFileSize(videoFile.size) : "..."}
                    </span>
                  </div>
                  {uploadSpeed > 0 && (
                    <p className="text-xs text-center text-muted-foreground">
                      {formatFileSize(uploadSpeed)}/s
                    </p>
                  )}
                </div>

                <div className="flex justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Phase: Complete */}
          {phase === "complete" && (
            <Card className="border-0 shadow-xl shadow-emerald-900/5">
              <CardContent className="py-12 text-center space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-8 w-8 text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold">Video Uploaded!</h3>
                <p className="text-sm text-muted-foreground">
                  Your video is being processed. This usually takes a few minutes.
                </p>
                <p className="text-xs text-muted-foreground">
                  Redirecting to processing status...
                </p>
              </CardContent>
            </Card>
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
