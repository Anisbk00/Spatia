"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  RotateCcw,
  Maximize,
  Minimize,
  Gauge,
  Wifi,
  WifiOff,
  Settings2,
} from "lucide-react";
import type { ViewerState, RenderQuality } from "@/lib/types";

interface ViewerControlsProps {
  viewerState: ViewerState;
  propertyTitle: string;
  shareUrl: string;
}

export function ViewerControls({ viewerState, propertyTitle, shareUrl }: ViewerControlsProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  const resetCamera = useCallback(() => {
    window.dispatchEvent(new CustomEvent("viewer-reset-camera"));
  }, []);

  const toggleQuality = useCallback(() => {
    const newQuality: RenderQuality = viewerState.quality === "high" ? "low" : "high";
    window.dispatchEvent(new CustomEvent("viewer-quality-change", { detail: newQuality }));
  }, [viewerState.quality]);

  const shareScene = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShowShareToast(true);
      setCopyError(false);
      setTimeout(() => setShowShareToast(false), 2000);
    } catch (err) {
      console.error("[ViewerControls] Clipboard API failed:", err);
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    }
  }, [shareUrl]);

  return (
    <>
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3">
        {/* Left: property name + loading */}
        <div className="flex items-center gap-2.5 rounded-xl bg-black/40 px-3 py-2 backdrop-blur-md">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm font-medium text-white truncate max-w-[200px] sm:max-w-none">
            {propertyTitle}
          </span>
          {viewerState.isLoading && (
            <span className="text-xs text-white/50">Loading...</span>
          )}
        </div>

        {/* Right: share + stats */}
        <div className="flex items-center gap-2">
          {/* FPS counter (desktop only) */}
          {!viewerState.isLoading && viewerState.fps > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 rounded-xl bg-black/40 px-3 py-2 backdrop-blur-md">
              <Gauge className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs text-white/70">{viewerState.fps} FPS</span>
            </div>
          )}

          {/* Connection status */}
          <div className="flex items-center rounded-xl bg-black/40 px-3 py-2 backdrop-blur-md">
            {viewerState.isReady ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-amber-400" />
            )}
          </div>

          {/* Share */}
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl bg-black/40 text-white hover:bg-black/60 hover:text-white backdrop-blur-md h-9 px-3"
            onClick={shareScene}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-1.5">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" x2="12" y1="2" y2="15" />
            </svg>
            Share
          </Button>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center gap-2 px-3 py-3 sm:py-4">
        <div className="flex items-center gap-2 rounded-2xl bg-black/40 p-1.5 backdrop-blur-md">
          {/* Reset camera */}
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/10 hover:text-white h-9 w-9 p-0"
            onClick={resetCamera}
            title="Reset view"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>

          {/* Quality toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/10 hover:text-white h-9 gap-1.5 px-3"
            onClick={toggleQuality}
            title={`Switch to ${viewerState.quality === "high" ? "low" : "high"} quality`}
          >
            <Settings2 className="h-4 w-4" />
            <span className="text-xs">{viewerState.quality === "high" ? "HD" : "SD"}</span>
          </Button>

          {/* Fullscreen */}
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/10 hover:text-white h-9 w-9 p-0"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Splat count badge */}
      {viewerState.isReady && viewerState.splatCount > 0 && (
        <div className="absolute bottom-14 left-3 z-10 sm:bottom-16">
          <div className="rounded-lg bg-black/30 px-2 py-1 backdrop-blur-sm">
            <span className="text-[10px] text-white/50">
              {(viewerState.splatCount / 1000).toFixed(0)}K points
            </span>
          </div>
        </div>
      )}

      {/* Share toast */}
      {showShareToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="rounded-full bg-emerald-600 px-4 py-2 text-sm text-white shadow-lg">
            Link copied to clipboard
          </div>
        </div>
      )}

      {/* Copy error toast */}
      {copyError && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="rounded-full bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
            Unable to copy — clipboard access denied
          </div>
        </div>
      )}
    </>
  );
}
