"use client";

import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Types for realtime events
export type DashboardRealtimeEvent =
  | { type: "scene_updated"; sceneId: string; status: string; propertyId: string }
  | { type: "job_updated"; jobId: string; status: string; sceneId: string }
  | { type: "capture_updated"; sessionId: string; status: string; propertyId: string }
  | { type: "property_updated"; propertyId: string; status: string };

// Callback type
export type DashboardRealtimeCallback = (event: DashboardRealtimeEvent) => void;

/**
 * Subscribe to realtime updates for a dashboard.
 * Returns an unsubscribe function.
 */
export function subscribeToDashboardUpdates(
  orgId: string,
  onEvent: DashboardRealtimeCallback,
): () => void {
  const supabase = createClient();
  if (!supabase) return () => {};

  const channels: RealtimeChannel[] = [];

  // Subscribe to scene changes
  const scenesChannel = supabase
    .channel(`dashboard-scenes-${orgId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "scenes",
        filter: `property_id=in.(select id from properties where org_id = '${orgId}')`,
      },
      (payload) => {
        const rec = payload.new as Record<string, unknown>;
        onEvent({
          type: "scene_updated",
          sceneId: rec.id as string,
          status: rec.status as string,
          propertyId: rec.property_id as string,
        });
      },
    )
    .subscribe();
  channels.push(scenesChannel);

  // Subscribe to processing job changes
  const jobsChannel = supabase
    .channel(`dashboard-jobs-${orgId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "processing_jobs",
      },
      (payload) => {
        const rec = payload.new as Record<string, unknown>;
        onEvent({
          type: "job_updated",
          jobId: rec.id as string,
          status: rec.status as string,
          sceneId: rec.scene_id as string,
        });
      },
    )
    .subscribe();
  channels.push(jobsChannel);

  // Subscribe to capture session changes
  const capturesChannel = supabase
    .channel(`dashboard-captures-${orgId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "capture_sessions",
      },
      (payload) => {
        const rec = payload.new as Record<string, unknown>;
        onEvent({
          type: "capture_updated",
          sessionId: rec.id as string,
          status: rec.status as string,
          propertyId: rec.property_id as string,
        });
      },
    )
    .subscribe();
  channels.push(capturesChannel);

  // Return cleanup function
  return () => {
    channels.forEach((ch) => supabase.removeChannel(ch));
  };
}
