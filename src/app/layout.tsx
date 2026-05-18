import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ClientOnlyOfflineIndicator } from "@/components/ClientOnlyOfflineIndicator";
import { LocaleProvider } from "@/components/LocaleProvider";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spatia — AI-Powered 3D Property Walkthroughs",
  description:
    "Turn a simple phone walkthrough into an immersive 3D property experience. No special hardware required. AI-generated 3D walkthroughs for real estate professionals.",
  icons: {
    icon: "/logo.svg",
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://spatia-eta.vercel.app"),
  openGraph: {
    title: "Spatia — AI-Powered 3D Property Walkthroughs",
    description:
      "Turn a simple phone walkthrough into an immersive 3D property experience. No special hardware. No LiDAR. Just your phone and AI.",
    url: "/",
    siteName: "Spatia",
    type: "website",
    locale: "en_US",
    alternateLocale: ["fr_FR", "ar_SA"],
    images: [
      {
        url: "/logo.svg",
        width: 1200,
        height: 630,
        alt: "Spatia — AI-Powered 3D Property Walkthroughs",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Spatia — AI-Powered 3D Property Walkthroughs",
    description:
      "Turn a simple phone walkthrough into an immersive 3D property experience. No special hardware required.",
    images: ["/logo.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
  keywords: [
    "3D property walkthrough",
    "real estate 3D",
    "AI 3D reconstruction",
    "virtual tour",
    "phone to 3D",
    "Gaussian splatting",
    "property viewer",
    "immersive walkthrough",
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spatia-eta.vercel.app";

  // JSON-LD structured data for SEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Spatia",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "AI-powered 3D property walkthrough generation from phone recordings. Built for real estate professionals.",
    url: siteUrl,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free tier available",
    },
  };

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <LocaleProvider>
            <ClientOnlyOfflineIndicator />
            {children}
            <Toaster />
          </LocaleProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
