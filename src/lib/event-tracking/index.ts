// ============================================
// Unified Event Tracking System
// ============================================
// Client-side event tracker with:
// - Automatic buffering (5s interval or 20 event threshold)
// - Offline support (localStorage queue + flush on reconnect)
// - Auto-capture of device_type, user_agent, timestamp
// - Singleton pattern for easy global access
// ============================================

import type { EventType } from "@/lib/types";

// ============================================
// Event Type Constants
// ============================================

export const EVENT_TYPES = {
  // Core product events
  PROPERTY_CREATED: "PROPERTY_CREATED",
  CAPTURE_STARTED: "CAPTURE_STARTED",
  IMAGE_UPLOADED: "IMAGE_UPLOADED",
  CAPTURE_COMPLETED: "CAPTURE_COMPLETED",
  PROCESSING_STARTED: "PROCESSING_STARTED",
  SCENE_GENERATED: "SCENE_GENERATED",
  SCENE_FAILED: "SCENE_FAILED",
  VIEWER_OPENED: "VIEWER_OPENED",
  PROPERTY_SHARED: "PROPERTY_SHARED",
  PROPERTY_VIEWED: "PROPERTY_VIEWED",
  // Upload resilience events
  UPLOAD_FAILED: "UPLOAD_FAILED",
  UPLOAD_RETRIED: "UPLOAD_RETRIED",
  OFFLINE_CAPTURE: "OFFLINE_CAPTURE",
  SYNC_COMPLETED: "SYNC_COMPLETED",
  SYNC_FAILED: "SYNC_FAILED",
  // Onboarding & activation events
  ONBOARDING_STARTED: "ONBOARDING_STARTED",
  ONBOARDING_STEP_COMPLETED: "ONBOARDING_STEP_COMPLETED",
  ONBOARDING_COMPLETED: "ONBOARDING_COMPLETED",
  FIRST_PROPERTY_CREATED: "FIRST_PROPERTY_CREATED",
  FIRST_CAPTURE_STARTED: "FIRST_CAPTURE_STARTED",
  FIRST_SCENE_GENERATED: "FIRST_SCENE_GENERATED",
  FIRST_VIEW_SHARED: "FIRST_VIEW_SHARED",
  // Growth & referral events
  REFERRAL_LINK_GENERATED: "REFERRAL_LINK_GENERATED",
  REFERRAL_SIGNUP: "REFERRAL_SIGNUP",
  FEEDBACK_SUBMITTED: "FEEDBACK_SUBMITTED",
  NPS_SCORE_SUBMITTED: "NPS_SCORE_SUBMITTED",
  SHARE_LINK_COPIED: "SHARE_LINK_COPIED",
  SHARE_QR_GENERATED: "SHARE_QR_GENERATED",
} as const;

export type EventTypeDef = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// ============================================
// Buffered Event type (internal)
// ============================================

interface BufferedEvent {
  event_type: string;
  metadata: Record<string, unknown>;
  session_id?: string;
  property_id?: string;
  scene_id?: string;
  device_type?: string;
  user_agent?: string;
  timestamp: string;
}

// ============================================
// Configuration
// ============================================

const FLUSH_INTERVAL_MS = 5_000; // 5 seconds
const MAX_BUFFER_SIZE = 20;
const LOCALSTORAGE_KEY = "pending_events";
const MAX_LOCALSTORAGE_EVENTS = 200;

// ============================================
// EventTracker (Singleton)
// ============================================

/**
 * Unified event tracking system.
 *
 * Client-side tracker that:
 * - Buffers events and flushes periodically or when buffer is full
 * - Captures device_type and user_agent automatically
 * - Supports offline mode via localStorage persistence
 * - Reconnects and flushes when back online
 *
 * Usage:
 * ```ts
 * const tracker = EventTracker.getInstance();
 * tracker.setContext(userId, orgId, deviceId);
 * tracker.track('PROPERTY_CREATED', { property_id: '...' });
 * ```
 */
export class EventTracker {
  private static instance: EventTracker | null = null;

  private buffer: BufferedEvent[] = [];
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  // Tracking context
  private userId: string | null = null;
  private orgId: string | null = null;
  private deviceId: string | null = null;

  // Auto-captured context
  private userAgent: string;
  private deviceType: string;

  private constructor() {
    // Auto-capture user agent (truncated to 256 chars for storage)
    this.userAgent =
      typeof navigator !== "undefined"
        ? navigator.userAgent.substring(0, 256)
        : "";

    // Auto-detect device type
    this.deviceType = this.detectDeviceType();

    // Restore offline events from localStorage
    this.restoreOfflineEvents();

    // Start periodic flush
    this.startFlushInterval();

    // Listen for online/offline events
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline.bind(this));
      window.addEventListener("beforeunload", this.handleBeforeUnload.bind(this));
    }
  }

  /**
   * Get the singleton EventTracker instance.
   */
  static getInstance(): EventTracker {
    if (!EventTracker.instance) {
      EventTracker.instance = new EventTracker();
    }
    return EventTracker.instance;
  }

  /**
   * Reset the singleton (useful for testing or user logout).
   */
  static resetInstance(): void {
    if (EventTracker.instance) {
      EventTracker.instance.destroy();
      EventTracker.instance = null;
    }
  }

  /**
   * Set the tracking context for all future events.
   *
   * @param userId - Current user ID
   * @param orgId - Current organization ID
   * @param deviceId - Device identifier (optional)
   */
  setContext(userId: string, orgId: string, deviceId?: string): void {
    this.userId = userId;
    this.orgId = orgId;
    this.deviceId = deviceId || null;
  }

  /**
   * Track an event client-side.
   *
   * The event is buffered and will be flushed:
   * - After 5 seconds
   * - When the buffer reaches 20 events
   * - When explicitly calling flush()
   *
   * @param eventType - The event type (use EVENT_TYPES constants)
   * @param metadata - Additional event metadata
   * @param sessionId - Optional session ID
   * @param propertyId - Optional property ID
   * @param sceneId - Optional scene ID
   */
  track(
    eventType: EventTypeDef | string,
    metadata: Record<string, unknown> = {},
    sessionId?: string,
    propertyId?: string,
    sceneId?: string,
  ): void {
    const event: BufferedEvent = {
      event_type: eventType,
      metadata,
      session_id: sessionId,
      property_id: propertyId,
      scene_id: sceneId,
      device_type: this.deviceType,
      user_agent: this.userAgent,
      timestamp: new Date().toISOString(),
    };

    this.buffer.push(event);

    // Check if we need to flush immediately
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush();
    }
  }

  /**
   * Flush all buffered events to the server.
   *
   * If the request fails (e.g., offline), events are persisted
   * to localStorage for later retry.
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) return;

    this.isFlushing = true;

    const eventsToSend = [...this.buffer];
    this.buffer = [];

    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: eventsToSend.map((e) => ({
            event_type: e.event_type,
            metadata: e.metadata,
            session_id: e.session_id,
            property_id: e.property_id,
            scene_id: e.scene_id,
            device_type: e.device_type,
            user_agent: e.user_agent,
            timestamp: e.timestamp,
          })),
        }),
      });

      if (!response.ok) {
        // 400 = bad request (invalid events) — don't retry, discard them
        // Only retry on server errors (5xx) or network failures
        if (response.status >= 500 || response.status === 429) {
          // Re-add events to buffer for retry
          this.buffer = [...eventsToSend, ...this.buffer];
          // Persist to localStorage for offline recovery
          this.persistOfflineEvents(this.buffer);
        } else {
          // 4xx errors (except 429) = client error, events are invalid, discard
          console.warn("[EventTracker] Events rejected by server (status " + response.status + "), discarding", eventsToSend.map(e => e.event_type));
          // Clear any persisted events that match these
          this.persistOfflineEvents(this.buffer);
        }
      } else {
        // Success — clear any persisted offline events since they were just sent
        this.persistOfflineEvents(this.buffer);
      }
    } catch (err) {
      console.error("[EventTracker] Flush failed:", err);
      // Network error — re-add events and persist
      this.buffer = [...eventsToSend, ...this.buffer];
      this.persistOfflineEvents(this.buffer);
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Destroy the tracker and clean up resources.
   */
  destroy(): void {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline.bind(this));
      window.removeEventListener("beforeunload", this.handleBeforeUnload.bind(this));
    }

    // Final flush attempt
    this.flush();
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Detect device type from user agent.
   */
  private detectDeviceType(): string {
    if (typeof navigator === "undefined") return "unknown";

    const ua = navigator.userAgent.toLowerCase();

    if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/.test(ua)) {
      return "mobile";
    }
    if (/ipad|tablet|android(?!.*mobile)/.test(ua)) {
      return "tablet";
    }
    return "desktop";
  }

  /**
   * Start the periodic flush interval.
   */
  private startFlushInterval(): void {
    if (this.flushIntervalId) return;

    this.flushIntervalId = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Handle browser coming back online — flush queued events.
   */
  private handleOnline(): void {
    // Restore any persisted events
    this.restoreOfflineEvents();
    // Flush everything
    this.flush();
  }

  /**
   * Handle page unload — persist events for later.
   */
  private handleBeforeUnload(): void {
    if (this.buffer.length > 0) {
      this.persistOfflineEvents(this.buffer);
    }
  }

  /**
   * Persist events to localStorage for offline recovery.
   */
  private persistOfflineEvents(events: BufferedEvent[]): void {
    if (typeof localStorage === "undefined") return;

    try {
      // Merge with any existing persisted events
      const existing = this.loadPersistedEvents();
      const merged = [...existing, ...events].slice(-MAX_LOCALSTORAGE_EVENTS);
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.error("[EventTracker] Failed to persist offline events:", err);
      // localStorage might be full or unavailable
      // Silently ignore — events will be lost
    }
  }

  /**
   * Load persisted events from localStorage.
   */
  private loadPersistedEvents(): BufferedEvent[] {
    if (typeof localStorage === "undefined") return [];

    try {
      const stored = localStorage.getItem(LOCALSTORAGE_KEY);
      if (!stored) return [];
      return JSON.parse(stored) as BufferedEvent[];
    } catch (err) {
      console.error("[EventTracker] Failed to load persisted events:", err);
      return [];
    }
  }

  /**
   * Restore offline events from localStorage into the buffer.
   */
  private restoreOfflineEvents(): void {
    const persisted = this.loadPersistedEvents();
    if (persisted.length > 0) {
      // Add persisted events to the front of the buffer
      this.buffer = [...persisted, ...this.buffer];
      // Clear localStorage
      try {
        localStorage.removeItem(LOCALSTORAGE_KEY);
      } catch (err) {
        console.error("[EventTracker] Failed to clear localStorage:", err);
      }
    }
  }
}

// ============================================
// Convenience: trackEvent() helper function
// ============================================

/**
 * Simple one-liner for tracking events.
 *
 * Works in both client and server contexts:
 * - Client: uses the EventTracker singleton (buffered)
 * - Server: should use trackServerEvent() from ./server.ts instead
 *
 * @example
 * ```ts
 * trackEvent('property_created', { property_id: 'abc-123' });
 * trackEvent('viewer_opened', { property_id: 'abc-123', scene_id: 'xyz' });
 * ```
 */
export function trackEvent(
  eventType: EventTypeDef | string,
  metadata: Record<string, unknown> = {},
  sessionId?: string,
  propertyId?: string,
  sceneId?: string,
): void {
  const tracker = EventTracker.getInstance();
  tracker.track(eventType, metadata, sessionId, propertyId, sceneId);
}
