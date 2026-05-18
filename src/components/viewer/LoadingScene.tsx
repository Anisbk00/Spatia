"use client";

import { useState, useSyncExternalStore } from "react";
import { Rotate3d } from "lucide-react";

interface LoadingSceneProps {
  message?: string;
  progress?: number;
}

function useIsMobile(): boolean {
  // Subscribe to media query changes so the hook re-evaluates on resize/orientation change
  const subscribe = (cb: () => void) => {
    const mql = window.matchMedia("(max-width: 768px)");
    mql.addEventListener("change", cb);
    return () => mql.removeEventListener("change", cb);
  };
  const getSnapshot = () => {
    if (typeof window === "undefined") return false;
    const isTouchDevice =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0;
    const isNarrow = window.matchMedia("(max-width: 768px)").matches;
    return isTouchDevice || isNarrow;
  };
  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function LoadingScene({ message = "Loading 3D scene", progress }: LoadingSceneProps) {
  const isMobile = useIsMobile();

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90">
      {/* Spinning icon */}
      <div className="relative mb-6">
        <div className="h-20 w-20 rounded-full border-2 border-emerald-500/20" />
        <div className="absolute inset-0 h-20 w-20 animate-spin rounded-full border-2 border-transparent border-t-emerald-500" style={{ animationDuration: "1.5s" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Rotate3d className="h-8 w-8 text-emerald-400" />
        </div>
      </div>

      {/* Text */}
      <p className="text-sm font-medium text-white">{message}</p>
      
      {/* Progress bar */}
      {progress !== undefined && (
        <div className="mt-4 h-1 w-48 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}

      {progress !== undefined && (
        <p className="mt-2 text-xs text-white/40">{Math.round(progress)}%</p>
      )}

      {/* Tip — device-specific */}
      <p className="mt-6 max-w-xs text-center text-xs text-white/30">
        {isMobile
          ? "Touch to navigate, pinch to zoom"
          : "Use mouse to rotate, scroll to zoom"}
      </p>
    </div>
  );
}
