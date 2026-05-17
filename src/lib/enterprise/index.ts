// ============================================
// Enterprise Mode System
// ============================================
// Enterprise-grade features including SLA management,
// bulk operations, team permissions, and priority processing.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { EnterpriseSettings, AuditLog } from "@/lib/types";
import { logger } from "@/lib/logger";

// Supabase row type for enterprise_settings
type EnterpriseSettingsRow = EnterpriseSettings;

// ============================================
// EnterpriseManager
// ============================================

/**
 * Manages enterprise features for organizations.
 *
 * Provides SLA compliance checking, bulk operations,
 * team-level permissions, and priority queue management.
 */
export class EnterpriseManager {
  /**
   * Get enterprise settings for an organization.
   *
   * @param orgId - The organization ID
   * @returns EnterpriseSettings or null if not found/error
   */
  async getSettings(orgId: string): Promise<EnterpriseSettings | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      const { data, error } = await supabase
        .from("enterprise_settings")
        .select("*")
        .eq("org_id", orgId)
        .single();

      if (error || !data) return null;

      return data as EnterpriseSettingsRow;
    } catch (err) {
      console.error("[EnterpriseManager] Error getting settings:", err);
      return null;
    }
  }

  /**
   * Create or update enterprise settings for an organization.
   *
   * If settings already exist, they will be updated.
   * Otherwise, a new record will be created.
   *
   * @param orgId - The organization ID
   * @param settings - Partial settings to upsert
   * @returns The updated EnterpriseSettings or null on error
   */
  async upsertSettings(
    orgId: string,
    settings: Partial<EnterpriseSettings>,
  ): Promise<EnterpriseSettings | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      // Check if settings already exist
      const { data: existing } = await supabase
        .from("enterprise_settings")
        .select("id")
        .eq("org_id", orgId)
        .single();

      // Prepare upsert data
      const upsertData: Record<string, unknown> = {
        org_id: orgId,
        ...settings,
        updated_at: new Date().toISOString(),
      };

      if (!existing) {
        // Create new settings with defaults
        upsertData.created_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from("enterprise_settings")
        .upsert(upsertData, { onConflict: "org_id" })
        .select("*")
        .single();

      if (error || !data) {
        console.error("[EnterpriseManager] Error upserting settings:", error);
        return null;
      }

      return data as EnterpriseSettingsRow;
    } catch (err) {
      console.error("[EnterpriseManager] Error upserting settings:", err);
      return null;
    }
  }

  /**
   * Check if an organization has a specific enterprise feature enabled.
   *
   * @param orgId - The organization ID
   * @param feature - The feature flag to check
   * @returns True if the feature is enabled
   */
  async hasFeature(
    orgId: string,
    feature: keyof Pick<
      EnterpriseSettings,
      | "bulk_upload_enabled"
      | "team_permissions_enabled"
      | "audit_logs_enabled"
      | "custom_branding_enabled"
      | "api_access_enabled"
    >,
  ): Promise<boolean> {
    try {
      const settings = await this.getSettings(orgId);
      if (!settings) return false;

      return settings[feature] === true;
    } catch (err) {
      console.error("[EnterpriseManager] Error checking feature:", err);
      return false;
    }
  }

  /**
   * Get the priority level for an organization (0-10).
   *
   * Higher priority organizations get preferential treatment in the
   * processing queue. Free tier defaults to 0, enterprise to 5+.
   *
   * @param orgId - The organization ID
   * @returns Priority level (0-10), defaults to 0
   */
  async getPriorityLevel(orgId: string): Promise<number> {
    try {
      const settings = await this.getSettings(orgId);
      if (!settings) return 0;

      return settings.priority_level ?? 0;
    } catch (err) {
      console.error("[EnterpriseManager] Error getting priority level:", err);
      return 0;
    }
  }

  /**
   * Check SLA compliance for a scene.
   *
   * Compares the actual processing time against the organization's
   * SLA processing time guarantee.
   *
   * @param sceneId - The scene ID to check
   * @returns SLA compliance status with breach details
   */
  async checkSLACompliance(sceneId: string): Promise<{
    compliant: boolean;
    processingTimeMinutes: number;
    slaLimitMinutes: number;
    breachMinutes: number;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return {
          compliant: true,
          processingTimeMinutes: 0,
          slaLimitMinutes: 60,
          breachMinutes: 0,
        };
      }

      // Get the scene with its org
      const { data: scene, error: sceneError } = await supabase
        .from("scenes")
        .select("id, processing_time_seconds, property_id, created_at, completed_at")
        .eq("id", sceneId)
        .single();

      if (sceneError || !scene) {
        return {
          compliant: true,
          processingTimeMinutes: 0,
          slaLimitMinutes: 60,
          breachMinutes: 0,
        };
      }

      // Get the property's org
      const { data: property } = await supabase
        .from("properties")
        .select("org_id")
        .eq("id", scene.property_id)
        .single();

      const orgId = property?.org_id;

      // Get SLA limit — default 60 minutes
      let slaLimitMinutes = 60;
      if (orgId) {
        const settings = await this.getSettings(orgId);
        if (settings) {
          slaLimitMinutes = settings.sla_processing_time_minutes;
        }
      }

      // Calculate processing time
      const processingTimeSeconds = scene.processing_time_seconds || 0;
      const processingTimeMinutes = processingTimeSeconds / 60;

      const breachMinutes = Math.max(0, processingTimeMinutes - slaLimitMinutes);
      const compliant = processingTimeMinutes <= slaLimitMinutes;

      return {
        compliant,
        processingTimeMinutes,
        slaLimitMinutes,
        breachMinutes,
      };
    } catch (err) {
      console.error("[EnterpriseManager] Error checking SLA compliance:", err);
      return {
        compliant: true,
        processingTimeMinutes: 0,
        slaLimitMinutes: 60,
        breachMinutes: 0,
      };
    }
  }

  /**
   * Create a bulk operation for batch processing.
   *
   * @param params - Bulk operation parameters
   * @returns The batch operation ID or null on error
   */
  async createBulkOperation(params: {
    orgId: string;
    userId: string;
    operationType:
      | "bulk_property_upload"
      | "bulk_scene_processing"
      | "bulk_enhancement"
      | "bulk_export";
    items: Array<{ property_id: string }>;
    metadata?: Record<string, unknown>;
  }): Promise<string | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      // Check if bulk operations are enabled
      const hasBulk = await this.hasFeature(params.orgId, "bulk_upload_enabled");
      if (!hasBulk) {
        console.warn(
          `[EnterpriseManager] Bulk operations not enabled for org ${params.orgId}`,
        );
        return null;
      }

      // Check max bulk properties limit
      const settings = await this.getSettings(params.orgId);
      const maxBulk = settings?.max_bulk_properties ?? 50;
      if (params.items.length > maxBulk) {
        console.warn(
          `[EnterpriseManager] Bulk operation exceeds max limit (${params.items.length} > ${maxBulk})`,
        );
        return null;
      }

      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from("batch_operations")
        .insert({
          org_id: params.orgId,
          user_id: params.userId,
          operation_type: params.operationType,
          status: "pending",
          total_items: params.items.length,
          completed_items: 0,
          failed_items: 0,
          items: params.items.map((item) => ({
            property_id: item.property_id,
            status: "pending",
          })),
          metadata: params.metadata || {},
          created_at: now,
        })
        .select("id")
        .single();

      if (error || !data) {
        console.error("[EnterpriseManager] Error creating bulk operation:", error);
        return null;
      }

      logger.info(
        "Enterprise",
        `Created bulk operation ${data.id} (${params.operationType}, ${params.items.length} items)`,
      );
      return data.id;
    } catch (err) {
      console.error("[EnterpriseManager] Error creating bulk operation:", err);
      return null;
    }
  }

  /**
   * Get the status of a bulk operation.
   *
   * @param operationId - The batch operation ID
   * @returns Operation status with progress details or null
   */
  async getBulkOperationStatus(operationId: string): Promise<{
    status: string;
    totalItems: number;
    completedItems: number;
    failedItems: number;
    progress: number;
  } | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      const { data, error } = await supabase
        .from("batch_operations")
        .select("status, total_items, completed_items, failed_items")
        .eq("id", operationId)
        .single();

      if (error || !data) return null;

      const total = data.total_items || 0;
      const completed = data.completed_items || 0;
      const failed = data.failed_items || 0;

      return {
        status: data.status,
        totalItems: total,
        completedItems: completed,
        failedItems: failed,
        progress: total > 0 ? Math.round(((completed + failed) / total) * 100) : 0,
      };
    } catch (err) {
      console.error("[EnterpriseManager] Error getting bulk operation status:", err);
      return null;
    }
  }

  /**
   * Update a single item within a bulk operation.
   *
   * @param operationId - The batch operation ID
   * @param propertyId - The property ID of the item to update
   * @param status - New status for the item
   * @param error - Optional error message if the item failed
   */
  async updateBulkOperationItem(
    operationId: string,
    propertyId: string,
    status: "completed" | "failed",
    error?: string,
  ): Promise<void> {
    try {
      const supabase = await createClient();
      if (!supabase) return;

      // Fetch current operation
      const { data: operation, error: fetchError } = await supabase
        .from("batch_operations")
        .select("items, completed_items, failed_items, total_items")
        .eq("id", operationId)
        .single();

      if (fetchError || !operation) {
        console.error("[EnterpriseManager] Bulk operation not found:", operationId);
        return;
      }

      // Update items array
      const items = (operation.items as Array<{ property_id: string; status: string; error?: string }>) || [];
      const updatedItems = items.map((item) =>
        item.property_id === propertyId
          ? { ...item, status, ...(error ? { error } : {}) }
          : item,
      );

      // Update counters
      const completedItems = status === "completed" ? (operation.completed_items || 0) + 1 : operation.completed_items || 0;
      const failedItems = status === "failed" ? (operation.failed_items || 0) + 1 : operation.failed_items || 0;

      // Determine overall status
      const totalProcessed = completedItems + failedItems;
      const allDone = totalProcessed >= (operation.total_items || 0);
      const hasFailures = failedItems > 0;
      let overallStatus: string;
      if (allDone) {
        overallStatus = hasFailures ? "partial" : "completed";
      } else {
        overallStatus = "in_progress";
      }

      const updateData: Record<string, unknown> = {
        items: updatedItems,
        completed_items: completedItems,
        failed_items: failedItems,
        status: overallStatus,
      };

      if (allDone) {
        updateData.completed_at = new Date().toISOString();
      }

      await supabase
        .from("batch_operations")
        .update(updateData)
        .eq("id", operationId);
    } catch (err) {
      console.error("[EnterpriseManager] Error updating bulk operation item:", err);
    }
  }

  /**
   * Check team-level permissions for a user.
   *
   * Validates that a user has a specific permission within their org.
   * Permissions are derived from the user's role and enterprise settings.
   *
   * @param userId - The user ID
   * @param orgId - The organization ID
   * @param permission - The permission to check (e.g., 'property.create', 'scene.delete')
   * @returns True if the user has the permission
   */
  async checkTeamPermission(
    userId: string,
    orgId: string,
    permission: string,
  ): Promise<boolean> {
    try {
      const supabase = await createClient();
      if (!supabase) return false;

      // Check if team permissions are enabled
      const teamPermsEnabled = await this.hasFeature(orgId, "team_permissions_enabled");

      if (!teamPermsEnabled) {
        // Without team permissions, any org member has full access
        const { data: membership } = await supabase
          .from("organization_members")
          .select("id")
          .eq("org_id", orgId)
          .eq("user_id", userId)
          .single();

        return !!membership;
      }

      // With team permissions, check role-based access
      const { data: membership } = await supabase
        .from("organization_members")
        .select("role")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .single();

      if (!membership) return false;

      const role = membership.role;

      // Define permission matrix
      const permissionMatrix: Record<string, string[]> = {
        owner: ["*"], // owners have all permissions
        agent: [
          "property.create",
          "property.read",
          "property.update",
          "scene.read",
          "scene.generate",
          "capture.start",
          "capture.complete",
          "media.upload",
          "share.create",
          "feedback.submit",
        ],
        viewer: [
          "property.read",
          "scene.read",
          "share.read",
          "feedback.submit",
        ],
      };

      const allowedPermissions = permissionMatrix[role] || [];

      if (allowedPermissions.includes("*")) return true;

      return allowedPermissions.includes(permission);
    } catch (err) {
      console.error("[EnterpriseManager] Error checking team permission:", err);
      return false;
    }
  }
}

// ============================================
// Singleton
// ============================================

let enterpriseManagerInstance: EnterpriseManager | null = null;

/**
 * Get the global EnterpriseManager singleton.
 *
 * @returns The EnterpriseManager instance
 */
export function getEnterpriseManager(): EnterpriseManager {
  if (!enterpriseManagerInstance) {
    enterpriseManagerInstance = new EnterpriseManager();
  }
  return enterpriseManagerInstance;
}
