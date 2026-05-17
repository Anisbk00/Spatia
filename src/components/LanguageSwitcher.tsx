"use client";

import { useLocaleContext } from "@/components/LocaleProvider";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe, Check } from "lucide-react";
import type { Locale } from "@/i18n/config";

export function LanguageSwitcher({ variant = "ghost", className = "" }: { variant?: "ghost" | "outline" | "default"; className?: string }) {
  const t = useTranslations("common");
  const { locale, setLocale, localeNames, locales } = useLocaleContext();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm" className={`gap-1.5 ${className}`}>
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">{localeNames[locale]}</span>
          <span className="sm:hidden uppercase text-xs font-bold">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {locales.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => setLocale(l)}
            className="flex items-center justify-between gap-2 cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase text-muted-foreground w-5">
                {l}
              </span>
              <span>{localeNames[l]}</span>
            </span>
            {l === locale && <Check className="h-4 w-4 text-emerald-600" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
