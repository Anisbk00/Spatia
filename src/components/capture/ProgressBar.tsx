"use client";

interface ProgressBarProps {
  photosTaken: number;
  estimatedTotal: number;
  currentStepIndex: number;
  totalSteps: number;
  uploading?: number;
}

export function ProgressBar({
  photosTaken,
  estimatedTotal,
  currentStepIndex,
  totalSteps,
  uploading = 0,
}: ProgressBarProps) {
  const stepProgress = Math.round(
    ((currentStepIndex + 1) / totalSteps) * 100
  );
  const photoProgress = estimatedTotal > 0
    ? Math.min(Math.round((photosTaken / estimatedTotal) * 100), 100)
    : 0;

  return (
    <div className="space-y-3">
      {/* Stats row */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <span className="font-medium">
            Photos: {photosTaken}
            <span className="text-muted-foreground"> / ~{estimatedTotal}</span>
          </span>
          {uploading > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              {uploading} uploading
            </span>
          )}
        </div>
        <span className="text-muted-foreground">
          Room {Math.min(currentStepIndex + 1, totalSteps)} / {totalSteps}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out" style={{ width: `${photoProgress}%` }} />
      </div>

      {/* Step progress */}
      <div className="flex gap-1">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i <= currentStepIndex
                ? "bg-emerald-500"
                : i === currentStepIndex + 1
                  ? "bg-emerald-200"
                  : "bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
