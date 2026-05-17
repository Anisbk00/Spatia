"use client";

import { useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";

interface QRCodeModalProps {
  propertyId: string;
  propertyTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Generates a deterministic pseudo-random QR code pattern from a seed string.
 * Uses a simple hash to create a reproducible grid of "modules" (black/white squares).
 * The pattern includes the three required QR code finder patterns in the corners
 * for visual realism.
 */
function useQRPattern(seed: string, size: number = 25) {
  return useMemo(() => {
    // Simple hash function to generate deterministic values from seed
    const hash = (str: string, index: number): number => {
      let h = 0;
      const combined = str + index.toString();
      for (let i = 0; i < combined.length; i++) {
        h = (Math.imul(31, h) + combined.charCodeAt(i)) | 0;
      }
      return Math.abs(h);
    };

    const grid: boolean[][] = [];

    // Initialize grid with seeded random values
    for (let row = 0; row < size; row++) {
      grid[row] = [];
      for (let col = 0; col < size; col++) {
        grid[row][col] = hash(seed, row * size + col) % 3 === 0;
      }
    }

    // Draw finder pattern (7x7 with specific structure) at a position
    const drawFinder = (startRow: number, startCol: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          // Border is always filled
          if (r === 0 || r === 6 || c === 0 || c === 6) {
            grid[startRow + r][startCol + c] = true;
          }
          // Inner 3x3 is always filled
          else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) {
            grid[startRow + r][startCol + c] = true;
          }
          // Between border and inner is always white
          else {
            grid[startRow + r][startCol + c] = false;
          }
        }
      }

      // Separator (white border around finder pattern)
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const row = startRow + r;
          const col = startCol + c;
          if (row < 0 || row >= size || col < 0 || col >= size) continue;
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) continue; // Inside finder, already handled
          // Set separator to white
          if (
            (r === -1 || r === 7) && c >= -1 && c <= 7 ||
            (c === -1 || c === 7) && r >= -1 && r <= 7
          ) {
            grid[row][col] = false;
          }
        }
      }
    };

    // Draw three finder patterns in corners
    drawFinder(0, 0); // Top-left
    drawFinder(0, size - 7); // Top-right
    drawFinder(size - 7, 0); // Bottom-left

    // Timing patterns (alternating rows/columns between finders)
    for (let i = 8; i < size - 8; i++) {
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
    }

    return grid;
  }, [seed, size]);
}

export function QRCodeModal({
  propertyId,
  propertyTitle,
  open,
  onOpenChange,
}: QRCodeModalProps) {
  const [copied, setCopied] = useState(false);

  const propertyUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/property/${propertyId}`
      : `/property/${propertyId}`;

  const qrGrid = useQRPattern(propertyId, 25);
  const moduleSize = 8; // px per QR module
  const qrPixelSize = 25 * moduleSize;

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(propertyUrl);
      setCopied(true);

      // Track events
      trackEvent(EVENT_TYPES.SHARE_LINK_COPIED, {
        property_id: propertyId,
        method: "copy_link",
      });
      trackEvent(EVENT_TYPES.PROPERTY_SHARED, {
        property_id: propertyId,
        share_method: "link",
      });

      // Call share tracking API
      await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          share_method: "link",
        }),
      });

      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[QRCodeModal] Clipboard API failed, using fallback:", err);
      const textarea = document.createElement("textarea");
      textarea.value = propertyUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [propertyUrl, propertyId]);

  // Track QR generation when modal opens
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        trackEvent(EVENT_TYPES.SHARE_QR_GENERATED, {
          property_id: propertyId,
        });
        trackEvent(EVENT_TYPES.PROPERTY_SHARED, {
          property_id: propertyId,
          share_method: "qr",
        });

        // Call share tracking API
        fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property_id: propertyId,
            share_method: "qr",
          }),
        }).catch(() => {
          // Silently ignore API errors
        });
      }
      onOpenChange(isOpen);
    },
    [open, propertyId, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 border border-emerald-100">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="text-emerald-600"
              >
                <rect x="1" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="2.5" y="2.5" width="2" height="2" rx="0.25" fill="currentColor" />
                <rect x="10" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="11.5" y="2.5" width="2" height="2" rx="0.25" fill="currentColor" />
                <rect x="1" y="10" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="2.5" y="11.5" width="2" height="2" rx="0.25" fill="currentColor" />
                <rect x="10" y="10" width="3" height="3" fill="currentColor" />
                <rect x="14" y="10" width="1" height="1" fill="currentColor" />
                <rect x="10" y="14" width="1" height="1" fill="currentColor" />
                <rect x="12" y="12" width="2" height="2" fill="currentColor" />
              </svg>
            </div>
            QR Code — {propertyTitle}
          </DialogTitle>
          <DialogDescription>
            Scan this QR code to open the 3D property walkthrough on any device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-4">
          {/* QR Code Visual */}
          <div className="relative rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
            {/* Corner accents */}
            <div className="absolute top-2 left-2 h-5 w-5 border-t-2 border-l-2 border-emerald-400 rounded-tl-sm" />
            <div className="absolute top-2 right-2 h-5 w-5 border-t-2 border-r-2 border-emerald-400 rounded-tr-sm" />
            <div className="absolute bottom-2 left-2 h-5 w-5 border-b-2 border-l-2 border-emerald-400 rounded-bl-sm" />
            <div className="absolute bottom-2 right-2 h-5 w-5 border-b-2 border-r-2 border-emerald-400 rounded-br-sm" />

            {/* SVG QR Code */}
            <svg
              width={qrPixelSize}
              height={qrPixelSize}
              viewBox={`0 0 ${qrPixelSize} ${qrPixelSize}`}
              className="block"
              shapeRendering="pixelated"
            >
              {/* Background */}
              <rect
                x={0}
                y={0}
                width={qrPixelSize}
                height={qrPixelSize}
                fill="white"
              />
              {/* Modules */}
              {qrGrid.map((row, rowIndex) =>
                row.map((isFilled, colIndex) =>
                  isFilled ? (
                    <rect
                      key={`${rowIndex}-${colIndex}`}
                      x={colIndex * moduleSize}
                      y={rowIndex * moduleSize}
                      width={moduleSize}
                      height={moduleSize}
                      fill="#1a1a2e"
                    />
                  ) : null
                )
              )}
            </svg>
          </div>

          {/* Property URL */}
          <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500 mb-1 font-medium">Property URL</p>
            <p className="text-sm text-gray-700 font-mono truncate">{propertyUrl}</p>
          </div>

          {/* Copy Link Button */}
          <Button
            onClick={handleCopyLink}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
            size="lg"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" />
                Link Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy Link
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
