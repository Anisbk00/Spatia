"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Rotate3d, Building2 } from "lucide-react";
import type { Property, Scene } from "@/lib/types";

interface PropertyHeroProps {
  property: Property;
  scene: Scene | null;
}

export function PropertyHero({ property, scene }: PropertyHeroProps) {
  const formatPrice = (price: number | null, currency: string) => {
    if (!price) return null;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(price);
  };

  const propertyTypeLabels: Record<string, string> = {
    apartment: "Apartment",
    house: "House",
    villa: "Villa",
    office: "Office",
    land: "Land",
  };

  return (
    <div className="space-y-4">
      {/* Property type badge + 3D badge */}
      <div className="flex flex-wrap items-center gap-2">
        {property.property_type && (
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
            <Building2 className="h-3 w-3" />
            {propertyTypeLabels[property.property_type] || property.property_type}
          </Badge>
        )}
        {scene?.status === "ready" && (
          <Badge className="gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium hover:bg-emerald-700">
            <Rotate3d className="h-3 w-3" />
            3D Tour Available
          </Badge>
        )}
      </div>

      {/* Title */}
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
        {property.title}
      </h1>

      {/* Location */}
      {(property.address || property.city || property.country) && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <MapPin className="h-4 w-4 shrink-0" />
          <span className="text-sm">
            {[property.address, property.city, property.country].filter(Boolean).join(", ")}
          </span>
        </div>
      )}

      {/* Price + CTA row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {property.price && (
          <p className="text-3xl font-bold text-emerald-600">
            {formatPrice(property.price, property.currency)}
          </p>
        )}

        {scene?.status === "ready" && (
          <Button
            asChild
            size="lg"
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 rounded-full px-8 shadow-lg shadow-emerald-600/20"
          >
            <a href={`/view/${property.id}`}>
              <Rotate3d className="h-5 w-5" />
              Explore in 3D
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
