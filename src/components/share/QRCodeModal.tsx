"use client";

import { useCallback, useRef, useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

interface QRCodeModalProps {
  propertyId: string;
  propertyTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QRCodeModal({
  propertyId,
  propertyTitle,
  open,
  onOpenChange,
}: QRCodeModalProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const propertyUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/property/${propertyId}`
      : `/property/${propertyId}`;

  // Generate a real, scannable QR code via a public API
  const qrImageUrl = useMemo(
    () =>
      `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(propertyUrl)}`,
    [propertyUrl],
  );

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(propertyUrl);
      setCopied(true);

      // Call share tracking API (server-side tracking only)
      await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          share_method: "link",
        }),
      });

      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[QRCodeModal] Clipboard API failed, using fallback:", err);
      const textarea = document.createElement("textarea");
      textarea.value = propertyUrl;
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (!success) {
        return;
      }

      setCopied(true);

      // Call share tracking API (server-side tracking only)
      await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          share_method: "link",
        }),
      });

      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [propertyUrl, propertyId]);

  // Track QR generation when modal opens
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        // Call share tracking API (server-side tracking only)
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
    [propertyId, onOpenChange],
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
          {/* QR Code Image — real, scannable QR code */}
          <div className="relative rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
            {/* Corner accents */}
            <div className="absolute top-2 left-2 h-5 w-5 border-t-2 border-l-2 border-emerald-400 rounded-tl-sm" />
            <div className="absolute top-2 right-2 h-5 w-5 border-t-2 border-r-2 border-emerald-400 rounded-tr-sm" />
            <div className="absolute bottom-2 left-2 h-5 w-5 border-b-2 border-l-2 border-emerald-400 rounded-bl-sm" />
            <div className="absolute bottom-2 right-2 h-5 w-5 border-b-2 border-r-2 border-emerald-400 rounded-br-sm" />

            <img
              src={qrImageUrl}
              alt={`QR code for ${propertyTitle}`}
              width={200}
              height={200}
              className="block"
            />
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
            aria-label="Copy property link"
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
