"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Wifi, WifiOff, Cloud } from "lucide-react";
import { SyncEngine } from "@/lib/offline-sync";
import { initOfflineDB } from "@/lib/offline-sync/db";
import { cn } from "@/lib/utils";

type BannerState = "hidden" | "offline" | "syncing" | "synced";

export function OfflineIndicator() {
  // This component is loaded via next/dynamic with ssr: false,
  // so it only renders on the client. The navigator check is safe here.
  const [bannerState, setBannerState] = useState<BannerState>(() => {
    if (typeof navigator === "undefined") return "hidden";
    return navigator.onLine ? "hidden" : "offline";
  });
  const [syncProgress, setSyncProgress] = useState({
    pending: 0,
    synced: 0,
    failed: 0,
  });
  const syncEngineRef = useRef<SyncEngine | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize SyncEngine
  useEffect(() => {
    // Initialize the IndexedDB
    initOfflineDB().catch(console.error);

    const engine = new SyncEngine();

    engine.onOnlineStatusChange = (online) => {
      if (!online) {
        setBannerState("offline");
        // Clear any pending hide timer
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      }
    };

    engine.onSyncProgress = (pending, synced, failed) => {
      setSyncProgress({ pending, synced, failed });

      if (pending > 0) {
        setBannerState("syncing");
        // Clear any pending hide timer while syncing
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      } else if (pending === 0 && synced > 0) {
        setBannerState("synced");
        // Auto-hide after 3 seconds
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          setBannerState("hidden");
          hideTimerRef.current = null;
        }, 3000);
      }
    };

    syncEngineRef.current = engine;

    // Start monitoring
    engine.startSync();

    return () => {
      engine.stopSync();
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setBannerState("hidden");
  }, []);

  // Don't render anything if hidden
  if (bannerState === "hidden") return null;

  return (
    <div
      className={cn(
        "fixed top-0 left-0 right-0 z-[100] flex items-center justify-center px-4 py-2 text-sm font-medium transition-all duration-300",
        bannerState === "offline" && "bg-amber-600 text-white",
        bannerState === "syncing" && "bg-sky-600 text-white",
        bannerState === "synced" && "bg-emerald-600 text-white"
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        {/* Icon */}
        {bannerState === "offline" && (
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        {bannerState === "syncing" && (
          <Cloud className="h-4 w-4 shrink-0 animate-pulse" aria-hidden="true" />
        )}
        {bannerState === "synced" && (
          <Cloud className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}

        {/* Message */}
        {bannerState === "offline" && (
          <span>
            You&apos;re offline — captures will sync when you reconnect
          </span>
        )}
        {bannerState === "syncing" && (
          <span>
            Syncing {syncProgress.synced + syncProgress.pending > 0
              ? `${syncProgress.synced}/${syncProgress.synced + syncProgress.pending}`
              : ""}{" "}
            captures…
          </span>
        )}
        {bannerState === "synced" && (
          <span>All captures synced!</span>
        )}

        {/* Failed count */}
        {bannerState !== "offline" && syncProgress.failed > 0 && (
          <span className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-xs">
            {syncProgress.failed} failed
          </span>
        )}

        {/* Dismiss button for synced state */}
        {bannerState === "synced" && (
          <button
            onClick={handleDismiss}
            className="ml-2 rounded p-0.5 hover:bg-white/20 transition-colors"
            aria-label="Dismiss"
          >
            <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
