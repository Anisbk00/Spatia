-- ============================================
-- Video Pipeline Migration
-- Adds video capture support and LingBot-Map reconstruction
-- ============================================

-- Video captures table - stores uploaded video metadata
CREATE TABLE IF NOT EXISTS video_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  content_type text NOT NULL DEFAULT 'video/mp4',
  duration_seconds numeric,
  width integer,
  height integer,
  fps numeric,
  frame_count integer,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'extracting', 'extracted', 'processing', 'completed', 'failed')),
  extraction_fps numeric DEFAULT 2,
  extracted_frame_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reconstruction results table - stores LingBot-Map output metadata
CREATE TABLE IF NOT EXISTS reconstruction_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  video_capture_id uuid REFERENCES video_captures(id) ON DELETE SET NULL,
  camera_poses jsonb DEFAULT '[]',
  frame_count integer DEFAULT 0,
  point_count bigint DEFAULT 0,
  avg_depth_confidence numeric,
  reconstruction_mode text DEFAULT 'streaming',
  processing_time_seconds numeric,
  gpu_type text,
  peak_vram_mb numeric,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add capture_type to capture_sessions
ALTER TABLE capture_sessions ADD COLUMN IF NOT EXISTS capture_type text DEFAULT 'photo'
  CHECK (capture_type IN ('photo', 'video'));

-- Add video_url to capture_sessions
ALTER TABLE capture_sessions ADD COLUMN IF NOT EXISTS video_url text;

-- Add reconstruction_result_id to scenes
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS reconstruction_result_id uuid REFERENCES reconstruction_results(id);

-- RLS policies
ALTER TABLE video_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconstruction_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view video captures" ON video_captures
  FOR SELECT USING (
    org_id IN (
      SELECT o.id FROM organizations o
      JOIN organization_members om ON o.id = om.org_id
      WHERE om.user_id = auth.uid()
    )
  );

CREATE POLICY "Agents can insert video captures" ON video_captures
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT o.id FROM organizations o
      JOIN organization_members om ON o.id = om.org_id
      WHERE om.user_id = auth.uid()
    )
  );

CREATE POLICY "Agents can update video captures" ON video_captures
  FOR UPDATE USING (
    org_id IN (
      SELECT o.id FROM organizations o
      JOIN organization_members om ON o.id = om.org_id
      WHERE om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can view reconstruction results" ON reconstruction_results
  FOR SELECT USING (
    scene_id IN (
      SELECT s.id FROM scenes s
      JOIN properties p ON s.property_id = p.id
      JOIN organizations o ON p.org_id = o.id
      JOIN organization_members om ON o.id = om.org_id
      WHERE om.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_video_captures_session ON video_captures(session_id);
CREATE INDEX IF NOT EXISTS idx_video_captures_property ON video_captures(property_id);
CREATE INDEX IF NOT EXISTS idx_video_captures_status ON video_captures(status);
CREATE INDEX IF NOT EXISTS idx_video_captures_org ON video_captures(org_id);
CREATE INDEX IF NOT EXISTS idx_reconstruction_results_scene ON reconstruction_results(scene_id);
CREATE INDEX IF NOT EXISTS idx_reconstruction_results_video ON reconstruction_results(video_capture_id);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_video_captures_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS video_captures_updated_at ON video_captures;
CREATE TRIGGER video_captures_updated_at
  BEFORE UPDATE ON video_captures
  FOR EACH ROW EXECUTE FUNCTION update_video_captures_updated_at();

-- ============================================
-- Fix processing_jobs table for video pipeline
-- Adds: metadata column, video pipeline job types
-- ============================================

-- Add metadata column for storing pipeline context
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- Drop existing CHECK constraint on job_type and replace with expanded version
-- that includes video pipeline job types
DO $$
BEGIN
  -- Drop the old constraint if it exists
  ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_job_type_check;
  -- Some schemas may name it differently
  ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_job_type;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_job_type_check
  CHECK (job_type IN (
    -- Photo pipeline
    'sfm_reconstruction',
    'gaussian_splat_generation',
    'optimization',
    'thumbnail_generation',
    -- Video pipeline (LingBot-Map)
    'frame_extraction',
    'video_reconstruction',
    'splat_generation'
  ));

-- Add index on metadata for faster JSON queries
CREATE INDEX IF NOT EXISTS idx_processing_jobs_metadata ON processing_jobs USING gin(metadata);

-- Add index on job_type for filtering by pipeline
CREATE INDEX IF NOT EXISTS idx_processing_jobs_job_type ON processing_jobs(job_type);
