"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Media } from "@/lib/types";

interface PropertyGalleryProps {
  media: Media[];
  coverImageUrl: string | null;
  propertyTitle: string;
}

export function PropertyGallery({ media, coverImageUrl, propertyTitle }: PropertyGalleryProps) {
  // Build the image list: cover first, then media
  const images: { url: string; alt: string }[] = [];

  if (coverImageUrl) {
    images.push({ url: coverImageUrl, alt: `${propertyTitle} - Cover` });
  }

  for (const m of media) {
    // Skip if it's the same as the cover image
    if (coverImageUrl && m.url === coverImageUrl) continue;
    images.push({ url: m.url, alt: `${propertyTitle} - Photo ${(m.order_index || 0) + 1}` });
  }

  const [currentIndex, setCurrentIndex] = useState(0);
  const hasMultiple = images.length > 1;

  const goTo = (index: number) => {
    setCurrentIndex((index + images.length) % images.length);
  };

  // No images at all — show placeholder
  if (images.length === 0) {
    return (
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-50 sm:aspect-[21/9]">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-200/60">
            <Home className="h-8 w-8 text-emerald-400" />
          </div>
          <p className="text-sm text-emerald-600/70">No photos available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-black/5 sm:aspect-[21/9]">
      {/* Main image */}
      <img
        src={images[currentIndex].url}
        alt={images[currentIndex].alt}
        className="h-full w-full object-cover transition-opacity duration-300"
      />

      {/* Navigation arrows */}
      {hasMultiple && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 hover:text-white"
            onClick={() => goTo(currentIndex - 1)}
            aria-label="Previous image"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 hover:text-white"
            onClick={() => goTo(currentIndex + 1)}
            aria-label="Next image"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </>
      )}

      {/* Dot indicators */}
      {hasMultiple && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                i === currentIndex ? "w-6 bg-white" : "w-1.5 bg-white/50 hover:bg-white/70"
              )}
              onClick={() => goTo(i)}
              aria-label={`Go to image ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Thumbnail strip below */}
      {hasMultiple && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={i}
              className={cn(
                "h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 transition-all",
                i === currentIndex
                  ? "border-emerald-600 ring-1 ring-emerald-600/30"
                  : "border-transparent opacity-60 hover:opacity-100"
              )}
              onClick={() => goTo(i)}
            >
              <img src={img.url} alt={img.alt} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
