import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPropertyWithScene } from "@/lib/supabase/property";
import { ViewPageClient } from "./ViewPageClient";

interface ViewPageProps {
  params: Promise<{ property_id: string }>;
}

export async function generateMetadata({ params }: ViewPageProps): Promise<Metadata> {
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
  const ogImage = data.scene?.thumbnail_url || data.cover_image_url || undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `/view/${property_id}`,
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

export default async function ViewPage({ params }: ViewPageProps) {
  const { property_id } = await params;
  const data = await getPropertyWithScene(property_id);

  if (!data) {
    notFound();
  }

  const { scene, ...property } = data;
  const modelUrl = scene?.model_url || null;
  const sharePath = `/view/${property_id}`;

  return (
    <ViewPageClient
      propertyId={property_id}
      propertyTitle={property.title}
      propertyAddress={property.address}
      propertyPrice={property.price}
      propertyCurrency={property.currency}
      modelUrl={modelUrl}
      sceneStatus={scene?.status || null}
      sharePath={sharePath}
    />
  );
}
