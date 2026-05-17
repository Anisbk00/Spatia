"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  CreditCard,
  Box,
  XCircle,
  Users,
  Eye,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ============================================
// Notification types
// ============================================

type NotificationType =
  | "processing_completed"
  | "capture_failed"
  | "billing_alert"
  | "scene_ready"
  | "scene_failed"
  | "team_invite"
  | "property_viewed";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  propertyId?: string;
  sceneId?: string;
}

// ============================================
// Icon mapping per notification type
// ============================================

const notificationIconMap: Record<NotificationType, React.ElementType> = {
  processing_completed: CheckCircle2,
  capture_failed: AlertTriangle,
  billing_alert: CreditCard,
  scene_ready: Box,
  scene_failed: XCircle,
  team_invite: Users,
  property_viewed: Eye,
};

const notificationColorMap: Record<NotificationType, string> = {
  processing_completed: "text-emerald-500",
  capture_failed: "text-amber-500",
  billing_alert: "text-amber-500",
  scene_ready: "text-emerald-500",
  scene_failed: "text-red-500",
  team_invite: "text-primary",
  property_viewed: "text-muted-foreground",
};

// ============================================
// Event type → notification mapping
// ============================================

const eventTypeToNotification: Record<string, { type: NotificationType; title: string; description: string }> = {
  SCENE_GENERATED: {
    type: "scene_ready",
    title: "3D Scene Ready",
    description: "Your scene has been generated and is ready to view.",
  },
  SCENE_FAILED: {
    type: "scene_failed",
    title: "Scene Generation Failed",
    description: "The 3D scene generation encountered an error.",
  },
  CAPTURE_COMPLETED: {
    type: "processing_completed",
    title: "Capture Completed",
    description: "Your capture session has been processed successfully.",
  },
  UPLOAD_FAILED: {
    type: "capture_failed",
    title: "Upload Failed",
    description: "An image upload failed during your capture session.",
  },
  PROCESSING_STARTED: {
    type: "processing_completed",
    title: "Processing Started",
    description: "Your capture is being processed into a 3D scene.",
  },
  PROPERTY_VIEWED: {
    type: "property_viewed",
    title: "Property Viewed",
    description: "Someone viewed your property listing.",
  },
};

// ============================================
// Relative time helper
// ============================================

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ============================================
// NotificationCenter component
// ============================================

interface NotificationCenterProps {
  orgId?: string | null;
}

export function NotificationCenter({ orgId }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Add a notification from a realtime event
  const addNotification = useCallback(
    (event: { event_type: string; id?: string; created_at?: string; property_id?: string; scene_id?: string; metadata?: Record<string, unknown> | null }) => {
      const mapping = eventTypeToNotification[event.event_type];
      if (!mapping) return;

      const notification: Notification = {
        id: event.id ?? crypto.randomUUID(),
        type: mapping.type,
        title: mapping.title,
        description: mapping.description,
        timestamp: event.created_at ?? new Date().toISOString(),
        read: false,
        propertyId: event.property_id ?? undefined,
        sceneId: event.scene_id ?? undefined,
      };

      setNotifications((prev) => {
        // Avoid duplicates by id
        if (prev.some((n) => n.id === notification.id)) return prev;
        return [notification, ...prev].slice(0, 50); // keep max 50
      });
    },
    []
  );

  // Subscribe to Supabase realtime on events table
  useEffect(() => {
    if (!orgId) return;

    const supabase = createClient();
    if (!supabase) return;

    const channel = supabase
      .channel("notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          const newEvent = payload.new as {
            id: string;
            event_type: string;
            created_at: string;
            property_id?: string;
            scene_id?: string;
            metadata?: Record<string, unknown> | null;
          };
          addNotification(newEvent);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, addNotification]);

  // Mark a single notification as read
  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h4 className="text-sm font-semibold">Notifications</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={markAllAsRead}
            >
              Mark all as read
            </Button>
          )}
        </div>
        <Separator />

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <Bell className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No notifications yet</p>
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-96">
              <div className="flex flex-col">
                {notifications.map((notification) => {
                  const Icon = notificationIconMap[notification.type];
                  const iconColor = notificationColorMap[notification.type];

                  return (
                    <button
                      key={notification.id}
                      type="button"
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 w-full",
                        !notification.read && "bg-accent/30"
                      )}
                      onClick={() => markAsRead(notification.id)}
                    >
                      <Icon className={cn("mt-0.5 size-4 shrink-0", iconColor)} />
                      <div className="flex-1 space-y-0.5">
                        <p
                          className={cn(
                            "text-sm leading-tight",
                            !notification.read ? "font-semibold" : "font-medium text-muted-foreground"
                          )}
                        >
                          {notification.title}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {notification.description}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70">
                          {formatRelativeTime(notification.timestamp)}
                        </p>
                      </div>
                      {!notification.read && (
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>

            {unreadCount > 0 && (
              <>
                <Separator />
                <div className="p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs"
                    onClick={markAllAsRead}
                  >
                    Mark all as read
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
