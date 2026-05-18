export default function ViewLoading() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-white/60 text-sm">Loading 3D viewer...</p>
      </div>
    </div>
  );
}
