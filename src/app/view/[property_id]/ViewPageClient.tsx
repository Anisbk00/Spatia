"use client";

import { useState, useCallback, useEffect } from "react";
import { ArrowLeft, Home, Rotate3d, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { ViewerCanvas } from "@/components/viewer/ViewerCanvas";
import { ViewerControls } from "@/components/viewer/ViewerControls";
import { LoadingScene } from "@/components/viewer/LoadingScene";
import type { ViewerState, SceneStatus } from "@/lib/types";

interface ViewPageClientProps {
  propertyId: string;
  propertyTitle: string;
  propertyAddress: string | null;
  propertyPrice: number | null;
  propertyCurrency: string;
  modelUrl: string | null;
  sceneStatus: SceneStatus | null;
  sharePath: string;
}

export function ViewPageClient({
  propertyId,
  propertyTitle,
  propertyAddress,
  propertyPrice,
  propertyCurrency,
  modelUrl: initialModelUrl,
  sceneStatus: initialSceneStatus,
  sharePath,
}: ViewPageClientProps) {
  const [modelUrl, setModelUrl] = useState(initialModelUrl);
  const [sceneStatus, setSceneStatus] = useState(initialSceneStatus);
  const [viewerState, setViewerState] = useState<ViewerState>({
    isLoading: true,
    isReady: false,
    error: null,
    splatCount: 0,
    fps: 0,
    loadProgress: 0,
    quality: "high",
  });

  const handleStateChange = useCallback((state: ViewerState) => {
    setViewerState(state);
  }, []);

  // Poll scene status when processing or queued
  useEffect(() => {
    if (sceneStatus !== "processing" && sceneStatus !== "queued") return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/properties/${propertyId}/scene-status`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.scene?.status && data.scene.status !== sceneStatus) {
          setSceneStatus(data.scene.status as SceneStatus);
          if (data.scene.status === "ready" && data.scene.model_url) {
            setModelUrl(data.scene.model_url);
          }
        }
      } catch (err) {
        console.error("[ViewPageClient] Scene status poll failed:", err);
      }
    }, 10000); // Poll every 10s

    return () => clearInterval(pollInterval);
  }, [sceneStatus, propertyId]);

  const formatPrice = (price: number | null, currency: string) => {
    if (!price) return null;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(price);
  };

  // Scene not ready — show processing / failed / no-scene state
  if (!modelUrl || sceneStatus !== "ready") {
    return (
      <div className="min-h-screen flex flex-col bg-black">
        <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-md">
          <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <a href={`/property/${propertyId}`} className="text-white/60 hover:text-white transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </a>
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600">
                  <Home className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-sm font-semibold text-white">{propertyTitle}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md border-0 bg-white/5 backdrop-blur-sm">
            <CardContent className="flex flex-col items-center py-12 text-center">
              {sceneStatus === "processing" || sceneStatus === "queued" ? (
                <>
                  <Rotate3d className="mb-4 h-12 w-12 text-emerald-400 animate-spin" style={{ animationDuration: "3s" }} />
                  <h2 className="text-xl font-bold text-white">3D Scene is Processing</h2>
                  <p className="mt-2 max-w-sm text-sm text-white/60">
                    The Gaussian Splat reconstruction is in progress. This typically takes 10–30 minutes depending on the number of images.
                  </p>
                  <p className="mt-3 text-xs text-white/30">
                    This page will automatically load the 3D viewer when ready.
                  </p>
                  <Button variant="outline" className="mt-6 border-white/20 text-white hover:bg-white/10" asChild>
                    <a href={`/property/${propertyId}`}>View Property Details</a>
                  </Button>
                </>
              ) : sceneStatus === "failed" ? (
                <>
                  <AlertTriangle className="mb-4 h-12 w-12 text-red-400" />
                  <h2 className="text-xl font-bold text-white">Processing Failed</h2>
                  <p className="mt-2 max-w-sm text-sm text-white/60">
                    The 3D scene could not be generated. The property owner has been notified.
                  </p>
                  <Button variant="outline" className="mt-6 border-white/20 text-white hover:bg-white/10" asChild>
                    <a href={`/property/${propertyId}`}>View Property Details</a>
                  </Button>
                </>
              ) : (
                <>
                  <Rotate3d className="mb-4 h-12 w-12 text-white/30" />
                  <h2 className="text-xl font-bold text-white">No 3D Scene Available</h2>
                  <p className="mt-2 max-w-sm text-sm text-white/60">
                    This property does not have a 3D walkthrough yet.
                  </p>
                  <Button variant="outline" className="mt-6 border-white/20 text-white hover:bg-white/10" asChild>
                    <a href={`/property/${propertyId}`}>View Property Details</a>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
      {/* 3D Canvas */}
      <ViewerCanvas modelUrl={modelUrl} onStateChange={handleStateChange} />

      {/* Controls overlay */}
      <ViewerControls
        viewerState={viewerState}
        propertyTitle={propertyTitle}
        shareUrl={typeof window !== "undefined" ? `${window.location.origin}${sharePath}` : sharePath}
      />

      {/* Loading overlay */}
      {viewerState.isLoading && !viewerState.error && (
        <LoadingScene message="Loading 3D scene" progress={viewerState.loadProgress} />
      )}

      {/* Non-fatal error (scene loaded but with warnings) */}
      {viewerState.error && viewerState.isReady && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30">
          <div className="rounded-full bg-amber-600/80 px-4 py-2 text-xs text-white backdrop-blur-sm">
            {viewerState.error}
          </div>
        </div>
      )}

      {/* Fatal error */}
      {viewerState.error && !viewerState.isReady && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/90">
          <Card className="w-full max-w-md border-0 bg-white/5 backdrop-blur-sm mx-4">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <AlertTriangle className="mb-4 h-12 w-12 text-red-400" />
              <h2 className="text-xl font-bold text-white">Rendering Error</h2>
              <p className="mt-2 max-w-sm text-sm text-white/60">{viewerState.error}</p>
              <Button
                variant="outline"
                className="mt-6 border-white/20 text-white hover:bg-white/10"
                onClick={() => window.location.reload()}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Property info bar (bottom-right) */}
      <div className="absolute bottom-14 right-3 z-10 sm:bottom-16 sm:right-4">
        <div className="rounded-xl bg-black/40 px-3 py-2 backdrop-blur-md">
          {propertyPrice && (
            <p className="text-sm font-bold text-emerald-400">
              {formatPrice(propertyPrice, propertyCurrency)}
            </p>
          )}
          {propertyAddress && (
            <p className="text-[11px] text-white/50 truncate max-w-[180px]">{propertyAddress}</p>
          )}
        </div>
      </div>

      {/* Back button (bottom-left) */}
      <div className="absolute bottom-14 left-3 z-10 sm:bottom-16 sm:left-4">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="rounded-xl bg-black/40 text-white hover:bg-black/60 hover:text-white backdrop-blur-md h-9 gap-1.5 px-3"
        >
          <a href={`/property/${propertyId}`}>
            <ArrowLeft className="h-4 w-4" />
            <span className="text-xs">Details</span>
          </a>
        </Button>
      </div>
    </div>
  );
}
