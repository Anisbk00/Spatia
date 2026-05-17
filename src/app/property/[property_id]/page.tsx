import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPropertyWithScene, trackPropertyView } from "@/lib/supabase/property";
import { PropertyHero } from "@/components/property/PropertyHero";
import { PropertyGallery } from "@/components/property/PropertyGallery";
import { PropertyShareSection } from "@/components/share/PropertyShareSection";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { Rotate3d, ArrowLeft } from "lucide-react";
import { SpatiaLogo } from "@/components/SpatiaLogo";
import { Button } from "@/components/ui/button";

interface PropertyPageProps {
  params: Promise<{ property_id: string }>;
}

export async function generateMetadata({ params }: PropertyPageProps): Promise<Metadata> {
  const { property_id } = await params;
  const data = await getPropertyWithScene(property_id);

  if (!data) {
    return {
      title: "Property Not Found",
      description: "This property could not be found.",
    };
  }

  const title = `${data.title} — Spatia`;
  const description = data.description || `Explore ${data.title} in immersive 3D`;
  const ogImage = data.cover_image_url || data.scene?.thumbnail_url || undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `/property/${property_id}`,
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630, alt: data.title }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function PropertyPage({ params }: PropertyPageProps) {
  const { property_id } = await params;
  const data = await getPropertyWithScene(property_id);

  if (!data) {
    notFound();
  }

  // Track the view (fire-and-forget, don't block rendering)
  trackPropertyView(property_id).catch(() => {});

  const { scene, media, ...property } = data;
  const hasScene = scene?.status === "ready" && !!scene.model_url;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50/30 via-white to-emerald-50/20">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild className="shrink-0">
              <a href="/explore" aria-label="Back to explore">
                <ArrowLeft className="h-4 w-4" />
              </a>
            </Button>
            <div className="flex items-center gap-2">
              <SpatiaLogo size="sm" />
              <span className="text-sm font-semibold tracking-tight">Spatia</span>
            </div>
          </div>
          {hasScene && (
            <Button
              asChild
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 rounded-full"
            >
              <a href={`/view/${property_id}`}>
                <Rotate3d className="h-4 w-4" />
                View in 3D
              </a>
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-5xl space-y-8">
          {/* Gallery */}
          <PropertyGallery
            media={media}
            coverImageUrl={property.cover_image_url}
            propertyTitle={property.title}
          />

          {/* Hero info */}
          <PropertyHero property={property} scene={scene} />

          {/* Description */}
          {property.description && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">About this property</h2>
              <p className="whitespace-pre-line text-muted-foreground leading-relaxed">
                {property.description}
              </p>
            </section>
          )}

          {/* 3D CTA banner */}
          {hasScene && (
            <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 p-6 text-white shadow-lg sm:p-8">
              <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
                  <Rotate3d className="h-8 w-8" />
                </div>
                <div className="flex-1 space-y-2">
                  <h3 className="text-xl font-bold">Explore this property in 3D</h3>
                  <p className="text-sm text-emerald-100">
                    Walk through every room from your browser. Rotate, zoom, and explore the space as if you were there.
                  </p>
                </div>
                <Button
                  asChild
                  size="lg"
                  className="rounded-full bg-white text-emerald-700 hover:bg-emerald-50 shrink-0 shadow-lg px-8"
                >
                  <a href={`/view/${property_id}`}>
                    Start 3D Tour
                  </a>
                </Button>
              </div>
            </section>
          )}

          {/* Scene not ready notice */}
          {!hasScene && property.status === "processing" && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
                <Rotate3d className="h-6 w-6 text-amber-600 animate-spin" style={{ animationDuration: "3s" }} />
              </div>
              <h3 className="font-semibold text-amber-900">3D Scene is Processing</h3>
              <p className="mt-1 text-sm text-amber-700">
                The 3D walkthrough is being generated. Please check back soon.
              </p>
            </section>
          )}

          {/* Scene failed notice */}
          {!hasScene && scene?.status === "failed" && (
            <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <Rotate3d className="h-6 w-6 text-red-500" />
              </div>
              <h3 className="font-semibold text-red-900">3D Scene Failed</h3>
              <p className="mt-1 text-sm text-red-700">
                The 3D scene could not be generated. The property owner has been notified.
              </p>
            </section>
          )}

          {/* Share section */}
          <PropertyShareSection propertyId={property_id} propertyTitle={property.title} />
        </div>
      </main>

      {/* Floating feedback button */}
      <FeedbackButton propertyId={property_id} />

      {/* Footer */}
      <footer className="mt-auto border-t px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        Spatia &middot; Property Listing
      </footer>
    </div>
  );
}
