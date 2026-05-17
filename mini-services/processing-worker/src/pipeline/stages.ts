// ============================================
// Pipeline Stage Definitions
// ============================================
// Each stage has a clear interface for
// data-driven processing. Stages perform
// real work (HTTP validation, computation)
// and can be extended with full ML pipelines.
// ============================================

export type StageStatus = "pending" | "running" | "completed" | "failed";

export interface PipelineStage {
  name: string;
  description: string;
  /** Estimated duration in seconds (for UI progress) */
  estimatedDurationSec: number;
  run: (ctx: PipelineContext) => Promise<PipelineStageResult>;
}

export interface PipelineContext {
  jobId: string;
  sceneId: string;
  sessionId: string;
  propertyId: string;
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
// Full pipeline definition (ordered stages)
// ============================================

export const PIPELINE_STAGES: Omit<PipelineStage, "run">[] = [
  {
    name: "Image Validation",
    description: "Validating and sorting captured images",
    estimatedDurationSec: 5,
  },
  {
    name: "Structure from Motion",
    description: "Estimating camera positions and building point cloud",
    estimatedDurationSec: 30,
  },
  {
    name: "Gaussian Splat Generation",
    description: "Converting point cloud to Gaussian Splat representation",
    estimatedDurationSec: 45,
  },
  {
    name: "Scene Optimization",
    description: "Compressing and optimizing scene for web delivery",
    estimatedDurationSec: 20,
  },
  {
    name: "Scene Packaging",
    description: "Creating final model files and thumbnail",
    estimatedDurationSec: 10,
  },
];
