"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

export default function ProcessingVideoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDev = process.env.NODE_ENV === "development";
  const displayMessage = isDev
    ? error.message
    : "An unexpected error occurred. Please try again.";

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-b from-emerald-50 to-white">
      <Card className="w-full max-w-md border-0 shadow-xl">
        <CardContent className="flex flex-col items-center py-8 text-center">
          <AlertTriangle className="mb-3 h-10 w-10 text-amber-500" />
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {displayMessage || "An unexpected error occurred during video processing."}
          </p>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" onClick={() => reset()}>
              Try Again
            </Button>
            <Button asChild>
              <a href="/dashboard">Back to Dashboard</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
