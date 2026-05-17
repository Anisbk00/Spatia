// Database types — minimal subset needed by the worker
// In production, generate these from Supabase CLI: supabase gen types

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
}

export interface Database {
  public: {
    Tables: {
      processing_jobs: {
        Row: ProcessingJob;
        Insert: Omit<ProcessingJob, "id">;
        Update: Partial<ProcessingJob>;
      };
      scenes: {
        Row: {
          id: string;
          property_id: string;
          session_id: string | null;
          status: string;
          model_url: string | null;
          thumbnail_url: string | null;
          quality_score: number | null;
          processing_time_seconds: number | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      capture_sessions: {
        Row: {
          id: string;
          property_id: string;
          created_by: string | null;
          status: string;
          device_type: string | null;
          total_images: number;
          started_at: string;
          completed_at: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      properties: {
        Row: {
          id: string;
          status: string;
          [key: string]: unknown;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      media: {
        Row: {
          url: string;
          order_index: number;
          metadata: unknown;
          [key: string]: unknown;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
    };
  };
}
