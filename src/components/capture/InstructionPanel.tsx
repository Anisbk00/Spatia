"use client";

import type { CaptureStep } from "@/lib/captureFlow";
import {
  DoorOpen,
  Footprints,
  Scan,
  ArrowRight,
  Eye,
  CheckCircle2,
} from "lucide-react";

const ICON_MAP: Record<CaptureStep["icon"], React.ElementType> = {
  door: DoorOpen,
  walk: Footprints,
  scan: Scan,
  arrow: ArrowRight,
  eye: Eye,
  check: CheckCircle2,
};

const ICON_BG_MAP: Record<CaptureStep["icon"], string> = {
  door: "bg-emerald-100 text-emerald-600",
  walk: "bg-sky-100 text-sky-600",
  scan: "bg-violet-100 text-violet-600",
  arrow: "bg-amber-100 text-amber-600",
  eye: "bg-rose-100 text-rose-600",
  check: "bg-emerald-100 text-emerald-600",
};

interface InstructionPanelProps {
  step: CaptureStep;
  stepIndex: number;
  totalSteps: number;
}

export function InstructionPanel({
  step,
  stepIndex,
  totalSteps,
}: InstructionPanelProps) {
  const IconComponent = ICON_MAP[step.icon];

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      {/* Step indicator */}
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
          Step {stepIndex + 1} / {totalSteps}
        </span>
      </div>

      {/* Main instruction */}
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${ICON_BG_MAP[step.icon]}`}
        >
          <IconComponent className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-tight">
            {step.instruction}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {step.detail}
          </p>
        </div>
      </div>
    </div>
  );
}
