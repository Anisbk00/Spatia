export default function PropertyLoading() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50/30 via-white to-emerald-50/20">
      {/* Header skeleton */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-gray-200 animate-pulse" />
            <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
      </header>

      {/* Content skeleton */}
      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-5xl space-y-8">
          {/* Gallery skeleton */}
          <div className="h-64 sm:h-80 rounded-2xl bg-gray-200 animate-pulse" />

          {/* Info skeleton */}
          <div className="space-y-3">
            <div className="h-8 w-3/4 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-1/3 bg-gray-200 rounded animate-pulse" />
          </div>

          {/* Description skeleton */}
          <div className="space-y-2">
            <div className="h-5 w-48 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
      </main>

      {/* Footer skeleton */}
      <footer className="mt-auto border-t px-4 py-5 text-center">
        <div className="h-3 w-32 bg-gray-200 rounded animate-pulse mx-auto" />
      </footer>
    </div>
  );
}
