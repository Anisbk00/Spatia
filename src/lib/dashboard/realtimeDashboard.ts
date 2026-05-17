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
        onEvent({
          type: "scene_updated",
          sceneId: payload.new.id,
          status: payload.new.status,
          propertyId: payload.new.property_id,
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
        onEvent({
          type: "job_updated",
          jobId: payload.new.id,
          status: payload.new.status,
          sceneId: payload.new.scene_id,
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
        onEvent({
          type: "capture_updated",
          sessionId: payload.new.id,
          status: payload.new.status,
          propertyId: payload.new.property_id,
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
