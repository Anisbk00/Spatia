import { createClient } from "@/lib/supabase/server";
import type { CaptureSession, Property, Scene, ProcessingJob } from "@/lib/types";

// ============================================
// Types
// ============================================

export interface RecoveryReport {
  recovered: string[];
  failed: string[];
  skipped: string[];
}

export interface OrphanSession {
  id: string;
  property_id: string;
  status: string;
  started_at: string;
  hours_since_start: number;
}

export interface OrphanProperty {
  id: string;
  title: string;
  status: string;
  org_id: string | null;
}

export interface OrphanScene {
  id: string;
  property_id: string;
  status: string;
  created_at: string;
}

export interface StuckJob {
  id: string;
  scene_id: string;
  job_type: string;
  status: string;
  started_at: string | null;
  minutes_running: number;
  retry_count: number;
}

export interface MissingMediaUpload {
  id: string;
  session_id: string;
  property_id: string;
  file_name: string;
  status: string;
  media_id: string | null;
}

export interface IntegrityCheckResult {
  valid: boolean;
  issues: string[];
}

// ============================================
// OrphanDetector
// ============================================

export class OrphanDetector {
  /**
   * Find capture_sessions with status 'started'/'uploading' but no media for >1 hour
   */
  async findOrphanSessions(): Promise<OrphanSession[]> {
    const supabase = await createClient();
    if (!supabase) return [];

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Get sessions that are started/uploading and older than 1 hour
    const { data: sessions } = await supabase
      .from("capture_sessions")
      .select("id, property_id, status, started_at")
      .in("status", ["started", "uploading"])
      .lt("started_at", oneHourAgo);

    if (!sessions || sessions.length === 0) return [];

    const orphaned: OrphanSession[] = [];

    for (const session of sessions) {
      // Check if session has any media
      const { count } = await supabase
        .from("media")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session.id);

      if (count === 0) {
        const hoursSinceStart =
          (Date.now() - new Date(session.started_at).getTime()) / (1000 * 60 * 60);
        orphaned.push({
          id: session.id,
          property_id: session.property_id,
          status: session.status,
          started_at: session.started_at,
          hours_since_start: Math.round(hoursSinceStart * 10) / 10,
        });
      }
    }

    return orphaned;
  }

  /**
   * Find properties stuck in 'capturing'/'processing' with no active session/scene
   */
  async findOrphanProperties(): Promise<OrphanProperty[]> {
    const supabase = await createClient();
    if (!supabase) return [];

    const { data: properties } = await supabase
      .from("properties")
      .select("id, title, status, org_id")
      .in("status", ["capturing", "processing"]);

    if (!properties || properties.length === 0) return [];

    const orphaned: OrphanProperty[] = [];

    for (const property of properties) {
      // Check for active capture sessions
      const { data: activeSessions } = await supabase
        .from("capture_sessions")
        .select("id, status")
        .eq("property_id", property.id)
        .in("status", ["started", "uploading", "processing"]);

      // Check for active scenes
      const { data: activeScenes } = await supabase
        .from("scenes")
        .select("id, status")
        .eq("property_id", property.id)
        .in("status", ["queued", "processing"]);

      const hasActiveSession = activeSessions && activeSessions.length > 0;
      const hasActiveScene = activeScenes && activeScenes.length > 0;

      if (!hasActiveSession && !hasActiveScene) {
        orphaned.push({
          id: property.id,
          title: property.title,
          status: property.status,
          org_id: property.org_id,
        });
      }
    }

    return orphaned;
  }

  /**
   * Find scenes with status 'queued'/'processing' but no processing_jobs
   */
  async findOrphanScenes(): Promise<OrphanScene[]> {
    const supabase = await createClient();
    if (!supabase) return [];

    const { data: scenes } = await supabase
      .from("scenes")
      .select("id, property_id, status, created_at")
      .in("status", ["queued", "processing"]);

    if (!scenes || scenes.length === 0) return [];

    const orphaned: OrphanScene[] = [];

    for (const scene of scenes) {
      // Check for processing jobs
      const { count } = await supabase
        .from("processing_jobs")
        .select("id", { count: "exact", head: true })
        .eq("scene_id", scene.id);

      if (count === 0) {
        orphaned.push({
          id: scene.id,
          property_id: scene.property_id,
          status: scene.status,
          created_at: scene.created_at,
        });
      }
    }

    return orphaned;
  }

  /**
   * Find processing_jobs running >30 minutes
   */
  async findStuckJobs(): Promise<StuckJob[]> {
    const supabase = await createClient();
    if (!supabase) return [];

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: jobs } = await supabase
      .from("processing_jobs")
      .select("id, scene_id, job_type, status, started_at, retry_count")
      .eq("status", "running")
      .lt("started_at", thirtyMinutesAgo);

    if (!jobs) return [];

    return jobs.map((job) => ({
      id: job.id,
      scene_id: job.scene_id,
      job_type: job.job_type,
      status: job.status,
      started_at: job.started_at,
      minutes_running: job.started_at
        ? Math.round((Date.now() - new Date(job.started_at).getTime()) / (1000 * 60))
        : 0,
      retry_count: job.retry_count,
    })) as StuckJob[];
  }

  /**
   * Find upload_operations marked 'uploaded' but no matching media record
   */
  async findMissingMedia(): Promise<MissingMediaUpload[]> {
    const supabase = await createClient();
    if (!supabase) return [];

    const { data: uploads } = await supabase
      .from("upload_operations")
      .select("id, session_id, property_id, file_name, status, media_id")
      .eq("status", "uploaded")
      .is("media_id", null);

    if (!uploads) return [];

    const missing: MissingMediaUpload[] = [];

    for (const upload of uploads) {
      // Double-check: is there a media record for this session with matching storage path?
      const { data: uploadDetail } = await supabase
        .from("upload_operations")
        .select("storage_path")
        .eq("id", upload.id)
        .single();

      if (uploadDetail?.storage_path) {
        const { count } = await supabase
          .from("media")
          .select("id", { count: "exact", head: true })
          .eq("url", uploadDetail.storage_path);

        if (count === 0) {
          missing.push({
            id: upload.id,
            session_id: upload.session_id,
            property_id: upload.property_id,
            file_name: upload.file_name,
            status: upload.status,
            media_id: upload.media_id,
          });
        }
      } else {
        // No storage_path means we can't find media either
        missing.push({
          id: upload.id,
          session_id: upload.session_id,
          property_id: upload.property_id,
          file_name: upload.file_name,
          status: upload.status,
          media_id: upload.media_id,
        });
      }
    }

    return missing;
  }
}

// ============================================
// RecoveryService
// ============================================

export class RecoveryService {
  private detector = new OrphanDetector();

  /**
   * Log a recovery action to the system_logs table
   */
  private async logRecovery(
    level: string,
    source: string,
    message: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const supabase = await createClient();
    if (!supabase) return;

    await supabase.from("system_logs").insert({
      level,
      source,
      message,
      metadata,
      created_at: new Date().toISOString(),
    });
  }

  /**
   * Reactivates an orphaned capture session
   */
  async recoverSession(sessionId: string): Promise<"recovered" | "failed" | "skipped"> {
    const supabase = await createClient();
    if (!supabase) return "failed";

    // Get session details
    const { data: session } = await supabase
      .from("capture_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (!session) return "skipped";

    // Check if session still has no media (race condition check)
    const { count } = await supabase
      .from("media")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);

    if (count && count > 0) {
      // Session now has media, update status to uploading
      await supabase
        .from("capture_sessions")
        .update({ status: "uploading" })
        .eq("id", sessionId);

      await this.logRecovery("info", "recovery", "Orphan session now has media, updated to uploading", {
        session_id: sessionId,
        media_count: count,
      });
      return "recovered";
    }

    // If session has been orphaned too long (>24h), mark as failed
    const hoursSinceStart =
      (Date.now() - new Date(session.started_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceStart > 24) {
      await supabase
        .from("capture_sessions")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", sessionId);

      // Reset property status if it was capturing
      await supabase
        .from("properties")
        .update({ status: "draft" })
        .eq("id", session.property_id)
        .in("status", ["capturing"]);

      await this.logRecovery("warn", "recovery", "Orphan session marked as failed (>24h)", {
        session_id: sessionId,
        hours_since_start: Math.round(hoursSinceStart),
      });
      return "recovered";
    }

    // For recently orphaned sessions, reset to started so user can retry
    await supabase
      .from("capture_sessions")
      .update({ status: "started", started_at: new Date().toISOString() })
      .eq("id", sessionId);

    await this.logRecovery("info", "recovery", "Orphan session reactivated", {
      session_id: sessionId,
      previous_status: session.status,
    });

    return "recovered";
  }

  /**
   * Fixes stuck property status
   */
  async recoverProperty(propertyId: string): Promise<"recovered" | "failed" | "skipped"> {
    const supabase = await createClient();
    if (!supabase) return "failed";

    const { data: property } = await supabase
      .from("properties")
      .select("*")
      .eq("id", propertyId)
      .single();

    if (!property) return "skipped";

    // Check for completed scenes
    const { data: readyScenes } = await supabase
      .from("scenes")
      .select("id")
      .eq("property_id", propertyId)
      .eq("status", "ready")
      .limit(1);

    if (readyScenes && readyScenes.length > 0) {
      // Property has a ready scene, update to ready
      await supabase
        .from("properties")
        .update({ status: "ready" })
        .eq("id", propertyId);

      await this.logRecovery("info", "recovery", "Property status corrected to ready (has ready scene)", {
        property_id: propertyId,
        previous_status: property.status,
      });
      return "recovered";
    }

    // Check for completed capture sessions
    const { data: completedSessions } = await supabase
      .from("capture_sessions")
      .select("id")
      .eq("property_id", propertyId)
      .eq("status", "completed")
      .limit(1);

    if (completedSessions && completedSessions.length > 0) {
      // Session completed but no scene — need to reprocess
      await supabase
        .from("properties")
        .update({ status: "capturing" })
        .eq("id", propertyId);

      await this.logRecovery("info", "recovery", "Property status set to capturing (completed session, no scene)", {
        property_id: propertyId,
        previous_status: property.status,
      });
      return "recovered";
    }

    // No completed sessions or scenes — reset to draft
    await supabase
      .from("properties")
      .update({ status: "draft" })
      .eq("id", propertyId);

    await this.logRecovery("info", "recovery", "Property status reset to draft (no active pipeline)", {
      property_id: propertyId,
      previous_status: property.status,
    });

    return "recovered";
  }

  /**
   * Requeues failed/stuck scene processing
   */
  async recoverScene(sceneId: string): Promise<"recovered" | "failed" | "skipped"> {
    const supabase = await createClient();
    if (!supabase) return "failed";

    const { data: scene } = await supabase
      .from("scenes")
      .select("*")
      .eq("id", sceneId)
      .single();

    if (!scene) return "skipped";

    // Check for existing jobs that could still be running
    const { data: activeJobs } = await supabase
      .from("processing_jobs")
      .select("id, status")
      .eq("scene_id", sceneId)
      .in("status", ["queued", "running"]);

    if (activeJobs && activeJobs.length > 0) {
      await this.logRecovery("info", "recovery", "Scene has active jobs, skipping", {
        scene_id: sceneId,
        active_jobs: activeJobs.map((j) => j.id),
      });
      return "skipped";
    }

    // Create new processing job
    const { data: job, error: jobError } = await supabase
      .from("processing_jobs")
      .insert({
        scene_id: sceneId,
        job_type: "sfm_reconstruction",
        status: "queued",
      })
      .select("id")
      .single();

    if (jobError || !job) {
      await this.logRecovery("error", "recovery", "Failed to create recovery job for scene", {
        scene_id: sceneId,
        error: jobError?.message,
      });
      return "failed";
    }

    // Update scene status
    await supabase
      .from("scenes")
      .update({ status: "queued" })
      .eq("id", sceneId);

    // Update property status
    await supabase
      .from("properties")
      .update({ status: "processing" })
      .eq("id", scene.property_id)
      .in("status", ["capturing", "draft"]);

    await this.logRecovery("info", "recovery", "Scene requeued with new processing job", {
      scene_id: sceneId,
      new_job_id: job.id,
      previous_status: scene.status,
    });

    return "recovered";
  }

  /**
   * Retries failed upload
   */
  async recoverUpload(operationId: string): Promise<"recovered" | "failed" | "skipped"> {
    const supabase = await createClient();
    if (!supabase) return "failed";

    const { data: upload } = await supabase
      .from("upload_operations")
      .select("*")
      .eq("id", operationId)
      .single();

    if (!upload) return "skipped";

    // Only retry failed or stuck uploaded-without-media operations
    if (upload.status === "uploaded" && !upload.media_id) {
      // Reset to uploading so the client can retry
      await supabase
        .from("upload_operations")
        .update({
          status: "uploading",
          retry_count: upload.retry_count + 1,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", operationId);

      await this.logRecovery("info", "recovery", "Upload operation reset for retry", {
        operation_id: operationId,
        file_name: upload.file_name,
        retry_count: upload.retry_count + 1,
      });
      return "recovered";
    }

    if (upload.status === "failed") {
      if (upload.retry_count >= 5) {
        await this.logRecovery("warn", "recovery", "Upload max retries exceeded, skipping", {
          operation_id: operationId,
          retry_count: upload.retry_count,
        });
        return "skipped";
      }

      await supabase
        .from("upload_operations")
        .update({
          status: "pending",
          retry_count: upload.retry_count + 1,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", operationId);

      await this.logRecovery("info", "recovery", "Failed upload reset for retry", {
        operation_id: operationId,
        file_name: upload.file_name,
        retry_count: upload.retry_count + 1,
      });
      return "recovered";
    }

    return "skipped";
  }

  /**
   * Runs all detection + recovery in sequence
   */
  async autoRecover(): Promise<RecoveryReport> {
    const report: RecoveryReport = {
      recovered: [],
      failed: [],
      skipped: [],
    };

    // 1. Orphan sessions
    const orphanSessions = await this.detector.findOrphanSessions();
    for (const session of orphanSessions) {
      const result = await this.recoverSession(session.id);
      report[result].push(`session:${session.id}`);
    }

    // 2. Orphan properties
    const orphanProperties = await this.detector.findOrphanProperties();
    for (const property of orphanProperties) {
      const result = await this.recoverProperty(property.id);
      report[result].push(`property:${property.id}`);
    }

    // 3. Orphan scenes
    const orphanScenes = await this.detector.findOrphanScenes();
    for (const scene of orphanScenes) {
      const result = await this.recoverScene(scene.id);
      report[result].push(`scene:${scene.id}`);
    }

    // 4. Stuck jobs — reset to queued if retry_count < 5
    const stuckJobs = await this.detector.findStuckJobs();
    const supabase = await createClient();
    if (supabase) {
      for (const job of stuckJobs) {
        if (job.retry_count < 5) {
          const { error } = await supabase
            .from("processing_jobs")
            .update({
              status: "queued",
              started_at: null,
              retry_count: job.retry_count + 1,
            })
            .eq("id", job.id);

          if (error) {
            report.failed.push(`job:${job.id}`);
          } else {
            await this.logRecovery("info", "recovery", "Stuck job reset to queued", {
              job_id: job.id,
              minutes_running: job.minutes_running,
              retry_count: job.retry_count + 1,
            });
            report.recovered.push(`job:${job.id}`);
          }
        } else {
          // Max retries exceeded, mark as failed
          await supabase
            .from("processing_jobs")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          report.skipped.push(`job:${job.id} (max retries)`);
        }
      }
    }

    // 5. Missing media uploads
    const missingMedia = await this.detector.findMissingMedia();
    for (const upload of missingMedia) {
      const result = await this.recoverUpload(upload.id);
      report[result].push(`upload:${upload.id}`);
    }

    await this.logRecovery("info", "recovery", "Auto-recovery completed", {
      recovered: report.recovered.length,
      failed: report.failed.length,
      skipped: report.skipped.length,
    });

    return report;
  }
}

// ============================================
// DataIntegrityChecker
// ============================================

export class DataIntegrityChecker {
  /**
   * Verifies property→session→scene→job chain
   */
  async checkPropertyIntegrity(propertyId: string): Promise<IntegrityCheckResult> {
    const issues: string[] = [];
    const supabase = await createClient();
    if (!supabase) return { valid: false, issues: ["Database client unavailable"] };

    // Get property
    const { data: property } = await supabase
      .from("properties")
      .select("*")
      .eq("id", propertyId)
      .single();

    if (!property) {
      return { valid: false, issues: [`Property ${propertyId} not found`] };
    }

    // Get sessions for this property
    const { data: sessions } = await supabase
      .from("capture_sessions")
      .select("*")
      .eq("property_id", propertyId);

    // Get scenes for this property
    const { data: scenes } = await supabase
      .from("scenes")
      .select("*")
      .eq("property_id", propertyId);

    // Check: If property is capturing/processing, there should be active sessions
    if (["capturing", "processing"].includes(property.status)) {
      if (!sessions || sessions.length === 0) {
        issues.push(`Property is ${property.status} but has no capture sessions`);
      }
      const activeSessions = sessions?.filter((s) =>
        ["started", "uploading", "processing"].includes(s.status)
      );
      if (!activeSessions || activeSessions.length === 0) {
        issues.push(`Property is ${property.status} but has no active capture sessions`);
      }
    }

    // Check: If property is ready, there should be a ready scene
    if (property.status === "ready") {
      const readyScenes = scenes?.filter((s) => s.status === "ready");
      if (!readyScenes || readyScenes.length === 0) {
        issues.push("Property is ready but has no ready scenes");
      }
    }

    // Check scenes → jobs chain
    if (scenes) {
      for (const scene of scenes) {
        if (["queued", "processing"].includes(scene.status)) {
          const { data: jobs } = await supabase
            .from("processing_jobs")
            .select("id, status")
            .eq("scene_id", scene.id);

          if (!jobs || jobs.length === 0) {
            issues.push(`Scene ${scene.id} is ${scene.status} but has no processing jobs`);
          }

          const activeJobs = jobs?.filter((j) =>
            ["queued", "running"].includes(j.status)
          );
          if (scene.status === "processing" && (!activeJobs || activeJobs.length === 0)) {
            issues.push(`Scene ${scene.id} is processing but has no active jobs`);
          }
        }

        if (scene.status === "ready" && !scene.model_url) {
          issues.push(`Scene ${scene.id} is ready but has no model_url`);
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Verifies session→media→uploads chain
   */
  async checkSessionIntegrity(sessionId: string): Promise<IntegrityCheckResult> {
    const issues: string[] = [];
    const supabase = await createClient();
    if (!supabase) return { valid: false, issues: ["Database client unavailable"] };

    // Get session
    const { data: session } = await supabase
      .from("capture_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return { valid: false, issues: [`Session ${sessionId} not found`] };
    }

    // Get media for this session
    const { data: media } = await supabase
      .from("media")
      .select("*")
      .eq("session_id", sessionId);

    // Get upload operations for this session
    const { data: uploads } = await supabase
      .from("upload_operations")
      .select("*")
      .eq("session_id", sessionId);

    // Check: If session is completed, there should be media
    if (session.status === "completed") {
      if (!media || media.length === 0) {
        issues.push("Session is completed but has no media records");
      }
    }

    // Check: If session is uploading/processing, there should be uploads
    if (["uploading", "processing"].includes(session.status)) {
      if (!uploads || uploads.length === 0) {
        issues.push(`Session is ${session.status} but has no upload operations`);
      }
    }

    // Check: total_images should match media count for completed sessions
    if (session.status === "completed" && media) {
      if (session.total_images !== media.length) {
        issues.push(
          `Session total_images (${session.total_images}) doesn't match media count (${media.length})`
        );
      }
    }

    // Check: uploads marked as 'uploaded' should have media_id
    if (uploads) {
      for (const upload of uploads) {
        if (upload.status === "uploaded" && !upload.media_id) {
          issues.push(
            `Upload ${upload.id} (${upload.file_name}) is uploaded but has no media_id`
          );
        }
      }
    }

    // Check: completed session should have a completed_at
    if (session.status === "completed" && !session.completed_at) {
      issues.push("Session is completed but has no completed_at timestamp");
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Verifies scene→job→model_url chain
   */
  async checkSceneIntegrity(sceneId: string): Promise<IntegrityCheckResult> {
    const issues: string[] = [];
    const supabase = await createClient();
    if (!supabase) return { valid: false, issues: ["Database client unavailable"] };

    // Get scene
    const { data: scene } = await supabase
      .from("scenes")
      .select("*")
      .eq("id", sceneId)
      .single();

    if (!scene) {
      return { valid: false, issues: [`Scene ${sceneId} not found`] };
    }

    // Get jobs for this scene
    const { data: jobs } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("scene_id", sceneId);

    // Check: If scene is queued/processing, there should be jobs
    if (["queued", "processing"].includes(scene.status)) {
      if (!jobs || jobs.length === 0) {
        issues.push(`Scene is ${scene.status} but has no processing jobs`);
      }
    }

    // Check: If scene is processing, at least one job should be running/queued
    if (scene.status === "processing") {
      const activeJobs = jobs?.filter((j) => ["queued", "running"].includes(j.status));
      if (!activeJobs || activeJobs.length === 0) {
        issues.push("Scene is processing but no jobs are queued/running");
      }
    }

    // Check: If scene is ready, it should have model_url
    if (scene.status === "ready") {
      if (!scene.model_url) {
        issues.push("Scene is ready but has no model_url");
      }
      if (!scene.completed_at) {
        issues.push("Scene is ready but has no completed_at timestamp");
      }
    }

    // Check: If scene is failed, at least one job should be failed
    if (scene.status === "failed") {
      const failedJobs = jobs?.filter((j) => j.status === "failed");
      if (!failedJobs || failedJobs.length === 0) {
        issues.push("Scene is failed but no jobs are marked as failed");
      }
    }

    // Check: All completed jobs should have finished_at
    if (jobs) {
      for (const job of jobs) {
        if (job.status === "completed" && !job.finished_at) {
          issues.push(`Job ${job.id} is completed but has no finished_at`);
        }
        if (job.status === "running" && !job.started_at) {
          issues.push(`Job ${job.id} is running but has no started_at`);
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
