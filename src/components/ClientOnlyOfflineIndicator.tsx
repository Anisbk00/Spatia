"use client";

import dynamic from "next/dynamic";

// Client Component wrapper so we can use next/dynamic with ssr: false.
// The OfflineIndicator depends on browser APIs (navigator.onLine, IndexedDB)
// and renders conditionally based on online status — a hydration mismatch hazard.
// Skipping SSR for it ensures the server and client initial renders always match.
const OfflineIndicator = dynamic(
  () => import("@/components/OfflineIndicator").then((mod) => mod.OfflineIndicator),
  { ssr: false }
);

export function ClientOnlyOfflineIndicator() {
  return <OfflineIndicator />;
}
