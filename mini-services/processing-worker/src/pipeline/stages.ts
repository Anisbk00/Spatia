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
  /** Maximum time the stage is allowed to run before timing out */
  timeoutMs: number;
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
// Seeded PRNG (mulberry32) for deterministic output
// ============================================

export function createSeededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  let state = Math.abs(hash) || 1;

  return function (): number {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================
// Full pipeline definition (ordered stages)
// ============================================
// Source of truth for stage metadata including timeouts.
// Run functions are wired up in the main worker entry point.

export const PIPELINE_STAGES: Omit<PipelineStage, "run">[] = [
  {
    name: "Image Validation",
    description: "Validating and sorting captured images",
    estimatedDurationSec: 5,
    timeoutMs: 60_000,
  },
  {
    name: "SfM Reconstruction",
    description: "Estimating camera positions and building point cloud",
    estimatedDurationSec: 30,
    timeoutMs: 300_000,
  },
  {
    name: "Gaussian Splat Generation",
    description: "Converting point cloud to Gaussian Splat representation",
    estimatedDurationSec: 45,
    timeoutMs: 450_000,
  },
  {
    name: "Scene Optimization",
    description: "Compressing and optimizing scene for web delivery",
    estimatedDurationSec: 20,
    timeoutMs: 120_000,
  },
  {
    name: "Scene Packaging",
    description: "Creating final model files and thumbnail",
    estimatedDurationSec: 10,
    timeoutMs: 60_000,
  },
];
