// ============================================
// Data Pipeline Optimization
// ============================================
// Optimizes the 3D reconstruction pipeline by caching intermediate
// results, deduplicating work, reusing partial reconstructions,
// and optimizing batch processing order.
// All cache data is persisted in Supabase (pipeline_cache table).
// Falls back gracefully when Supabase or tables are unavailable.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { PipelineCacheEntry } from "@/lib/types";
import { logger } from "@/lib/logger";

// ============================================
// Configurable thresholds
// ============================================

/** Minimum reuse score to consider a scene as a viable reuse candidate */
export const MIN_REUSE_SCORE = 0.3;

/** Default cache TTL in hours */
export const DEFAULT_CACHE_TTL_HOURS = 168; // 7 days

/** Weight for quality score in reuse calculation */
export const QUALITY_WEIGHT = 0.7;

/** Weight for processing time in reuse calculation */
export const TIME_WEIGHT = 0.3;

/** Maximum number of reuse candidates to return */
export const MAX_REUSE_CANDIDATES = 5;

// ============================================
// DataPipelineOptimizer
// ============================================

/**
 * Optimizes the data processing pipeline for efficiency.
 *
 * Provides caching of intermediate reconstruction results,
 * deduplication of image inputs, and batch optimization
 * to reduce redundant GPU processing.
 *
 * Cache entries are persisted in the Supabase pipeline_cache
 * table so they survive server restarts.
 */
export class DataPipelineOptimizer {
  /**
   * Batch ingest images for processing.
   *
   * Validates images in a capture session, checking for
   * duplicates and quality issues before processing begins.
   *
   * @param sessionId - The capture session ID
   * @param propertyId - The property ID
   * @returns Ingest statistics with validation results
   */
  async batchIngestImages(
    sessionId: string,
    propertyId: string,
  ): Promise<{
    totalImages: number;
    validImages: number;
    duplicateImages: number;
    lowQualityImages: number;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return {
          totalImages: 0,
          validImages: 0,
          duplicateImages: 0,
          lowQualityImages: 0,
        };
      }

      // Get all media for this session/property
      const { data: media, error } = await supabase
        .from("media")
        .select("id, url, metadata, type")
        .eq("session_id", sessionId)
        .eq("property_id", propertyId)
        .eq("type", "image");

      if (error || !media) {
        console.error("[DataPipeline] Error fetching media for ingest:", error);
        return {
          totalImages: 0,
          validImages: 0,
          duplicateImages: 0,
          lowQualityImages: 0,
        };
      }

      const totalImages = media.length;
      let duplicateImages = 0;
      let lowQualityImages = 0;

      // Check for duplicates using metadata hash
      const seenHashes = new Set<string>();

      for (const item of media) {
        const metadata = (item.metadata as Record<string, unknown>) || {};

        // Check for duplicate by perceptual hash
        const hash = metadata.phash as string | undefined;
        if (hash) {
          if (seenHashes.has(hash)) {
            duplicateImages++;
            continue;
          }
          seenHashes.add(hash);
        }

        // Check image quality from metadata
        const blurScore = metadata.blur_score as number | undefined;
        const resolution = metadata.resolution as string | undefined;

        if (blurScore !== undefined && blurScore < 0.3) {
          // Low blur score indicates blurry image
          lowQualityImages++;
          continue;
        }

        if (resolution) {
          const parts = resolution.split("x").map(Number);
          const [w, h] = parts;
          if (isNaN(w) || isNaN(h)) {
            // Invalid resolution format, count as low quality
            lowQualityImages++;
            continue;
          }
          if (w < 640 || h < 480) {
            lowQualityImages++;
            continue;
          }
        }
      }

      const validImages = totalImages - duplicateImages - lowQualityImages;

      logger.info(
        "DataPipeline",
        `Batch ingest for session ${sessionId}: ` +
        `${totalImages} total, ${validImages} valid, ${duplicateImages} duplicates, ${lowQualityImages} low quality`,
      );

      return {
        totalImages,
        validImages,
        duplicateImages,
        lowQualityImages,
      };
    } catch (err) {
      console.error("[DataPipeline] Error during batch ingest:", err);
      return {
        totalImages: 0,
        validImages: 0,
        duplicateImages: 0,
        lowQualityImages: 0,
      };
    }
  }

  /**
   * Check for cached intermediate results.
   *
   * Looks up a cache entry by image hash in the Supabase
   * pipeline_cache table to find reusable intermediate
   * reconstruction results.
   *
   * @param imageHash - Perceptual hash of the input images
   * @returns Cached entry if found and not expired, null otherwise
   */
  async checkCache(imageHash: string): Promise<PipelineCacheEntry | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      const { data, error } = await supabase
        .from("pipeline_cache")
        .select("*")
        .eq("cache_key", imageHash)
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      // Increment reuse_count with proper error handling (not fire-and-forget)
      try {
        await supabase
          .from("pipeline_cache")
          .update({ reuse_count: (data.reuse_count ?? 0) + 1 })
          .eq("cache_key", imageHash);
      } catch (reuseErr) {
        // Log but don't fail — the cache hit itself is still valid
        console.warn(
          "[DataPipeline] Failed to increment reuse_count for cache key",
          imageHash,
          reuseErr,
        );
      }

      return data as PipelineCacheEntry;
    } catch (err) {
      console.error("[DataPipeline] Error checking cache:", err);
      return null;
    }
  }

  /**
   * Store intermediate results in cache.
   *
   * Persists pipeline stage artifacts to the pipeline_cache
   * table in Supabase so they can be reused by future jobs.
   *
   * @param params - Cache entry parameters
   */
  async storeCache(params: {
    cacheKey: string;
    sceneId: string;
    stage: string;
    artifactsPath: string;
    ttlHours?: number;
  }): Promise<void> {
    try {
      const supabase = await createClient();
      if (!supabase) return;

      const ttl = params.ttlHours ?? DEFAULT_CACHE_TTL_HOURS;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttl * 60 * 60 * 1000);

      const row = {
        cache_key: params.cacheKey,
        scene_id: params.sceneId,
        stage: params.stage,
        artifacts_path: params.artifactsPath,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        reuse_count: 0,
      };

      const { error } = await supabase
        .from("pipeline_cache")
        .upsert(row, { onConflict: "cache_key" });

      if (error) {
        console.warn(
          `[DataPipeline] pipeline_cache table unavailable, skipping cache write:`,
          error.message,
        );
        return;
      }

      logger.info(
        "DataPipeline",
        `Cached ${params.stage} artifacts for scene ${params.sceneId} (TTL: ${ttl}h)`,
      );
    } catch (err) {
      console.error("[DataPipeline] Error storing cache:", err);
    }
  }

  /**
   * Find reusable partial reconstructions from similar properties.
   *
   * Searches for existing scene reconstructions that could be
   * partially reused (e.g., same room type, similar layout)
   * to accelerate new scene generation.
   *
   * @param params - Search parameters
   * @returns Array of potentially reusable reconstructions with scores
   */
  async findReusableReconstruction(params: {
    propertyType: string;
    imageCount: number;
    region: string;
  }): Promise<
    Array<{ sceneId: string; reuseScore: number; stage: string }>
  > {
    try {
      const supabase = await createClient();
      if (!supabase) return [];

      // Find scenes from similar property types
      const { data: similarProperties, error } = await supabase
        .from("properties")
        .select("id, property_type")
        .eq("property_type", params.propertyType)
        .eq("status", "ready")
        .limit(20);

      if (error || !similarProperties || similarProperties.length === 0) {
        return [];
      }

      const propertyIds = similarProperties.map((p) => p.id as string);

      // Get scenes for these properties
      const { data: scenes } = await supabase
        .from("scenes")
        .select("id, property_id, quality_score, processing_time_seconds")
        .eq("status", "ready")
        .in("property_id", propertyIds);

      if (!scenes || scenes.length === 0) return [];

      // Score each scene for reusability
      const results: Array<{
        sceneId: string;
        reuseScore: number;
        stage: string;
      }> = [];

      for (const scene of scenes) {
        // Reuse score based on:
        // - Quality score (higher = better candidate)
        // - Processing time (faster = more efficient to reuse)
        const qualityFactor = (scene.quality_score as number) || 0.5;
        const timeFactor = scene.processing_time_seconds
          ? Math.max(0, 1 - (scene.processing_time_seconds as number) / 3600)
          : 0.5;

        const reuseScore = qualityFactor * QUALITY_WEIGHT + timeFactor * TIME_WEIGHT;

        // TODO: Incorporate imageCount and region into the scoring.
        // Currently these params are accepted but not used in the query
        // because the scenes table doesn't store image count or region
        // directly. To fully utilize these params, we would need to:
        //   1. Join through capture_sessions to get media count for imageCount
        //   2. Join through properties to get a region field (not currently in schema)
        // For now, the scoring uses quality and processing time as proxies.

        if (reuseScore > MIN_REUSE_SCORE) {
          results.push({
            sceneId: scene.id as string,
            reuseScore: Math.round(reuseScore * 100) / 100,
            stage: "sfm", // The most reusable stage is SFM point cloud
          });
        }
      }

      // Sort by reuse score (highest first)
      results.sort((a, b) => b.reuseScore - a.reuseScore);

      return results.slice(0, MAX_REUSE_CANDIDATES);
    } catch (err) {
      console.error(
        "[DataPipeline] Error finding reusable reconstructions:",
        err,
      );
      return [];
    }
  }

  /**
   * Clean up expired cache entries.
   *
   * Deletes pipeline cache entries that have exceeded their TTL
   * from the Supabase pipeline_cache table.
   *
   * @returns Number of entries cleaned up
   */
  async cleanupExpiredCache(): Promise<number> {
    try {
      const supabase = await createClient();
      if (!supabase) return 0;

      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from("pipeline_cache")
        .delete()
        .lt("expires_at", now)
        .select("cache_key");

      if (error) {
        console.warn(
          `[DataPipeline] pipeline_cache table unavailable during cleanup:`,
          error.message,
        );
        return 0;
      }

      const cleanedCount = data?.length ?? 0;

      if (cleanedCount > 0) {
        logger.info(
          "DataPipeline",
          `Cleaned up ${cleanedCount} expired cache entries`,
        );
      }

      return cleanedCount;
    } catch (err) {
      console.error("[DataPipeline] Error cleaning up expired cache:", err);
      return 0;
    }
  }

  /**
   * Optimize batch processing order.
   *
   * Reorders jobs to group similar workloads together, reducing
   * GPU context switching and enabling better cache utilization.
   * Groups by: property type → scene complexity → org priority.
   *
   * @param jobIds - Array of job IDs to optimize
   * @returns Reordered job IDs for optimal processing
   */
  async optimizeBatchOrder(jobIds: string[]): Promise<string[]> {
    try {
      if (jobIds.length <= 1) return [...jobIds];

      const supabase = await createClient();
      if (!supabase) return [...jobIds];

      // Fetch job details with scene and property info
      const { data: jobs, error } = await supabase
        .from("processing_jobs")
        .select("id, scene_id, job_type, created_at")
        .in("id", jobIds);

      if (error || !jobs || jobs.length === 0) return [...jobIds];

      // Fetch scene details
      const sceneIds = jobs.map((j) => j.scene_id as string).filter(Boolean);
      if (sceneIds.length === 0) return [...jobIds];

      const { data: scenes } = await supabase
        .from("scenes")
        .select("id, property_id")
        .in("id", sceneIds);

      if (!scenes) return [...jobIds];

      const sceneToProperty = new Map(
        scenes.map((s) => [s.id as string, s.property_id as string]),
      );

      // Fetch property details for grouping
      const propertyIds = Array.from(
        new Set(scenes.map((s) => s.property_id as string)),
      );

      const { data: properties } = await supabase
        .from("properties")
        .select("id, property_type, org_id")
        .in("id", propertyIds);

      const propertyToType = new Map(
        (properties || []).map((p) => [p.id as string, p.property_type as string]),
      );
      const propertyToOrg = new Map(
        (properties || []).map((p) => [p.id as string, p.org_id as string]),
      );

      // Get org plans for priority
      const orgIds = Array.from(
        new Set(
          (properties || [])
            .map((p) => p.org_id as string)
            .filter(Boolean),
        ),
      );

      const orgPlans: Record<string, string> = {};
      if (orgIds.length > 0) {
        const { data: orgs } = await supabase
          .from("organizations")
          .select("id, plan")
          .in("id", orgIds);

        for (const org of orgs || []) {
          orgPlans[org.id as string] = org.plan as string;
        }
      }

      // Create sortable job entries
      const jobEntries = jobs.map((job) => {
        const propertyId = sceneToProperty.get(job.scene_id as string);
        const propertyType = propertyId
          ? propertyToType.get(propertyId) || "unknown"
          : "unknown";
        const orgId = propertyId
          ? propertyToOrg.get(propertyId) || ""
          : "";
        const plan = orgPlans[orgId] || "free";

        // Priority: business > pro > free
        const priorityMap: Record<string, number> = {
          business: 3,
          pro: 2,
          free: 1,
        };
        const priority = priorityMap[plan] || 1;

        return {
          id: job.id as string,
          jobType: job.job_type as string,
          propertyType,
          priority,
          createdAt: job.created_at as string,
        };
      });

      // Sort by: priority (desc) → property type (group) → job type (group) → created_at (asc)
      jobEntries.sort((a, b) => {
        // Priority first (higher = earlier)
        if (a.priority !== b.priority) return b.priority - a.priority;

        // Group by property type
        if (a.propertyType !== b.propertyType) {
          return a.propertyType.localeCompare(b.propertyType);
        }

        // Group by job type
        if (a.jobType !== b.jobType) {
          return a.jobType.localeCompare(b.jobType);
        }

        // FIFO within same group
        return a.createdAt.localeCompare(b.createdAt);
      });

      return jobEntries.map((j) => j.id);
    } catch (err) {
      console.error("[DataPipeline] Error optimizing batch order:", err);
      return [...jobIds];
    }
  }

  /**
   * Get pipeline efficiency metrics.
   *
   * Calculates metrics about cache hit rates, redundant processing,
   * batch efficiency, and reuse statistics by querying Supabase.
   *
   * @returns Pipeline efficiency metrics
   */
  async getPipelineEfficiency(): Promise<{
    cacheHitRate: number;
    avgRedundantProcessing: number;
    batchEfficiency: number;
    reusedReconstructions: number;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return {
          cacheHitRate: 0,
          avgRedundantProcessing: 0,
          batchEfficiency: 0,
          reusedReconstructions: 0,
        };
      }

      // Calculate cache hit rate from Supabase pipeline_cache table.
      // Correct formula: total reuse_count / total accesses,
      // where total accesses = sum of (reuse_count + 1) per entry
      // (1 for the original cache write + reuse_count for subsequent hits).
      let cacheHitRate = 0;
      let reusedReconstructions = 0;

      const { data: cacheEntries, error: cacheError } = await supabase
        .from("pipeline_cache")
        .select("reuse_count");

      if (!cacheError && cacheEntries && cacheEntries.length > 0) {
        let totalAccesses = 0;

        for (const entry of cacheEntries) {
          const reuseCount = (entry.reuse_count as number) || 0;
          reusedReconstructions += reuseCount;
          totalAccesses += reuseCount + 1; // 1 original + N reuses
        }

        cacheHitRate = totalAccesses > 0 ? reusedReconstructions / totalAccesses : 0;
      }

      // Calculate redundant processing from duplicate scenes
      // (scenes that were processed from the same capture session)
      const thirtyDaysAgo = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: recentScenes } = await supabase
        .from("scenes")
        .select("id, session_id, processing_time_seconds")
        .gte("created_at", thirtyDaysAgo)
        .not("session_id", "is", null)
        .limit(1000);

      let totalProcessingTime = 0;
      let duplicateProcessingTime = 0;
      const sessionSceneCount: Record<string, number> = {};

      if (recentScenes) {
        for (const scene of recentScenes) {
          const sessionId = scene.session_id as string;
          const processingTime = (scene.processing_time_seconds as number) || 0;
          totalProcessingTime += processingTime;

          sessionSceneCount[sessionId] =
            (sessionSceneCount[sessionId] || 0) + 1;
        }

        // Scenes from sessions with more than 1 scene are potentially redundant
        for (const scene of recentScenes) {
          const sessionId = scene.session_id as string;
          if (sessionSceneCount[sessionId] > 1) {
            duplicateProcessingTime +=
              (scene.processing_time_seconds as number) || 0;
          }
        }
      }

      const avgRedundantProcessing =
        totalProcessingTime > 0
          ? duplicateProcessingTime / totalProcessingTime
          : 0;

      // Batch efficiency: ratio of jobs processed in optimal order
      // Higher is better — measures how often similar jobs were grouped
      const { data: recentJobs } = await supabase
        .from("processing_jobs")
        .select("job_type, started_at, finished_at")
        .eq("status", "completed")
        .gte("finished_at", thirtyDaysAgo)
        .not("started_at", "is", null)
        .limit(2000);

      let batchEfficiency = 0.5; // Default moderate efficiency
      if (recentJobs && recentJobs.length > 10) {
        // Check if consecutive jobs have the same type (batch grouping)
        let sameTypeConsecutive = 0;
        let totalConsecutive = 0;

        const sortedJobs = recentJobs
          .filter((j) => j.started_at && j.finished_at)
          .sort(
            (a, b) =>
              new Date(a.started_at as string).getTime() -
              new Date(b.started_at as string).getTime(),
          );

        for (let i = 1; i < sortedJobs.length; i++) {
          totalConsecutive++;
          if (sortedJobs[i].job_type === sortedJobs[i - 1].job_type) {
            sameTypeConsecutive++;
          }
        }

        batchEfficiency =
          totalConsecutive > 0
            ? sameTypeConsecutive / totalConsecutive
            : 0;
      }

      return {
        cacheHitRate: Math.round(cacheHitRate * 1000) / 1000,
        avgRedundantProcessing:
          Math.round(avgRedundantProcessing * 1000) / 1000,
        batchEfficiency: Math.round(batchEfficiency * 1000) / 1000,
        reusedReconstructions,
      };
    } catch (err) {
      console.error("[DataPipeline] Error getting pipeline efficiency:", err);
      return {
        cacheHitRate: 0,
        avgRedundantProcessing: 0,
        batchEfficiency: 0,
        reusedReconstructions: 0,
      };
    }
  }
}

// ============================================
// Singleton
// ============================================

let pipelineOptimizerInstance: DataPipelineOptimizer | null = null;

/**
 * Get the global DataPipelineOptimizer singleton.
 *
 * @returns The DataPipelineOptimizer instance
 */
export function getDataPipelineOptimizer(): DataPipelineOptimizer {
  if (!pipelineOptimizerInstance) {
    pipelineOptimizerInstance = new DataPipelineOptimizer();
  }
  return pipelineOptimizerInstance;
}
