"use client";

import { ShareButton } from "./ShareButton";
import { Share2, QrCode, Link as LinkIcon } from "lucide-react";

interface PropertyShareSectionProps {
  propertyId: string;
  propertyTitle: string;
}

export function PropertyShareSection({
  propertyId,
  propertyTitle,
}: PropertyShareSectionProps) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-white p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 border border-emerald-200">
          <Share2 className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Share this property
          </h3>
          <p className="text-sm text-gray-500">
            Copy link or scan QR to share with clients
          </p>
        </div>
      </div>

      {/* Share options quick info */}
      <div className="flex items-center gap-4 mb-5">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <LinkIcon className="h-3.5 w-3.5 text-emerald-500" />
          <span>Shareable link</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <QrCode className="h-3.5 w-3.5 text-emerald-500" />
          <span>QR code</span>
        </div>
      </div>

      {/* Share Button */}
      <ShareButton propertyId={propertyId} propertyTitle={propertyTitle} />
    </div>
  );
}
