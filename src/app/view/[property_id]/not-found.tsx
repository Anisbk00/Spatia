import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";
import { SpatiaLogo } from "@/components/SpatiaLogo";

export default function ViewNotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-black">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-7xl items-center px-4">
          <div className="flex items-center gap-2">
            <SpatiaLogo size="sm" className="opacity-90" />
            <span className="text-sm font-semibold text-white">Spatia</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/5">
            <Home className="h-10 w-10 text-white/30" />
          </div>
          <h1 className="text-2xl font-bold text-white">Property Not Found</h1>
          <p className="mt-2 text-white/60">
            This 3D walkthrough doesn&apos;t exist or has been removed. The link may be incorrect or the listing may have been archived.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button variant="outline" asChild className="border-white/20 text-white hover:bg-white/10 gap-2">
              <a href="/explore">
                <ArrowLeft className="h-4 w-4" />
                Browse Properties
              </a>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
