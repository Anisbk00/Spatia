"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { locales, type Locale, localeNames, localeDirection, detectLocaleFromBrowser, setLocaleCookie } from "@/i18n/config";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  direction: "ltr" | "rtl";
  localeNames: Record<Locale, string>;
  locales: readonly Locale[];
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useLocaleContext() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocaleContext must be used within LocaleProvider");
  return ctx;
}

// Pre-load all message bundles
const messageBundles: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("../../messages/en.json"),
  fr: () => import("../../messages/fr.json"),
  ar: () => import("../../messages/ar.json"),
};

/**
 * Detect the best locale to use on initial client render.
 * Priority: cookie > browser settings > server-provided locale
 */
function getInitialLocale(serverLocale: Locale): Locale {
  if (typeof document === "undefined") return serverLocale;

  // Check cookie first (user's explicit previous choice)
  const hasCookie = document.cookie.includes("SPATIA_LOCALE=");
  if (hasCookie) {
    const match = document.cookie.match(/SPATIA_LOCALE=(\w+)/);
    if (match && locales.includes(match[1] as Locale)) {
      return match[1] as Locale;
    }
  }

  // Check browser language (system language detection)
  const detected = detectLocaleFromBrowser();
  if (detected !== serverLocale && locales.includes(detected)) {
    setLocaleCookie(detected);
    return detected;
  }

  return serverLocale;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const serverLocale = useLocale() as Locale;

  // Initialize locale with system language detection (no effect needed)
  const [locale, setLocaleState] = useState<Locale>(() => getInitialLocale(serverLocale));
  const [messages, setMessages] = useState<Record<string, unknown> | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load messages whenever locale changes
  useEffect(() => {
    let cancelled = false;
    async function loadMessages() {
      try {
        const bundle = await messageBundles[locale]();
        if (!cancelled) {
          setMessages(bundle.default as Record<string, unknown>);
          setLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load messages for locale:", locale, err);
        // Fallback to English
        const bundle = await messageBundles.en();
        if (!cancelled) {
          setMessages(bundle.default as Record<string, unknown>);
          setLoaded(true);
        }
      }
    }
    loadMessages();
    return () => { cancelled = true; };
  }, [locale]);

  // Sync HTML dir and lang attributes
  useEffect(() => {
    const dir = localeDirection[locale];
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    setLocaleCookie(newLocale);
    // Messages will be loaded by the effect above when locale changes
  }, []);

  if (!loaded || !messages) {
    return null;
  }

  return (
    <LocaleContext.Provider
      value={{
        locale,
        setLocale,
        direction: localeDirection[locale],
        localeNames,
        locales,
      }}
    >
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
