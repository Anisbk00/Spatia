export const locales = ["en", "fr", "ar"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  ar: "العربية",
};

export const localeDirection: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  fr: "ltr",
  ar: "rtl",
};

/**
 * Detect the user's preferred locale from browser settings.
 * Falls back to defaultLocale if no match is found.
 */
export function detectLocaleFromBrowser(): Locale {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return defaultLocale;
  }

  // Check localStorage first (user's explicit choice)
  try {
    const stored = localStorage.getItem("spatia-locale");
    if (stored && locales.includes(stored as Locale)) {
      return stored as Locale;
    }
  } catch {
    // localStorage may not be available
  }

  // Check browser language preferences
  const browserLangs = navigator.languages || [navigator.language];

  for (const lang of browserLangs) {
    const code = lang.toLowerCase().split("-")[0];
    if (locales.includes(code as Locale)) {
      return code as Locale;
    }
  }

  return defaultLocale;
}

/**
 * Detect locale from Accept-Language header (server-side).
 */
export function detectLocaleFromHeaders(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return defaultLocale;

  const languages = acceptLanguage
    .split(",")
    .map((lang) => {
      const [code, priority] = lang.trim().split(";q=");
      return {
        code: code.toLowerCase().split("-")[0],
        priority: priority ? parseFloat(priority) : 1,
      };
    })
    .sort((a, b) => b.priority - a.priority);

  for (const { code } of languages) {
    if (locales.includes(code as Locale)) {
      return code as Locale;
    }
  }

  return defaultLocale;
}

/**
 * Persist the user's locale choice.
 */
export function setLocaleCookie(locale: Locale): void {
  try {
    localStorage.setItem("spatia-locale", locale);
  } catch {
    // Ignore
  }
  // Also set a cookie for server-side reads
  document.cookie = `SPATIA_LOCALE=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}
