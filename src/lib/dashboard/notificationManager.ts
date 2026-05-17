"use client";

import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type NotificationType =
  | "processing_completed"
  | "capture_failed"
  | "billing_alert"
  | "scene_ready"
  | "scene_failed"
  | "team_invite"
  | "property_viewed";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  propertyId?: string;
  sceneId?: string;
}

const NOTIFICATION_KEY = "spatia_notifications";
const MAX_NOTIFICATIONS = 50;

// Map event types to notification types
const EVENT_NOTIFICATION_MAP: Record<string, NotificationType> = {
  SCENE_GENERATED: "scene_ready",
  SCENE_FAILED: "scene_failed",
  CAPTURE_COMPLETED: "processing_completed",
  CAPTURE_FAILED: "capture_failed",
  PROPERTY_VIEWED: "property_viewed",
};

/**
 * Get stored notifications from localStorage.
 */
export function getStoredNotifications(): AppNotification[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored = localStorage.getItem(NOTIFICATION_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Save notifications to localStorage.
 */
export function saveNotifications(notifications: AppNotification[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      NOTIFICATION_KEY,
      JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)),
    );
  } catch {
    // localStorage full — ignore
  }
}

/**
 * Add a notification.
 */
export function addNotification(
  notification: Omit<AppNotification, "id" | "read">,
): AppNotification {
  const newNotif: AppNotification = {
    ...notification,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    read: false,
  };
  const existing = getStoredNotifications();
  const updated = [newNotif, ...existing].slice(0, MAX_NOTIFICATIONS);
  saveNotifications(updated);
  return newNotif;
}

/**
 * Mark a notification as read.
 */
export function markNotificationRead(id: string): void {
  const notifications = getStoredNotifications();
  const updated = notifications.map((n) =>
    n.id === id ? { ...n, read: true } : n,
  );
  saveNotifications(updated);
}

/**
 * Mark all notifications as read.
 */
export function markAllNotificationsRead(): void {
  const notifications = getStoredNotifications();
  const updated = notifications.map((n) => ({ ...n, read: true }));
  saveNotifications(updated);
}

/**
 * Get unread count.
 */
export function getUnreadCount(): number {
  return getStoredNotifications().filter((n) => !n.read).length;
}

/**
 * Subscribe to realtime events and auto-generate notifications.
 * Returns cleanup function.
 */
export function subscribeToNotificationEvents(
  orgId: string,
  onNewNotification: (notification: AppNotification) => void,
): () => void {
  const supabase = createClient();
  if (!supabase) return () => {};

  const channel: RealtimeChannel = supabase
    .channel(`notifications-${orgId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "events",
        filter: `org_id=eq.${orgId}`,
      },
      (payload) => {
        const rec = payload.new as Record<string, unknown>;
        const eventType = rec.event_type as string;
        const notifType = EVENT_NOTIFICATION_MAP[eventType];
        if (!notifType) return;

        const title = getNotificationTitle(notifType);
        const description = getNotificationDescription(
          notifType,
          (rec.metadata as Record<string, unknown>) ?? {},
        );

        const notif = addNotification({
          type: notifType,
          title,
          description,
          timestamp: (rec.created_at as string) || new Date().toISOString(),
          propertyId: (rec.property_id as string) ?? undefined,
          sceneId: (rec.scene_id as string) ?? undefined,
        });

        onNewNotification(notif);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

function getNotificationTitle(type: NotificationType): string {
  switch (type) {
    case "scene_ready":
      return "3D Scene Ready";
    case "scene_failed":
      return "Scene Processing Failed";
    case "processing_completed":
      return "Processing Complete";
    case "capture_failed":
      return "Capture Failed";
    case "billing_alert":
      return "Billing Alert";
    case "team_invite":
      return "Team Invitation";
    case "property_viewed":
      return "Property Viewed";
  }
}

function getNotificationDescription(
  type: NotificationType,
  _metadata: Record<string, unknown>,
): string {
  switch (type) {
    case "scene_ready":
      return "Your 3D scene is ready to view";
    case "scene_failed":
      return "Scene generation encountered an error";
    case "processing_completed":
      return "Image processing completed successfully";
    case "capture_failed":
      return "A capture session has failed";
    case "billing_alert":
      return "Review your billing details";
    case "team_invite":
      return "You've been invited to join a team";
    case "property_viewed":
      return "Someone viewed your property";
  }
}
