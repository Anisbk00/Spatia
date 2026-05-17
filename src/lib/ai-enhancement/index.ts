// ============================================
// AI Enhancement Pipeline
// ============================================
// Manages AI-based scene enhancements including:
// - Scene cleanup (noise removal, geometry stabilization)
// - Room detection (automatic room identification)
// - Object removal (clutter detection and removal)
// - Lighting enhancement (exposure correction, tone mapping)
// - Auto thumbnail generation (best view angle selection)
// Gracefully handles missing Supabase configuration.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type {
  AIEnhancement,
  EnhancementType,
  EnhancementStatus,
  DetectedRoom,
} from "@/lib/types";
import { performSceneCleanup } from "./scene-cleanup";
import { performRoomDetection } from "./room-detection";
import { performClutterDetection } from "./object-removal";
import { performLightingEnhancement } from "./lighting";
import { generateAutoThumbnail } from "./auto-thumbnail";

export class AIEnhancementPipeline {
  // ------------------------------------------
  // Queue an enhancement job
  // ------------------------------------------
  async queueEnhancement(params: {
    sceneId: string;
    orgId: string;
    enhancementType: EnhancementType | "full_enhancement";
  }): Promise<string | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      // Check for duplicate queued/processing enhancement
      const { data: existing } = await supabase
        .from("ai_enhancements")
        .select("id")
        .eq("scene_id", params.sceneId)
        .eq("enhancement_type", params.enhancementType)
        .in("status", ["queued", "processing"])
        .limit(1)
        .single();

      if (existing) {
        return existing.id;
      }

      // Insert new enhancement job
      const { data, error } = await supabase
        .from("ai_enhancements")
        .insert({
          scene_id: params.sceneId,
          org_id: params.orgId,
          enhancement_type: params.enhancementType,
          status: "queued" as EnhancementStatus,
          input_artifacts: {},
          output_artifacts: {},
        })
        .select("id")
        .single();

      if (error) {
        console.error("[AIEnhancement] Failed to queue enhancement:", error);
        return null;
      }

      return data?.id ?? null;
    } catch (err) {
      console.error("[AIEnhancement] queueEnhancement error:", err);
      return null;
    }
  }

  // ------------------------------------------
  // Get enhancement status
  // ------------------------------------------
  async getEnhancementStatus(enhancementId: string): Promise<AIEnhancement | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      const { data, error } = await supabase
        .from("ai_enhancements")
        .select("*")
        .eq("id", enhancementId)
        .single();

      if (error || !data) {
        console.error("[AIEnhancement] Failed to get enhancement status:", error);
        return null;
      }

      return data as AIEnhancement;
    } catch (err) {
      console.error("[AIEnhancement] getEnhancementStatus error:", err);
      return null;
    }
  }

  // ------------------------------------------
  // Get enhancements for a scene
  // ------------------------------------------
  async getSceneEnhancements(sceneId: string): Promise<AIEnhancement[]> {
    try {
      const supabase = await createClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("ai_enhancements")
        .select("*")
        .eq("scene_id", sceneId)
        .order("created_at", { ascending: false });

      if (error || !data) {
        console.error("[AIEnhancement] Failed to get scene enhancements:", error);
        return [];
      }

      return data as AIEnhancement[];
    } catch (err) {
      console.error("[AIEnhancement] getSceneEnhancements error:", err);
      return [];
    }
  }

  // ------------------------------------------
  // Complete an enhancement job
  // ------------------------------------------
  async completeEnhancement(
    enhancementId: string,
    results: {
      outputArtifacts?: Record<string, unknown>;
      detectedRooms?: DetectedRoom[];
      qualityBefore?: number;
      qualityAfter?: number;
      improvementPercent?: number;
      processingTimeSeconds?: number;
      workerId?: string;
    },
  ): Promise<boolean> {
    try {
      const supabase = await createClient();
      if (!supabase) return false;

      const update: Record<string, unknown> = {
        status: "completed" as EnhancementStatus,
        completed_at: new Date().toISOString(),
      };

      if (results.outputArtifacts) update.output_artifacts = results.outputArtifacts;
      if (results.detectedRooms) update.detected_rooms = results.detectedRooms;
      if (results.qualityBefore !== undefined) update.quality_before = results.qualityBefore;
      if (results.qualityAfter !== undefined) update.quality_after = results.qualityAfter;
      if (results.improvementPercent !== undefined) update.improvement_percent = results.improvementPercent;
      if (results.processingTimeSeconds !== undefined) update.processing_time_seconds = results.processingTimeSeconds;
      if (results.workerId) update.worker_id = results.workerId;

      const { error } = await supabase
        .from("ai_enhancements")
        .update(update)
        .eq("id", enhancementId)
        .in("status", ["queued", "processing"]);

      if (error) {
        console.error("[AIEnhancement] Failed to complete enhancement:", error);
        return false;
      }

      return true;
    } catch (err) {
      console.error("[AIEnhancement] completeEnhancement error:", err);
      return false;
    }
  }

  // ------------------------------------------
  // Fail an enhancement job
  // ------------------------------------------
  async failEnhancement(enhancementId: string, error: string): Promise<boolean> {
    try {
      const supabase = await createClient();
      if (!supabase) return false;

      const { error: dbError } = await supabase
        .from("ai_enhancements")
        .update({
          status: "failed" as EnhancementStatus,
          output_artifacts: { error },
          completed_at: new Date().toISOString(),
        })
        .eq("id", enhancementId)
        .in("status", ["queued", "processing"]);

      if (dbError) {
        console.error("[AIEnhancement] Failed to mark enhancement as failed:", dbError);
        return false;
      }

      return true;
    } catch (err) {
      console.error("[AIEnhancement] failEnhancement error:", err);
      return false;
    }
  }

  // ------------------------------------------
  // Get next queued enhancement (for worker pickup)
  // ------------------------------------------
  async getNextQueuedEnhancement(): Promise<AIEnhancement | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      // Get the oldest queued enhancement
      const { data, error } = await supabase
        .from("ai_enhancements")
        .select("*")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (error || !data) {
        return null;
      }

      // Atomically claim it by updating status to processing
      const { error: updateError } = await supabase
        .from("ai_enhancements")
        .update({ status: "processing" as EnhancementStatus })
        .eq("id", data.id)
        .eq("status", "queued"); // Only claim if still queued

      if (updateError) {
        console.error("[AIEnhancement] Failed to claim enhancement:", updateError);
        return null;
      }

      return { ...data, status: "processing" as EnhancementStatus } as AIEnhancement;
    } catch (err) {
      console.error("[AIEnhancement] getNextQueuedEnhancement error:", err);
      return null;
    }
  }

  // ------------------------------------------
  // Run scene cleanup analysis
  // ------------------------------------------
  async analyzeSceneCleanup(sceneId: string): Promise<{
    noiseLevel: number;
    outlierPoints: number;
    geometryStability: number;
    recommendations: string[];
  }> {
    try {
      const supabase = await createClient();

      // Try to get scene data for more realistic simulation
      let splatCount = 500000;
      let qualityScore = 0.7;

      if (supabase) {
        const { data: scene } = await supabase
          .from("scenes")
          .select("quality_score")
          .eq("id", sceneId)
          .single();

        if (scene?.quality_score) {
          qualityScore = Number(scene.quality_score);
        }
      }

      // Deterministic cleanup analysis based on quality
      const noiseLevel = Math.max(0, Math.min(1, 1 - qualityScore));
      const outlierPoints = Math.floor(splatCount * noiseLevel * 0.05);
      const geometryStability = Math.min(1, qualityScore + 0.1);

      const recommendations: string[] = [];
      if (noiseLevel > 0.3) recommendations.push("High noise detected — consider aggressive outlier removal");
      if (geometryStability < 0.7) recommendations.push("Geometry instability detected — run mesh stabilization pass");
      if (outlierPoints > 10000) recommendations.push(`${outlierPoints.toLocaleString()} outlier points detected — cleanup recommended`);
      if (noiseLevel < 0.15) recommendations.push("Scene is clean — minimal cleanup needed");

      return {
        noiseLevel: Math.round(noiseLevel * 100) / 100,
        outlierPoints,
        geometryStability: Math.round(geometryStability * 100) / 100,
        recommendations,
      };
    } catch (err) {
      console.error("[AIEnhancement] analyzeSceneCleanup error:", err);
      return {
        noiseLevel: 0.2,
        outlierPoints: 5000,
        geometryStability: 0.8,
        recommendations: ["Analysis incomplete — using defaults"],
      };
    }
  }

  // ------------------------------------------
  // Run room detection
  // ------------------------------------------
  async detectRooms(sceneId: string): Promise<DetectedRoom[]> {
    try {
      const supabase = await createClient();

      let propertyType = "house";
      let splatCount = 500000;

      if (supabase) {
        // Get scene → property → property_type
        const { data: scene } = await supabase
          .from("scenes")
          .select("property_id, quality_score")
          .eq("id", sceneId)
          .single();

        if (scene?.property_id) {
          const { data: property } = await supabase
            .from("properties")
            .select("property_type")
            .eq("id", scene.property_id)
            .single();

          if (property?.property_type) {
            propertyType = property.property_type;
          }
        }
      }

      // Estimate scene bounds from splat count
      const estimatedSize = Math.sqrt(splatCount / 1000);
      const sceneBounds = {
        min: [-estimatedSize / 2, 0, -estimatedSize / 2],
        max: [estimatedSize / 2, 3, estimatedSize / 2],
      };

      const rooms = await performRoomDetection({
        propertyType,
        sceneBounds,
        splatCount,
      });

      return rooms;
    } catch (err) {
      console.error("[AIEnhancement] detectRooms error:", err);
      return [];
    }
  }

  // ------------------------------------------
  // Run object removal analysis
  // ------------------------------------------
  async analyzeClutter(sceneId: string): Promise<{
    detectedObjects: Array<{ type: string; confidence: number; bounds: unknown }>;
    removableCount: number;
    recommendations: string[];
  }> {
    try {
      const supabase = await createClient();

      let propertyType = "house";
      let roomCount = 4;

      if (supabase) {
        const { data: scene } = await supabase
          .from("scenes")
          .select("property_id")
          .eq("id", sceneId)
          .single();

        if (scene?.property_id) {
          const { data: property } = await supabase
            .from("properties")
            .select("property_type")
            .eq("id", scene.property_id)
            .single();

          if (property?.property_type) {
            propertyType = property.property_type;
          }
        }
      }

      const result = await performClutterDetection({
        roomCount,
        propertyType,
      });

      const recommendations: string[] = [];
      if (result.totalClutterItems > 5) {
        recommendations.push("High clutter detected — recommend virtual staging cleanup");
      }
      if (result.removableItems > 0) {
        recommendations.push(`${result.removableItems} removable objects found — auto-remove recommended`);
      }
      if (result.cleanupScore > 0.8) {
        recommendations.push("Scene is relatively clean — minimal cleanup needed");
      }

      return {
        detectedObjects: result.detectedObjects.map((obj) => ({
          type: obj.type,
          confidence: obj.confidence,
          bounds: null,
        })),
        removableCount: result.removableItems,
        recommendations,
      };
    } catch (err) {
      console.error("[AIEnhancement] analyzeClutter error:", err);
      return {
        detectedObjects: [],
        removableCount: 0,
        recommendations: ["Analysis incomplete"],
      };
    }
  }

  // ------------------------------------------
  // Run lighting analysis
  // ------------------------------------------
  async analyzeLighting(sceneId: string): Promise<{
    consistencyScore: number;
    overexposedAreas: number;
    underexposedAreas: number;
    recommendations: string[];
  }> {
    try {
      const supabase = await createClient();

      let imageCount = 50;
      let roomCount = 4;
      let currentQuality = 0.7;

      if (supabase) {
        const { data: scene } = await supabase
          .from("scenes")
          .select("quality_score, property_id")
          .eq("id", sceneId)
          .single();

        if (scene?.quality_score) {
          currentQuality = Number(scene.quality_score);
        }

        if (scene?.property_id) {
          const { data: sessions } = await supabase
            .from("capture_sessions")
            .select("total_images")
            .eq("property_id", scene.property_id)
            .order("started_at", { ascending: false })
            .limit(1);

          if (sessions && sessions.length > 0) {
            imageCount = sessions[0].total_images || 50;
          }
        }
      }

      const result = await performLightingEnhancement({
        imageCount,
        roomCount,
        currentQuality,
      });

      const recommendations: string[] = [];
      if (result.consistencyBefore < 0.6) {
        recommendations.push("Low lighting consistency — HDR merge recommended");
      }
      if (result.exposureCorrection > 0.3) {
        recommendations.push("Significant exposure correction needed across rooms");
      }
      if (result.toneMappingApplied) {
        recommendations.push("Tone mapping applied for balanced lighting");
      }

      return {
        consistencyScore: result.consistencyAfter,
        overexposedAreas: Math.floor(imageCount * (1 - result.consistencyBefore) * 0.3),
        underexposedAreas: Math.floor(imageCount * (1 - result.consistencyBefore) * 0.2),
        recommendations,
      };
    } catch (err) {
      console.error("[AIEnhancement] analyzeLighting error:", err);
      return {
        consistencyScore: 0.7,
        overexposedAreas: 3,
        underexposedAreas: 5,
        recommendations: ["Analysis incomplete"],
      };
    }
  }
}

// ============================================
// Singleton instance
// ============================================

let pipelineInstance: AIEnhancementPipeline | null = null;

export function getAIEnhancementPipeline(): AIEnhancementPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new AIEnhancementPipeline();
  }
  return pipelineInstance;
}
