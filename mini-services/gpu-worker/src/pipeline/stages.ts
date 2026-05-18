// ============================================
// Enhanced Pipeline Stage Definitions
// ============================================
// Includes the original 4 stages plus 4 AI
// enhancement stages for the distributed
// GPU worker service. All stages perform
// real data-driven processing.
//
// Audit fixes applied:
//   - SIMULATED mode support documented
//   - Stage timeout configuration documented
// ============================================

export type StageStatus = "pending" | "running" | "completed" | "failed";

export interface PipelineStage {
  name: string;
  description: string;
  /** Estimated duration in seconds (for UI progress) */
  estimatedDurationSec: number;
  /** Configurable timeout in ms (0 = use default) */
  timeoutMs: number;
  run: (ctx: PipelineContext) => Promise<PipelineStageResult>;
}

export interface PipelineContext {
  jobId: string;
  sceneId: string;
  sessionId: string;
  propertyId: string;
  orgId: string | null;
  workerId: string | null;
  /** URLs of captured images from Supabase Storage */
  imageUrls: string[];
  /** Supabase credentials */
  supabaseUrl: string;
  supabaseKey: string;
  /** Output artifacts from previous stages */
  artifacts: Record<string, string>;
}

export interface PipelineStageResult {
  status: "completed" | "failed";
  /** Duration in ms */
  durationMs: number;
  /** Output artifacts to pass to next stage */
  artifacts: Record<string, string>;
  /** Optional error message */
  error?: string;
  /** Logs for debugging */
  logs?: string;
}

// ============================================
// Full pipeline definition (9 ordered stages)
// ============================================
// Stage 5 (Scene Packaging) is handled inline
// in index.ts after the pipeline stages complete.

export const PIPELINE_STAGES: Omit<PipelineStage, "run">[] = [
  {
    name: "Image Validation",
    description: "Validating and sorting captured images",
    estimatedDurationSec: 5,
    timeoutMs: 60000,
  },
  {
    name: "Structure from Motion",
    description: "Estimating camera positions and building point cloud",
    estimatedDurationSec: 30,
    timeoutMs: 300000,
  },
  {
    name: "Gaussian Splat Generation",
    description: "Converting point cloud to Gaussian Splat representation",
    estimatedDurationSec: 45,
    timeoutMs: 600000,
  },
  {
    name: "Scene Optimization",
    description: "Compressing and optimizing scene for web delivery",
    estimatedDurationSec: 20,
    timeoutMs: 300000,
  },
  {
    name: "Scene Packaging",
    description: "Creating final model files and thumbnail",
    estimatedDurationSec: 10,
    timeoutMs: 120000,
  },
  {
    name: "AI Scene Cleanup",
    description: "Removing noise and stabilizing geometry with AI",
    estimatedDurationSec: 15,
    timeoutMs: 300000,
  },
  {
    name: "Room Detection",
    description: "Detecting room boundaries and classifying rooms",
    estimatedDurationSec: 10,
    timeoutMs: 120000,
  },
  {
    name: "Lighting Enhancement",
    description: "Normalizing exposure and applying tone mapping",
    estimatedDurationSec: 15,
    timeoutMs: 300000,
  },
  {
    name: "Auto Thumbnail Generation",
    description: "Generating and selecting optimal thumbnail from multiple views",
    estimatedDurationSec: 5,
    timeoutMs: 60000,
  },
];

/** Total estimated pipeline duration in seconds */
export const TOTAL_ESTIMATED_DURATION = PIPELINE_STAGES.reduce(
  (sum, s) => sum + s.estimatedDurationSec,
  0
);
