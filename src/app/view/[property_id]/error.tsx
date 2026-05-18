"use client";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function ViewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center space-y-4 max-w-md">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
        <h1 className="text-2xl font-bold text-gray-900">Failed to load 3D viewer</h1>
        <p className="text-gray-600">{error.message || "An unexpected error occurred while loading the scene."}</p>
        <div className="flex gap-3 justify-center">
          <Button onClick={reset}>Try Again</Button>
          <Link href="/explore"><Button variant="outline">Browse Properties</Button></Link>
        </div>
      </div>
    </div>
  );
}
