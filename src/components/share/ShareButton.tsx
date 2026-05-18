"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Share2, Copy, QrCode, Check, MonitorSmartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { QRCodeModal } from "./QRCodeModal";

interface ShareButtonProps {
  propertyId: string;
  propertyTitle: string;
}

export function ShareButton({ propertyId, propertyTitle }: ShareButtonProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const propertyUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/property/${propertyId}`
      : `/property/${propertyId}`;

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(propertyUrl);
      setCopied(true);
      setPopoverOpen(false);

      // Show toast
      toast({
        title: "Link copied!",
        description: "Property link has been copied to your clipboard.",
      });

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
      console.error("[ShareButton] Clipboard API failed, using fallback:", err);
      const textarea = document.createElement("textarea");
      textarea.value = propertyUrl;
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (!success) {
        toast({
          title: "Copy failed",
          description: "Could not copy the link. Please try again.",
          variant: "destructive",
        });
        return;
      }

      setCopied(true);
      setPopoverOpen(false);

      toast({
        title: "Link copied!",
        description: "Property link has been copied to your clipboard.",
      });

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
  }, [propertyUrl, propertyId, toast]);

  const handleQRCode = useCallback(() => {
    setPopoverOpen(false);
    setQrOpen(true);
  }, []);

  const handleNativeShare = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: propertyTitle,
          text: `Check out this 3D walkthrough: ${propertyTitle}`,
          url: propertyUrl,
        });

        setPopoverOpen(false);

        // Call share tracking API (server-side tracking only)
        await fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property_id: propertyId,
            share_method: "link",
          }),
        });
      } catch (err) {
        // User cancelled share or share failed — fallback to copy link
        if (err instanceof Error && err.name !== "AbortError") {
          await handleCopyLink();
        }
      }
    } else {
      // Fallback: copy link
      await handleCopyLink();
    }
  }, [propertyTitle, propertyUrl, propertyId, handleCopyLink]);

  const supportsNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm gap-2"
            size="default"
            aria-label="Share property"
          >
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 p-2 rounded-xl border-emerald-100 shadow-lg"
        >
          <div className="space-y-1">
            {/* Copy Link */}
            <button
              onClick={handleCopyLink}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors cursor-pointer"
              aria-label="Copy property link"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4 text-gray-500" />
              )}
              {copied ? "Copied!" : "Copy Link"}
            </button>

            {/* QR Code */}
            <button
              onClick={handleQRCode}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors cursor-pointer"
              aria-label="Show QR code"
            >
              <QrCode className="h-4 w-4 text-gray-500" />
              QR Code
            </button>

            {/* Native Share / Share via */}
            <button
              onClick={handleNativeShare}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors cursor-pointer"
              aria-label={supportsNativeShare ? "Share via native share" : "Copy link to clipboard"}
            >
              <MonitorSmartphone className="h-4 w-4 text-gray-500" />
              {supportsNativeShare ? "Share via…" : "Copy Link"}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <QRCodeModal
        propertyId={propertyId}
        propertyTitle={propertyTitle}
        open={qrOpen}
        onOpenChange={setQrOpen}
      />
    </>
  );
}
