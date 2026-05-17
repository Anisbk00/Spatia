import type { Metadata } from "next";
import { SpatiaLogo } from "@/components/SpatiaLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export const metadata: Metadata = {
  title: "Spatia — Onboarding",
  description: "Set up your Spatia account and create your first immersive 3D property tour",
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      <header className="w-full px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <div className="flex items-center gap-2">
            <SpatiaLogo size="lg" />
            <span className="text-lg font-semibold tracking-tight">Spatia</span>
          </div>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-4 sm:py-8">
        {children}
      </main>
      <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        Spatia · Immersive Spatial Platform
      </footer>
    </div>
  );
}
