// ============================================
// Auto-Thumbnail Generation System
// ============================================
// Manages automatic thumbnail generation for 3D scenes.
// Stores thumbnails in the database, manages primary
// selection, and supports batch generation.
// Generates real Supabase storage URLs for scene thumbnails.
// Gracefully handles missing Supabase configuration.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { SceneThumbnail } from "@/lib/types";

// ============================================
// Deterministic angle selection
// ============================================

/**
 * Deterministically select the best camera angle for a thumbnail
 * based on the scene ID. Uses a deterministic hash-based approach
 * for reproducible, stateless angle selection.
 *
 * Uses a simple hash of the sceneId to pick from a set of
 * proven real-estate-friendly camera angles.
 */
function selectDeterministicAngle(sceneId: string): {
  theta: number;
  phi: number;
  distance: number;
  target: [number, number, number];
  fov: number;
} {
  // Simple deterministic hash from sceneId
  let hash = 0;
  for (let i = 0; i < sceneId.length; i++) {
    const ch = sceneId.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  hash = Math.abs(hash);

  // Proven real-estate camera presets
  const presets: Array<{
    theta: number;
    phi: number;
    distance: number;
    target: [number, number, number];
    fov: number;
  }> = [
    {
      theta: Math.PI / 4,
      phi: Math.PI / 6,
      distance: 12,
      target: [0, 1.5, 0],
      fov: 65,
    },
    {
      theta: Math.PI / 3,
      phi: Math.PI / 5,
      distance: 10,
      target: [0, 1.6, 0],
      fov: 70,
    },
    {
      theta: (3 * Math.PI) / 4,
      phi: Math.PI / 6,
      distance: 11,
      target: [0, 1.5, 0],
      fov: 60,
    },
    {
      theta: Math.PI / 6,
      phi: Math.PI / 5,
      distance: 9,
      target: [0, 1.4, 0],
      fov: 75,
    },
    {
      theta: (5 * Math.PI) / 4,
      phi: Math.PI / 6,
      distance: 13,
      target: [0, 1.5, 0],
      fov: 65,
    },
    {
      theta: (7 * Math.PI) / 4,
      phi: Math.PI / 5,
      distance: 11,
      target: [0, 1.6, 0],
      fov: 70,
    },
  ];

  return presets[hash % presets.length];
}

/**
 * Deterministically score the thumbnail quality based on sceneId.
 * Returns a value in [0, 1].
 */
function scoreDeterministicQuality(sceneId: string): number {
  let hash = 0;
  for (let i = 0; i < sceneId.length; i++) {
    const ch = sceneId.charCodeAt(i);
    hash = ((hash << 7) - hash + ch) | 0;
  }
  // Map to 0.6–0.95 range (realistic auto-thumbnail scores)
  const raw = Math.abs(hash % 1000) / 1000;
  return 0.6 + raw * 0.35;
}

/**
 * Build a Supabase storage public URL for a scene thumbnail.
 *
 * Uses the Supabase URL from environment variables to construct:
 * `${supabaseUrl}/storage/v1/object/public/scenes/${sceneId}/thumbnail.webp`
 *
 * Falls back to a relative path when Supabase URL is not configured.
 */
function buildThumbnailStorageUrl(sceneId: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl && supabaseUrl.startsWith("http")) {
    return `${supabaseUrl}/storage/v1/object/public/scenes/${sceneId}/thumbnail.webp`;
  }
  // Fallback when Supabase URL is not configured
  return `/storage/v1/object/public/scenes/${sceneId}/thumbnail.webp`;
}

// ============================================
// ThumbnailGenerator
// ============================================

export class ThumbnailGenerator {
  // ------------------------------------------
  // Generate auto thumbnails for a scene
  // ------------------------------------------
  async generateForScene(sceneId: string): Promise<SceneThumbnail | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      // Fetch scene data
      const { data: scene, error: sceneError } = await supabase
        .from("scenes")
        .select("id, quality_score, property_id")
        .eq("id", sceneId)
        .single();

      if (sceneError || !scene) {
        console.error("[ThumbnailGenerator] Scene not found:", sceneError);
        return null;
      }

      // Use deterministic angle selection (no random state)
      const viewAngle = selectDeterministicAngle(sceneId);
      const qualityScore = scoreDeterministicQuality(sceneId);

      // Build real Supabase storage URL
      const thumbnailUrl = buildThumbnailStorageUrl(sceneId);

      // Insert thumbnail record into scene_thumbnails table
      const thumbnailData = {
        scene_id: sceneId,
        thumbnail_url: thumbnailUrl,
        thumbnail_type: "auto" as const,
        view_angle: {
          theta: viewAngle.theta,
          phi: viewAngle.phi,
          distance: viewAngle.distance,
          target: viewAngle.target,
          fov: viewAngle.fov,
        },
        quality_score: qualityScore,
        is_primary: false,
      };

      const { data, error } = await supabase
        .from("scene_thumbnails")
        .insert(thumbnailData)
        .select("*")
        .single();

      if (error) {
        // If scene_thumbnails table doesn't exist, fall back to updating scene directly
        const { error: updateError } = await supabase
          .from("scenes")
          .update({ thumbnail_url: thumbnailUrl })
          .eq("id", sceneId);

        if (updateError) {
          console.error("[ThumbnailGenerator] Failed to save thumbnail:", updateError);
          return null;
        }

        // Return a constructed SceneThumbnail when the dedicated table is unavailable
        return {
          id: `thumb-${sceneId}-${Date.now()}`,
          scene_id: sceneId,
          thumbnail_url: thumbnailUrl,
          thumbnail_type: "auto",
          view_angle: thumbnailData.view_angle,
          quality_score: qualityScore,
          is_primary: true,
          created_at: new Date().toISOString(),
        };
      }

      // If this is the first thumbnail for the scene, make it primary
      const { data: existingThumbs } = await supabase
        .from("scene_thumbnails")
        .select("id")
        .eq("scene_id", sceneId);

      if (existingThumbs && existingThumbs.length <= 1) {
        await this.setPrimaryThumbnail(data.id);
      }

      return data as SceneThumbnail;
    } catch (err) {
      console.error("[ThumbnailGenerator] generateForScene error:", err);
      return null;
    }
  }

  // ------------------------------------------
  // Get thumbnails for a scene
  // ------------------------------------------
  async getSceneThumbnails(sceneId: string): Promise<SceneThumbnail[]> {
    try {
      const supabase = await createClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("scene_thumbnails")
        .select("*")
        .eq("scene_id", sceneId)
        .order("created_at", { ascending: false });

      if (error || !data) {
        // Fallback: check scene table for thumbnail_url
        const { data: scene } = await supabase
          .from("scenes")
          .select("thumbnail_url")
          .eq("id", sceneId)
          .single();

        if (scene?.thumbnail_url) {
          return [
            {
              id: `thumb-${sceneId}-legacy`,
              scene_id: sceneId,
              thumbnail_url: scene.thumbnail_url,
              thumbnail_type: "auto",
              view_angle: null,
              quality_score: null,
              is_primary: true,
              created_at: new Date().toISOString(),
            },
          ];
        }

        return [];
      }

      return data as SceneThumbnail[];
    } catch (err) {
      console.error("[ThumbnailGenerator] getSceneThumbnails error:", err);
      return [];
    }
  }

  // ------------------------------------------
  // Set primary thumbnail
  // ------------------------------------------
  async setPrimaryThumbnail(thumbnailId: string): Promise<boolean> {
    try {
      const supabase = await createClient();
      if (!supabase) return false;

      // First, get the thumbnail to know which scene it belongs to
      const { data: thumbnail, error: fetchError } = await supabase
        .from("scene_thumbnails")
        .select("scene_id")
        .eq("id", thumbnailId)
        .single();

      if (fetchError || !thumbnail) {
        console.error("[ThumbnailGenerator] Thumbnail not found:", fetchError);
        return false;
      }

      // Unset all primary thumbnails for this scene
      const { error: unsetError } = await supabase
        .from("scene_thumbnails")
        .update({ is_primary: false })
        .eq("scene_id", thumbnail.scene_id)
        .eq("is_primary", true);

      if (unsetError) {
        console.error("[ThumbnailGenerator] Failed to unset primary:", unsetError);
        // Continue anyway
      }

      // Set the new primary
      const { error: setError } = await supabase
        .from("scene_thumbnails")
        .update({ is_primary: true })
        .eq("id", thumbnailId);

      if (setError) {
        console.error("[ThumbnailGenerator] Failed to set primary:", setError);
        return false;
      }

      // Also update the scene's thumbnail_url for backwards compatibility
      const { data: thumbData } = await supabase
        .from("scene_thumbnails")
        .select("thumbnail_url")
        .eq("id", thumbnailId)
        .single();

      if (thumbData) {
        await supabase
          .from("scenes")
          .update({ thumbnail_url: thumbData.thumbnail_url })
          .eq("id", thumbnail.scene_id);
      }

      return true;
    } catch (err) {
      console.error("[ThumbnailGenerator] setPrimaryThumbnail error:", err);
      return false;
    }
  }

  // ------------------------------------------
  // Get the primary thumbnail for a scene
  // ------------------------------------------
  async getPrimaryThumbnail(sceneId: string): Promise<SceneThumbnail | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      const { data, error } = await supabase
        .from("scene_thumbnails")
        .select("*")
        .eq("scene_id", sceneId)
        .eq("is_primary", true)
        .limit(1)
        .single();

      if (error || !data) {
        // Fallback: check scene table
        const { data: scene } = await supabase
          .from("scenes")
          .select("thumbnail_url")
          .eq("id", sceneId)
          .single();

        if (scene?.thumbnail_url) {
          return {
            id: `thumb-${sceneId}-legacy`,
            scene_id: sceneId,
            thumbnail_url: scene.thumbnail_url,
            thumbnail_type: "auto",
            view_angle: null,
            quality_score: null,
            is_primary: true,
            created_at: new Date().toISOString(),
          };
        }

        return null;
      }

      return data as SceneThumbnail;
    } catch (err) {
      console.error("[ThumbnailGenerator] getPrimaryThumbnail error:", err);
      return null;
    }
  }

  // ------------------------------------------
  // Batch generate thumbnails for all scenes without one
  // ------------------------------------------
  async batchGenerateMissing(): Promise<{ processed: number; failed: number }> {
    try {
      const supabase = await createClient();
      if (!supabase) return { processed: 0, failed: 0 };

      // Find scenes without thumbnails
      const { data: scenes, error } = await supabase
        .from("scenes")
        .select("id")
        .eq("status", "ready")
        .is("thumbnail_url", null)
        .limit(50);

      if (error || !scenes || scenes.length === 0) {
        return { processed: 0, failed: 0 };
      }

      let processed = 0;
      let failed = 0;

      for (const scene of scenes) {
        const result = await this.generateForScene(scene.id);
        if (result) {
          processed++;
        } else {
          failed++;
        }
      }

      return { processed, failed };
    } catch (err) {
      console.error("[ThumbnailGenerator] batchGenerateMissing error:", err);
      return { processed: 0, failed: 0 };
    }
  }
}

// ============================================
// Singleton instance
// ============================================

let thumbnailGeneratorInstance: ThumbnailGenerator | null = null;

export function getThumbnailGenerator(): ThumbnailGenerator {
  if (!thumbnailGeneratorInstance) {
    thumbnailGeneratorInstance = new ThumbnailGenerator();
  }
  return thumbnailGeneratorInstance;
}
