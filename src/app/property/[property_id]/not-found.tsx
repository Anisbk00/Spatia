import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";
import { SpatiaLogo } from "@/components/SpatiaLogo";

export default function PropertyNotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50/30 via-white to-emerald-50/20">
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <SpatiaLogo size="sm" />
            <span className="text-sm font-semibold tracking-tight">Spatia</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
            <Home className="h-10 w-10 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold">Property Not Found</h1>
          <p className="mt-2 text-muted-foreground">
            This property doesn&apos;t exist or has been removed. The link may be incorrect or the listing may have been archived.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button variant="outline" asChild className="gap-2">
              <a href="/explore">
                <ArrowLeft className="h-4 w-4" />
                Browse Properties
              </a>
            </Button>
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        Spatia &middot; Immersive Spatial Platform
      </footer>
    </div>
  );
}
