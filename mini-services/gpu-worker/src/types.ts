// ============================================
// Database types — mirrors Supabase schema
// for the enhanced GPU worker service.
// ============================================

// ---- Worker types ----

export type WorkerStatus = "idle" | "busy" | "draining" | "offline" | "failed";

export interface Worker {
  id: string;
  worker_id: string;
  name: string | null;
  region: string;
  status: WorkerStatus;
  capabilities: Record<string, unknown> | null;
  current_job_count: number;
  max_concurrent_jobs: number;
  gpu_type: string | null;
  gpu_memory_gb: number | null;
  last_heartbeat: string;
  started_at: string;
  total_jobs_completed: number;
  total_jobs_failed: number;
  avg_job_duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkerRegistration {
  worker_id: string;
  name?: string;
  region?: string;
  gpu_type?: string;
  gpu_memory_gb?: number;
  max_concurrent_jobs?: number;
  capabilities?: Record<string, unknown>;
}

// ---- Processing Job types ----

export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobType =
  | "sfm_reconstruction"
  | "gaussian_splat_generation"
  | "optimization"
  | "thumbnail_generation";

export interface ProcessingJob {
  id: string;
  scene_id: string;
  job_type: JobType;
  status: JobStatus;
  logs: string | null;
  started_at: string | null;
  finished_at: string | null;
  retry_count: number;
  worker_id?: string | null;
}

// ---- Scene types ----

export type SceneStatus = "queued" | "processing" | "ready" | "failed";

export interface Scene {
  id: string;
  property_id: string;
  session_id: string | null;
  status: SceneStatus;
  model_url: string | null;
  thumbnail_url: string | null;
  quality_score: number | null;
  processing_time_seconds: number | null;
  created_at: string;
  completed_at: string | null;
}

// ---- Capture Session types ----

export type SessionStatus =
  | "started"
  | "uploading"
  | "processing"
  | "completed"
  | "failed";

export interface CaptureSession {
  id: string;
  property_id: string;
  created_by: string | null;
  status: SessionStatus;
  device_type: string | null;
  total_images: number;
  started_at: string;
  completed_at: string | null;
}

// ---- Property types ----

export type PropertyStatus =
  | "draft"
  | "capturing"
  | "processing"
  | "ready"
  | "archived";

export interface Property {
  id: string;
  org_id: string | null;
  created_by: string | null;
  title: string;
  description: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  property_type: string | null;
  price: number | null;
  currency: string;
  status: PropertyStatus;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Media types ----

export type MediaType = "image" | "video";

export interface Media {
  id: string;
  session_id: string | null;
  property_id: string;
  url: string;
  type: MediaType;
  order_index: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ---- Cost Record types ----

export type CostType =
  | "gpu_compute"
  | "storage"
  | "cdn_bandwidth"
  | "ai_enhancement"
  | "thumbnail_generation"
  | "data_transfer";

export interface CostRecord {
  id: string;
  org_id: string;
  scene_id: string | null;
  job_id: string | null;
  worker_id: string | null;
  cost_type: CostType;
  amount_usd: number;
  quantity: number | null;
  unit: string | null;
  unit_cost_usd: number | null;
  metadata: Record<string, unknown> | null;
  recorded_at: string;
  billing_period_start: string | null;
  billing_period_end: string | null;
}

// ---- AI Enhancement types ----

export type EnhancementType =
  | "scene_cleanup"
  | "room_detection"
  | "object_removal"
  | "lighting_enhancement"
  | "auto_thumbnail"
  | "full_enhancement";

export type EnhancementStatus = "queued" | "processing" | "completed" | "failed";

export interface AIEnhancement {
  id: string;
  scene_id: string;
  org_id: string;
  enhancement_type: EnhancementType;
  status: EnhancementStatus;
  input_artifacts: Record<string, unknown> | null;
  output_artifacts: Record<string, unknown> | null;
  detected_rooms: DetectedRoom[] | null;
  quality_before: number | null;
  quality_after: number | null;
  improvement_percent: number | null;
  processing_time_seconds: number | null;
  worker_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface DetectedRoom {
  type: string;
  confidence: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  center: [number, number, number];
}

// ---- Database type map for Supabase client ----

export interface Database {
  public: {
    Tables: {
      workers: {
        Row: Worker;
        Insert: Omit<Worker, "id" | "created_at" | "updated_at">;
        Update: Partial<Worker>;
      };
      processing_jobs: {
        Row: ProcessingJob;
        Insert: Omit<ProcessingJob, "id">;
        Update: Partial<ProcessingJob>;
      };
      scenes: {
        Row: Scene;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      capture_sessions: {
        Row: CaptureSession;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      properties: {
        Row: Property;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      media: {
        Row: Media;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      cost_records: {
        Row: CostRecord;
        Insert: Omit<CostRecord, "id" | "recorded_at">;
        Update: Partial<CostRecord>;
      };
      ai_enhancements: {
        Row: AIEnhancement;
        Insert: Omit<AIEnhancement, "id" | "created_at" | "completed_at">;
        Update: Partial<AIEnhancement>;
      };
    };
  };
}
