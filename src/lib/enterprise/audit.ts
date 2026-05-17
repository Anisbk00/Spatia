// ============================================
// Audit Logging System
// ============================================
// Enterprise-grade audit logging for compliance and traceability.
// Tracks all significant actions within organizations.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { AuditLog } from "@/lib/types";

// Supabase row type for audit_logs
type AuditLogRow = AuditLog;

// ============================================
// Log an audit event
// ============================================

/**
 * Log an audit event for compliance tracking.
 *
 * Creates an immutable record of a significant action within an organization.
 * Used for security auditing, compliance reporting, and incident investigation.
 *
 * @param params - Audit event parameters
 * @returns The audit log entry ID or null on error
 */
export async function logAuditEvent(params: {
  orgId: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<string | null> {
  try {
    const supabase = await createClient();
    if (!supabase) return null;

    // Check if audit logging is enabled for this org
    const { data: settings } = await supabase
      .from("enterprise_settings")
      .select("audit_logs_enabled")
      .eq("org_id", params.orgId)
      .single();

    // If settings exist and audit is explicitly disabled, skip logging
    if (settings && !settings.audit_logs_enabled) {
      return null;
    }

    const insertData: Record<string, unknown> = {
      org_id: params.orgId,
      user_id: params.userId || null,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId || null,
      details: params.details || {},
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
    };

    const { data, error } = await supabase
      .from("audit_logs")
      .insert(insertData)
      .select("id")
      .single();

    if (error || !data) {
      console.error("[AuditLog] Error logging audit event:", error);
      return null;
    }

    return data.id;
  } catch (err) {
    console.error("[AuditLog] Error logging audit event:", err);
    return null;
  }
}

// ============================================
// Get audit logs for an org
// ============================================

/**
 * Get audit logs for an organization with optional filtering.
 *
 * Supports filtering by action type, resource type, and user.
 * Results are ordered by creation time (most recent first).
 *
 * @param params - Filter parameters
 * @returns Array of AuditLog entries, empty on error
 */
export async function getAuditLogs(params: {
  orgId: string;
  action?: string;
  resourceType?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditLog[]> {
  try {
    const supabase = await createClient();
    if (!supabase) return [];

    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    let query = supabase
      .from("audit_logs")
      .select("*")
      .eq("org_id", params.orgId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.action) {
      query = query.eq("action", params.action);
    }

    if (params.resourceType) {
      query = query.eq("resource_type", params.resourceType);
    }

    if (params.userId) {
      query = query.eq("user_id", params.userId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[AuditLog] Error getting audit logs:", error);
      return [];
    }

    return (data || []) as AuditLogRow[];
  } catch (err) {
    console.error("[AuditLog] Error getting audit logs:", err);
    return [];
  }
}

// ============================================
// Get audit log statistics
// ============================================

/**
 * Get audit log statistics for an organization.
 *
 * Provides aggregate counts by action type, resource type,
 * and recent activity (last 24 hours).
 *
 * @param orgId - The organization ID
 * @returns Statistics about audit events
 */
export async function getAuditLogStats(orgId: string): Promise<{
  totalEvents: number;
  byAction: Record<string, number>;
  byResourceType: Record<string, number>;
  recentActivity: number;
}> {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return {
        totalEvents: 0,
        byAction: {},
        byResourceType: {},
        recentActivity: 0,
      };
    }

    // Get total count
    const { count: totalEvents, error: countError } = await supabase
      .from("audit_logs")
      .select("*", { count: "exact", head: true })
      .eq("org_id", orgId);

    if (countError) {
      console.error("[AuditLog] Error counting audit logs:", countError);
    }

    // Get all logs for aggregation (limited for performance)
    const { data: logs, error: logsError } = await supabase
      .from("audit_logs")
      .select("action, resource_type, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(10000);

    if (logsError || !logs) {
      console.error("[AuditLog] Error fetching audit logs for stats:", logsError);
      return {
        totalEvents: totalEvents || 0,
        byAction: {},
        byResourceType: {},
        recentActivity: 0,
      };
    }

    // Aggregate by action
    const byAction: Record<string, number> = {};
    const byResourceType: Record<string, number> = {};
    let recentActivity = 0;

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    for (const log of logs) {
      // Count by action
      const action = log.action as string;
      byAction[action] = (byAction[action] || 0) + 1;

      // Count by resource type
      const resourceType = log.resource_type as string;
      byResourceType[resourceType] = (byResourceType[resourceType] || 0) + 1;

      // Count recent activity (last 24h)
      if (log.created_at && log.created_at >= twentyFourHoursAgo) {
        recentActivity++;
      }
    }

    return {
      totalEvents: totalEvents || logs.length,
      byAction,
      byResourceType,
      recentActivity,
    };
  } catch (err) {
    console.error("[AuditLog] Error getting audit log stats:", err);
    return {
      totalEvents: 0,
      byAction: {},
      byResourceType: {},
      recentActivity: 0,
    };
  }
}
