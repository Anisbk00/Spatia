"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Home, Rotate3d, LogOut, MapPin, Plus, Video } from "lucide-react";
import { SpatiaLogo } from "@/components/SpatiaLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { signOutAction } from "@/lib/actions/auth";
import type { User } from "@supabase/supabase-js";
import type { Property } from "@/lib/types";

interface ExploreContentProps {
  user: User | null;
  profile: { role: string; email: string; full_name: string | null } | null;
  properties: Property[];
  propertiesWithScene: Record<string, boolean>;
}

export function ExploreContent({
  user,
  profile,
  properties,
  propertiesWithScene,
}: ExploreContentProps) {
  const t = useTranslations("explore");
  const tn = useTranslations("nav");
  const tp = useTranslations("property");

  const formatPrice = (price: number | null, currency: string) => {
    if (!price) return null;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(price);
  };

  const propertyTypeLabels: Record<string, string> = {
    apartment: tp("apartment"),
    house: tp("house"),
    villa: tp("villa"),
    office: tp("office"),
    land: tp("land"),
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      {/* Top Nav */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <SpatiaLogo size="md" />
            <span className="font-semibold tracking-tight">
              Spatia
            </span>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            {user ? (
              <>
                {(profile?.role === "agent" || profile?.role === "admin") && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href="/dashboard">{tn("dashboard")}</a>
                  </Button>
                )}
                <Button variant="ghost" size="sm" asChild>
                  <a href="/properties/new">
                    <Plus className="mr-1 h-4 w-4" />
                    {tn("newProperty")}
                  </a>
                </Button>
                <Button variant="ghost" size="sm" asChild className="text-emerald-700">
                  <a href="/properties/new?mode=video">
                    <Video className="mr-1 h-4 w-4" />
                    {t("videoCapture")}
                  </a>
                </Button>
                <form action={signOutAction}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                  >
                    <LogOut className="mr-1 h-4 w-4" />
                    {tn("signout")}
                  </Button>
                </form>
              </>
            ) : (
              <Button variant="outline" size="sm" asChild>
                <a href="/auth/login">{t("signIn")}</a>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-8">
          {/* Hero */}
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {t("title")}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>

          {/* Properties list */}
          <div>
            <h2 className="mb-4 text-lg font-semibold">
              {t("availableProperties")}
              {properties.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({properties.length})
                </span>
              )}
            </h2>

            {properties.length === 0 ? (
              <Card className="border-0 shadow-md">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                    <Home className="h-8 w-8 text-emerald-400" />
                  </div>
                  <h3 className="text-lg font-semibold">{t("noProperties")}</h3>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    {t("noPropertiesDesc")}
                  </p>
                  {user && (
                    <Button asChild className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                      <a href="/properties/new">
                        <Plus className="h-4 w-4" />
                        {t("createFirst")}
                      </a>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {properties.map((property: Property) => {
                  const has3D = propertiesWithScene[property.id] === true;
                  return (
                    <a key={property.id} href={`/property/${property.id}`} className="block">
                      <Card className="group cursor-pointer border-0 shadow-md transition-shadow hover:shadow-lg h-full">
                        <CardContent className="p-0">
                          <div className="relative h-40 overflow-hidden rounded-t-xl">
                            {property.cover_image_url ? (
                              <img
                                src={property.cover_image_url}
                                alt={property.title}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center bg-gradient-to-br from-emerald-100 to-emerald-50">
                                <Home className="h-8 w-8 text-emerald-300" />
                              </div>
                            )}
                            {has3D && (
                              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-emerald-600/90 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                                <Rotate3d className="h-3 w-3" />
                                {t("3dAvailable")}
                              </div>
                            )}
                          </div>
                          <div className="p-4">
                            <p className="font-semibold truncate">{property.title}</p>
                            <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                              {formatPrice(property.price, property.currency) && (
                                <span className="font-medium text-emerald-600">
                                  {formatPrice(property.price, property.currency)}
                                </span>
                              )}
                              {property.property_type && (
                                <span>
                                  {property.price && "· "}
                                  {propertyTypeLabels[property.property_type] || property.property_type}
                                </span>
                              )}
                            </div>
                            {(property.city || property.address) && (
                              <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {[property.address, property.city].filter(Boolean).join(", ")}
                                </span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        {t("footer")}
      </footer>
    </div>
  );
}
