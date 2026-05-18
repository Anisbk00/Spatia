"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, RotateCcw } from "lucide-react";

interface CameraViewProps {
  onCapture: (file: File, previewUrl: string) => void;
  disabled?: boolean;
  lastPreview?: string | null;
}

/**
 * CameraView — PWA-optimized camera component.
 * Uses native file input with capture="environment" for maximum
 * compatibility across mobile browsers and PWAs.
 * This approach:
 * - Opens the device camera directly on mobile
 * - Handles focus/exposure automatically
 * - Works without getUserMedia permissions
 * - Provides native camera controls (flash, HDR, timer)
 */
export function CameraView({ onCapture, disabled, lastPreview }: CameraViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [capturing, setCapturing] = useState(false);
  const lastPreviewUrlRef = useRef<string | null>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setCapturing(true);
      // Revoke previous preview URL to avoid memory leak
      if (lastPreviewUrlRef.current) {
        URL.revokeObjectURL(lastPreviewUrlRef.current);
      }
      const previewUrl = URL.createObjectURL(file);
      lastPreviewUrlRef.current = previewUrl;
      onCapture(file, previewUrl);

      // Reset input so the same file can be recaptured
      e.target.value = "";
      // Brief delay for UX feedback
      setTimeout(() => setCapturing(false), 300);
    },
    [onCapture]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (lastPreviewUrlRef.current) {
        URL.revokeObjectURL(lastPreviewUrlRef.current);
      }
    };
  }, []);

  const triggerCapture = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <div className="space-y-4">
      {/* Hidden file input — triggers native camera on mobile */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled}
      />

      {/* Last captured preview */}
      {lastPreview && (
        <div className="relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-2xl border-2 border-emerald-200 bg-black">
          <img
            src={lastPreview}
            alt="Last captured photo"
            className="h-full w-full object-cover"
          />
          <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
            Last capture
          </div>
        </div>
      )}

      {/* Placeholder when no preview */}
      {!lastPreview && (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-muted/30">
          <div className="text-center">
            <Camera className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Tap below to capture your first photo
            </p>
          </div>
        </div>
      )}

      {/* Capture button — large touch target */}
      <Button
        type="button"
        onClick={triggerCapture}
        disabled={disabled || capturing}
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 p-0 shadow-lg shadow-emerald-600/30 hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
        style={{ width: "4rem", height: "4rem" }}
      >
        {capturing ? (
          <RotateCcw className="h-6 w-6 animate-spin text-white" />
        ) : (
          <Camera className="h-7 w-7 text-white" />
        )}
      </Button>
    </div>
  );
}
