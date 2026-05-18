"use client";

import { Rotate3d, CheckCircle2, XCircle } from "lucide-react";

interface ProcessingIndicatorProps {
  status?: string;
}

export default function ProcessingIndicator({ status }: ProcessingIndicatorProps) {
  const isComplete = status === "completed";
  const isFailed = status === "failed";

  return (
    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
      {isComplete ? (
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
      ) : isFailed ? (
        <XCircle className="h-10 w-10 text-red-500" />
      ) : (
        <Rotate3d className="h-10 w-10 animate-spin text-emerald-600" style={{ animationDuration: "3s" }} />
      )}
    </div>
  );
}
