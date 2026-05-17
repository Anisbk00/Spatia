"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff, Loader2, Cpu, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ============================================
// Status dot component
// ============================================

type DotColor = "green" | "yellow" | "red";

function StatusDot({ color }: { color: DotColor }) {
  return (
    <span
      className={cn("inline-block size-2 rounded-full", {
        "bg-emerald-500": color === "green",
        "bg-amber-500": color === "yellow",
        "bg-red-500": color === "red",
      })}
      aria-hidden="true"
    />
  );
}

// ============================================
// RealtimeStatusIndicator
// ============================================

type ConnectionStatus = "connected" | "reconnecting" | "offline";

export function RealtimeStatusIndicator() {
  // Use lazy initializer to read navigator.onLine at mount time (avoids SSR mismatch)
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connected");

  useEffect(() => {
    // Detect reconnecting state: when online is restored after being offline,
    // briefly show "reconnecting" before settling on "connected"
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const handleOnline = () => {
      setIsOnline(true);
      setConnectionStatus("reconnecting");
      reconnectTimer = setTimeout(() => {
        setConnectionStatus("connected");
      }, 2000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setConnectionStatus("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearTimeout(reconnectTimer);
    };
  }, []);

  const dotColor: DotColor = !isOnline
    ? "red"
    : connectionStatus === "reconnecting"
      ? "yellow"
      : "green";

  const label = !isOnline
    ? "Offline"
    : connectionStatus === "reconnecting"
      ? "Reconnecting"
      : "Live";

  const Icon = !isOnline ? WifiOff : connectionStatus === "reconnecting" ? Loader2 : Wifi;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot color={dotColor} />
          <Icon
            className={cn("size-3", connectionStatus === "reconnecting" && "animate-spin")}
          />
          <span className="hidden sm:inline">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>Realtime connection: {label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ============================================
// ProcessingStatusIndicator
// ============================================

interface ProcessingStatusIndicatorProps {
  orgId?: string | null;
}

export function ProcessingStatusIndicator({ orgId }: ProcessingStatusIndicatorProps) {
  const [activeJobs, setActiveJobs] = useState(0);

  useEffect(() => {
    if (!orgId) return;

    const supabase = createClient();
    if (!supabase) return;

    // Fetch initial count of running/queued jobs
    const fetchJobCount = async () => {
      try {
        const { count, error } = await supabase
          .from("processing_jobs")
          .select("*", { count: "exact", head: true })
          .in("status", ["queued", "running"]);

        if (!error && count !== null) {
          setActiveJobs(count);
        }
      } catch {
        // Silently fail — this is a non-critical status indicator
      }
    };

    fetchJobCount();

    // Subscribe to changes on processing_jobs
    const channel = supabase
      .channel("processing-status")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "processing_jobs",
        },
        () => {
          // Re-fetch count on any change
          fetchJobCount();
        }
      )
      .subscribe();

    // Poll every 30s as a fallback
    const interval = setInterval(fetchJobCount, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [orgId]);

  const dotColor: DotColor = activeJobs > 5 ? "yellow" : "green";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot color={dotColor} />
          <Cpu className="size-3" />
          <span className="hidden sm:inline">
            {activeJobs === 0 ? "Idle" : `${activeJobs} job${activeJobs !== 1 ? "s" : ""}`}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>Processing queue: {activeJobs} active job{activeJobs !== 1 ? "s" : ""}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ============================================
// UploadQueueIndicator
// ============================================

function UploadQueueIndicator() {
  const [pendingUploads, setPendingUploads] = useState(0);

  useEffect(() => {
    // Check localStorage for pending upload operations
    const checkUploadQueue = () => {
      try {
        const stored = localStorage.getItem("spatia_upload_queue");
        if (stored) {
          const uploads = JSON.parse(stored) as Array<{ status: string }>;
          const pending = uploads.filter((u) =>
            ["pending", "uploading"].includes(u.status)
          ).length;
          setPendingUploads(pending);
        } else {
          setPendingUploads(0);
        }
      } catch {
        setPendingUploads(0);
      }
    };

    checkUploadQueue();

    // Listen for storage events from other tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "spatia_upload_queue") {
        checkUploadQueue();
      }
    };

    window.addEventListener("storage", handleStorage);

    // Poll every 10s
    const interval = setInterval(checkUploadQueue, 10000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, []);

  if (pendingUploads === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot color="yellow" />
          <Upload className="size-3" />
          <span className="hidden sm:inline">
            {pendingUploads} upload{pendingUploads !== 1 ? "s" : ""}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{pendingUploads} pending upload{pendingUploads !== 1 ? "s" : ""}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ============================================
// SystemStatus (combined bar)
// ============================================

interface SystemStatusProps {
  orgId?: string | null;
}

export function SystemStatus({ orgId }: SystemStatusProps) {
  return (
    <div className="flex items-center gap-3" role="status" aria-label="System status">
      <RealtimeStatusIndicator />
      <ProcessingStatusIndicator orgId={orgId} />
      <UploadQueueIndicator />
    </div>
  );
}
