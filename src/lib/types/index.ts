// ============================================
// Database row types matching Supabase schema
// ============================================

export type UserRole = "agent" | "admin" | "client";
export type OrgRole = "owner" | "agent" | "viewer";
export type PropertyType = "apartment" | "house" | "villa" | "office" | "land";
export type PropertyStatus =
  | "draft"
  | "capturing"
  | "processing"
  | "ready"
  | "archived";
export type SessionStatus =
  | "started"
  | "uploading"
  | "processing"
  | "completed"
  | "failed";

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  owner_id: string;
  plan: string;
  referral_code: string | null;
  referred_by: string | null;
  created_at: string;
}

export interface OrganizationMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface Property {
  id: string;
  org_id: string | null;
  created_by: string | null;
  title: string;
  description: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  property_type: PropertyType | null;
  price: number | null;
  currency: string;
  status: PropertyStatus;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaptureSession {
  id: string;
  property_id: string;
  created_by: string | null;
  status: SessionStatus;
  capture_type: CaptureType;
  video_url: string | null;
  device_type: string | null;
  total_images: number;
  started_at: string;
  completed_at: string | null;
}

export type SceneStatus = "queued" | "processing" | "ready" | "failed";
export type MediaType = "image" | "video";

export interface Scene {
  id: string;
  property_id: string;
  session_id: string | null;
  status: SceneStatus;
  model_url: string | null;
  thumbnail_url: string | null;
  quality_score: number | null;
  processing_time_seconds: number | null;
  reconstruction_result_id: string | null;
  created_at: string;
  completed_at: string | null;
}

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

export interface PropertyWithScene extends Property {
  scene: Scene | null;
  media: Media[];
}

// ============================================
// Form / API input types
// ============================================

export interface CreatePropertyInput {
  title: string;
  address?: string;
  property_type?: PropertyType;
  price?: number;
  description?: string;
}

export interface CreatePropertyResponse {
  property: Property;
  session: CaptureSession;
}

// ============================================
// Helper: form errors
// ============================================

export type FieldErrors = Partial<Record<keyof CreatePropertyInput, string>>;

// ============================================
// Renderer types
// ============================================

export interface SplatData {
  positions: Float32Array;
  scales: Float32Array;
  rotations: Float32Array;
  colors: Float32Array;
  opacities: Float32Array;
  count: number;
}

export interface CameraState {
  theta: number;
  phi: number;
  distance: number;
  target: [number, number, number];
  fov: number;
}

export type RenderQuality = "low" | "high";

export interface ViewerState {
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
  splatCount: number;
  fps: number;
  loadProgress: number;
  quality: RenderQuality;
}

// ============================================
// Processing Job
// ============================================

export type JobType =
  | "frame_extraction"
  | "sfm_reconstruction"
  | "gaussian_splat_generation"
  | "optimization"
  | "thumbnail_generation";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface ProcessingJob {
  id: string;
  scene_id: string;
  job_type: JobType;
  status: JobStatus;
  logs: string | null;
  started_at: string | null;
  finished_at: string | null;
  retry_count: number;
  created_at: string;
}

// ============================================
// State Machine Transition Maps
// ============================================
// Documented valid transitions for job and scene status.
// These are reference maps — not enforced at compile time,
// but should be validated in business logic before transitions.

/**
 * Valid job status transitions.
 *
 * queued  → running   (worker claims the job)
 * queued  → failed    (manual cancellation or system error)
 * running → completed (job succeeded)
 * running → queued    (stuck job recovery / retry)
 * running → failed    (job failed after retries exhausted)
 * failed  → queued    (manual retry)
 * failed  → completed (manual override, rare)
 *
 * Terminal states: completed, failed
 */
export const VALID_JOB_TRANSITIONS = {
  queued: ["running", "failed"],
  running: ["completed", "queued", "failed"],
  completed: [], // terminal
  failed: ["queued", "completed"], // retry or manual override
} as const satisfies Record<JobStatus, readonly JobStatus[]>;

/**
 * Valid scene status transitions.
 *
 * queued     → processing (job picked up by worker)
 * queued     → failed     (pre-processing validation failure)
 * processing → ready      (scene generation completed)
 * processing → failed     (scene generation failed)
 * processing → queued     (stuck scene recovery / retry)
 * failed     → queued     (retry after fix)
 * failed     → ready      (manual override, rare)
 * ready      → processing  (re-processing with new parameters)
 *
 * Terminal states: ready, failed
 */
export const VALID_SCENE_TRANSITIONS = {
  queued: ["processing", "failed"],
  processing: ["ready", "failed", "queued"],
  ready: ["processing"], // can re-process
  failed: ["queued", "ready"], // can retry or manual override
} as const satisfies Record<SceneStatus, readonly SceneStatus[]>;

// ============================================
// Billing & Subscription types
// ============================================

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing";

export interface Plan {
  id: string;
  name: string;
  price_monthly: number | null;
  price_yearly: number | null;
  max_properties: number | null;
  max_storage_mb: number | null;
  max_3d_generations: number | null;
  features: Record<string, unknown> | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  org_id: string;
  plan_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  provider: string;
  provider_subscription_id: string | null;
  created_at: string;
}

export type MetricType =
  | "properties_created"
  | "images_uploaded"
  | "3d_scenes_generated"
  | "storage_used_mb"
  | "view_sessions";

export interface UsageMetric {
  id: string;
  org_id: string;
  metric_type: MetricType;
  value: number;
  reference_id: string | null;
  created_at: string;
}

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";

export interface Payment {
  id: string;
  org_id: string | null;
  subscription_id: string | null;
  amount: number | null;
  currency: string;
  status: PaymentStatus;
  provider: string;
  provider_payment_id: string | null;
  created_at: string;
}

export type InvoiceStatus = "draft" | "paid" | "void" | "uncollectible";

export interface Invoice {
  id: string;
  org_id: string;
  amount: number | null;
  currency: string;
  status: InvoiceStatus;
  period_start: string | null;
  period_end: string | null;
  pdf_url: string | null;
  created_at: string;
}

// ============================================
// Property Views (analytics row)
// ============================================

export interface PropertyViewsRow {
  id: string;
  property_id: string;
  viewer_session_id: string | null;
  device_type: string | null;
  country: string | null;
  viewed_at: string;
}

// ============================================
// Event Tracking types
// ============================================

export type EventType =
  // Core product events
  | "PROPERTY_CREATED"
  | "CAPTURE_STARTED"
  | "IMAGE_UPLOADED"
  | "CAPTURE_COMPLETED"
  | "PROCESSING_STARTED"
  | "SCENE_GENERATED"
  | "SCENE_FAILED"
  | "VIEWER_OPENED"
  | "PROPERTY_SHARED"
  | "PROPERTY_VIEWED"
  // Upload resilience events
  | "UPLOAD_FAILED"
  | "UPLOAD_RETRIED"
  | "OFFLINE_CAPTURE"
  | "SYNC_COMPLETED"
  | "SYNC_FAILED"
  // Onboarding & activation events
  | "ONBOARDING_STARTED"
  | "ONBOARDING_STEP_COMPLETED"
  | "ONBOARDING_COMPLETED"
  | "FIRST_PROPERTY_CREATED"
  | "FIRST_CAPTURE_STARTED"
  | "FIRST_SCENE_GENERATED"
  | "FIRST_VIEW_SHARED"
  // Growth & referral events
  | "REFERRAL_LINK_GENERATED"
  | "REFERRAL_SIGNUP"
  | "FEEDBACK_SUBMITTED"
  | "NPS_SCORE_SUBMITTED"
  | "SHARE_LINK_COPIED"
  | "SHARE_QR_GENERATED";

export interface Event {
  id: string;
  user_id: string | null;
  org_id: string | null;
  event_type: string;
  metadata: Record<string, unknown> | null;
  session_id: string | null;
  property_id: string | null;
  scene_id: string | null;
  device_type: string | null;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface TrackEventInput {
  event_type: string;
  metadata?: Record<string, unknown>;
  session_id?: string;
  property_id?: string;
  scene_id?: string;
  device_type?: string;
  user_agent?: string;
}

// ============================================
// Upload Operations types
// ============================================

export type UploadOperationStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "failed"
  | "cancelled";

export interface UploadOperation {
  id: string;
  org_id: string | null;
  user_id: string | null;
  session_id: string;
  property_id: string;
  file_name: string;
  file_size: number;
  content_type: string;
  storage_path: string | null;
  status: UploadOperationStatus;
  bytes_uploaded: number;
  chunk_count: number;
  chunks_uploaded: number;
  retry_count: number;
  last_error: string | null;
  media_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// System Logs types
// ============================================

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogSource = "upload" | "processing" | "capture" | "api" | "worker";

export interface SystemLog {
  id: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  metadata: Record<string, unknown> | null;
  org_id: string | null;
  user_id: string | null;
  session_id: string | null;
  property_id: string | null;
  job_id: string | null;
  created_at: string;
}

// ============================================
// Feedback types
// ============================================

export type FeedbackType = "bug" | "feature" | "nps" | "capture" | "general";
export type FeedbackSentiment = "positive" | "neutral" | "negative";

export interface FeedbackEvent {
  id: string;
  user_id: string | null;
  org_id: string | null;
  property_id: string | null;
  type: FeedbackType;
  sentiment: FeedbackSentiment | null;
  rating: number | null;
  comment: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ============================================
// Referral types
// ============================================

export interface Referral {
  id: string;
  referral_code: string;
  referrer_org_id: string;
  referred_org_id: string | null;
  referred_user_id: string | null;
  status: "pending" | "signed_up" | "activated" | "rewarded";
  reward_credits: number;
  created_at: string;
  activated_at: string | null;
}

// ============================================
// Onboarding State types
// ============================================

export interface OnboardingState {
  id: string;
  user_id: string;
  org_id: string | null;
  current_step: number;
  completed_steps: number[];
  is_completed: boolean;
  skipped: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================
// Funnel Analytics types
// ============================================

export interface FunnelStep {
  step: string;
  label: string;
  count: number;
  rate: number; // conversion rate from previous step
}

export interface FunnelData {
  steps: FunnelStep[];
  totalUsers: number;
  activatedUsers: number;
  avgTimeToActivation: number | null; // in hours
}

export interface RetentionData {
  cohort: string;
  signupCount: number;
  d1: number;
  d7: number;
  d30: number;
}

// ============================================
// Worker / Distributed Processing types
// ============================================

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

// ============================================
// Cost Records types
// ============================================

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

export interface CostSummary {
  total_cost: number;
  by_type: Record<string, number>;
  scenes_processed: number;
  cost_per_scene: number;
  period_start: string;
  period_end: string;
}

export interface ProcessingCostConfig {
  id: string;
  cost_type: string;
  unit_cost_usd: number;
  unit: string;
  currency: string;
  free_multiplier: number;
  pro_multiplier: number;
  business_multiplier: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================
// AI Enhancement types
// ============================================

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
  type: string;  // kitchen, bedroom, bathroom, living_room, etc.
  confidence: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  center: [number, number, number];
}

export interface EnhancementRequest {
  scene_id: string;
  org_id: string;
  enhancement_type: EnhancementType | "full_enhancement";
}

// ============================================
// Audit Log types
// ============================================

export interface AuditLog {
  id: string;
  org_id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// ============================================
// Enterprise Settings types
// ============================================

export interface EnterpriseSettings {
  id: string;
  org_id: string;
  sla_processing_time_minutes: number;
  sla_uptime_percent: number;
  priority_level: number;
  bulk_upload_enabled: boolean;
  team_permissions_enabled: boolean;
  audit_logs_enabled: boolean;
  custom_branding_enabled: boolean;
  api_access_enabled: boolean;
  max_concurrent_captures: number;
  max_bulk_properties: number;
  settings: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// GPU Metrics types
// ============================================

export interface GPUMetric {
  id: string;
  worker_id: string;
  gpu_utilization_percent: number | null;
  gpu_memory_used_gb: number | null;
  gpu_memory_total_gb: number | null;
  gpu_temperature_c: number | null;
  job_queue_length: number;
  active_job_count: number;
  avg_processing_time_seconds: number | null;
  jobs_completed_last_hour: number;
  jobs_failed_last_hour: number;
  recorded_at: string;
}

// ============================================
// Batch Operations types
// ============================================

export type BatchOperationType =
  | "bulk_property_upload"
  | "bulk_scene_processing"
  | "bulk_enhancement"
  | "bulk_export";

export type BatchOperationStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface BatchOperation {
  id: string;
  org_id: string;
  user_id: string;
  operation_type: BatchOperationType;
  status: BatchOperationStatus;
  total_items: number;
  completed_items: number;
  failed_items: number;
  items: BatchOperationItem[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface BatchOperationItem {
  property_id: string;
  status: string;
  error?: string;
}

// ============================================
// Scene Thumbnail types
// ============================================

export type ThumbnailType = "auto" | "manual" | "ai_selected" | "hero";

export interface SceneThumbnail {
  id: string;
  scene_id: string;
  thumbnail_url: string;
  thumbnail_type: ThumbnailType;
  view_angle: Record<string, unknown> | null;
  quality_score: number | null;
  is_primary: boolean;
  created_at: string;
}

// ============================================
// System Monitoring types
// ============================================

export interface SystemMonitoring {
  active_workers: number;
  total_workers: number;
  idle_workers: number;
  busy_workers: number;
  offline_workers: number;
  queued_jobs: number;
  running_jobs: number;
  failed_jobs_24h: number;
  completed_jobs_24h: number;
  avg_processing_time_24h: number | null;
  queued_ai_enhancements: number;
  processing_ai_enhancements: number;
  total_scenes_ready: number;
  total_storage_mb: number;
  cost_today: number;
  cost_this_month: number;
  workers_by_region: Record<string, number> | null;
}

// ============================================
// Auto-Scaling types
// ============================================

export interface ScalingConfig {
  scale_up_threshold: number;     // queue size to trigger scale-up
  scale_down_threshold: number;   // idle workers to trigger scale-down
  min_workers: number;
  max_workers: number;
  cooldown_seconds: number;
  free_tier_delay_threshold: number; // queue size to delay free tier
}

export interface ScalingDecision {
  action: "scale_up" | "scale_down" | "hold";
  current_workers: number;
  target_workers: number;
  reason: string;
  timestamp: string;
}

// ============================================
// CDN / Asset Optimization types
// ============================================

export interface CDNCacheEntry {
  scene_id: string;
  model_url: string;
  thumbnail_url: string;
  region: string;
  cached_at: string;
  last_accessed_at: string;
  access_count: number;
  file_size_bytes: number;
  compressed_size_bytes: number;
}

export interface SceneStreamingConfig {
  lod_levels: number;           // number of detail levels
  initial_lod: number;          // LOD to load first (lowest)
  progressive_loading: boolean;
  chunk_size_kb: number;        // size of streaming chunks
  prefetch_threshold: number;   // prefetch next LOD when within N% of current
}

// ============================================
// Video Pipeline types
// ============================================

export type CaptureType = "photo" | "video";

export type VideoCaptureStatus =
  | "uploaded"
  | "extracting"
  | "extracted"
  | "processing"
  | "completed"
  | "failed";

export type VideoPipelineStage =
  | "uploaded"
  | "extracting"
  | "reconstructing"
  | "generating"
  | "optimizing"
  | "completed"
  | "failed";

export interface VideoCapture {
  id: string;
  session_id: string;
  property_id: string;
  org_id: string | null;
  storage_path: string;
  file_size: number;
  content_type: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  frame_count: number | null;
  status: VideoCaptureStatus;
  extraction_fps: number | null;
  extracted_frame_count: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ReconstructionResult {
  id: string;
  scene_id: string;
  video_capture_id: string | null;
  camera_poses: Record<string, unknown>[] | null;
  frame_count: number;
  point_count: number;
  avg_depth_confidence: number | null;
  reconstruction_mode: string;
  processing_time_seconds: number | null;
  gpu_type: string | null;
  peak_vram_mb: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface VideoStatusResponse {
  stage: VideoPipelineStage;
  progress: number;
  estimated_time_remaining: number | null;
  scene_id: string | null;
  property_id: string | null;
  error: string | null;
  details: {
    session_status: string;
    scene_status: string | null;
    video_capture_status: string | null;
    current_job_type: string | null;
    current_job_status: string | null;
    completed_jobs: number;
    total_jobs: number;
  };
}

export interface VideoUploadResponse {
  upload_url: string;
  path: string;
  video_capture_id: string;
  video_id: string;
}

export interface VideoConfirmResponse {
  success: boolean;
  scene_id: string;
  property_id: string;
  job_id: string;
}

export interface CreateVideoSessionResponse {
  property_id: string;
  session_id: string;
}

// ============================================
// Data Pipeline types
// ============================================

export interface PipelineCacheEntry {
  cache_key: string;            // hash of input images
  scene_id: string;
  stage: string;                // 'sfm', 'splat', 'optimization'
  artifacts_path: string;
  created_at: string;
  expires_at: string;
  reuse_count: number;
}
