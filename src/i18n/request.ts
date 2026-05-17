import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { locales, defaultLocale, type Locale } from "./config";

export default getRequestConfig(async () => {
  // 1. Check cookie (user's explicit choice)
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("SPATIA_LOCALE")?.value;
  if (cookieLocale && locales.includes(cookieLocale as Locale)) {
    return {
      locale: cookieLocale,
      messages: (await import(`../../messages/${cookieLocale}.json`)).default,
    };
  }

  // 2. Check Accept-Language header (system language)
  const headersList = await headers();
  const acceptLanguage = headersList.get("accept-language");
  if (acceptLanguage) {
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
        return {
          locale: code,
          messages: (await import(`../../messages/${code}.json`)).default,
        };
      }
    }
  }

  // 3. Fallback to default locale
  return {
    locale: defaultLocale,
    messages: (await import(`../../messages/${defaultLocale}.json`)).default,
  };
});
