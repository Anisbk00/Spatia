// ============================================
// Cost Optimization Engine
// ============================================
// Tracks and optimizes costs for scene processing,
// GPU compute, storage, and AI enhancements.
// Gracefully handles missing Supabase configuration.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { CostRecord, CostSummary, CostType, ProcessingCostConfig } from "@/lib/types";
import { checkFreeTierLimits } from "./throttle";

// ============================================
// Default cost multipliers by plan tier
// ============================================

const PLAN_MULTIPLIERS: Record<string, Record<string, number>> = {
  free: {
    gpu_compute: 1.0,
    storage: 1.0,
    cdn_bandwidth: 1.0,
    ai_enhancement: 1.0,
    thumbnail_generation: 1.0,
    data_transfer: 1.0,
  },
  pro: {
    gpu_compute: 0.85,
    storage: 0.8,
    cdn_bandwidth: 0.9,
    ai_enhancement: 0.85,
    thumbnail_generation: 0.8,
    data_transfer: 0.9,
  },
  business: {
    gpu_compute: 0.65,
    storage: 0.6,
    cdn_bandwidth: 0.7,
    ai_enhancement: 0.65,
    thumbnail_generation: 0.6,
    data_transfer: 0.7,
  },
};

// Default unit costs (USD)
const DEFAULT_UNIT_COSTS: Record<CostType, { unitCost: number; unit: string }> = {
  gpu_compute: { unitCost: 2.5, unit: "hour" },
  storage: { unitCost: 0.023, unit: "gb" },
  cdn_bandwidth: { unitCost: 0.08, unit: "gb" },
  ai_enhancement: { unitCost: 0.5, unit: "scene" },
  thumbnail_generation: { unitCost: 0.05, unit: "thumbnail" },
  data_transfer: { unitCost: 0.09, unit: "gb" },
};

export class CostEngine {
  // ------------------------------------------
  // Record a cost entry for a scene processing
  // ------------------------------------------
  async recordSceneCost(params: {
    orgId: string;
    sceneId: string;
    jobId?: string;
    workerId?: string;
    costType: CostType;
    amountUsd: number;
    quantity: number;
    unit: string;
    metadata?: Record<string, unknown>;
  }): Promise<string | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      const now = new Date();
      const billingPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const billingPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

      const defaultCost = DEFAULT_UNIT_COSTS[params.costType];
      const unitCostUsd = defaultCost
        ? params.amountUsd / Math.max(params.quantity, 1)
        : null;

      const { data, error } = await supabase
        .from("cost_records")
        .insert({
          org_id: params.orgId,
          scene_id: params.sceneId,
          job_id: params.jobId ?? null,
          worker_id: params.workerId ?? null,
          cost_type: params.costType,
          amount_usd: params.amountUsd,
          quantity: params.quantity,
          unit: params.unit,
          unit_cost_usd: unitCostUsd,
          metadata: params.metadata ?? {},
          recorded_at: now.toISOString(),
          billing_period_start: billingPeriodStart,
          billing_period_end: billingPeriodEnd,
        })
        .select("id")
        .single();

      if (error) {
        console.error("[CostEngine] Failed to record cost:", error);
        return null;
      }

      return data?.id ?? null;
    } catch (err) {
      console.error("[CostEngine] recordSceneCost error:", err);
      return null;
    }
  }

  // ------------------------------------------
  // Get cost summary for an org
  // Uses get_org_cost_summary RPC if available,
  // otherwise falls back to client-side aggregation
  // ------------------------------------------
  async getOrgCostSummary(
    orgId: string,
    periodStart?: string,
    periodEnd?: string,
  ): Promise<CostSummary | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      const start = periodStart ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const end = periodEnd ?? new Date().toISOString();

      // Try RPC first
      const { data: rpcData, error: rpcError } = await supabase.rpc("get_org_cost_summary", {
        org_id_input: orgId,
        period_start: start,
        period_end: end,
      });

      if (!rpcError && rpcData) {
        return rpcData as CostSummary;
      }

      // Fallback: client-side aggregation
      const { data: records, error } = await supabase
        .from("cost_records")
        .select("cost_type, amount_usd, scene_id")
        .eq("org_id", orgId)
        .gte("recorded_at", start)
        .lte("recorded_at", end);

      if (error || !records) {
        console.error("[CostEngine] Failed to fetch cost records:", error);
        return null;
      }

      const totalCost = records.reduce((sum, r) => sum + Number(r.amount_usd), 0);
      const byType: Record<string, number> = {};
      const uniqueScenes = new Set<string>();

      for (const record of records) {
        const type = record.cost_type as string;
        byType[type] = (byType[type] ?? 0) + Number(record.amount_usd);
        if (record.scene_id) uniqueScenes.add(record.scene_id);
      }

      const scenesProcessed = uniqueScenes.size;
      const costPerScene = scenesProcessed > 0 ? totalCost / scenesProcessed : 0;

      return {
        total_cost: totalCost,
        by_type: byType,
        scenes_processed: scenesProcessed,
        cost_per_scene: costPerScene,
        period_start: start,
        period_end: end,
      };
    } catch (err) {
      console.error("[CostEngine] getOrgCostSummary error:", err);
      return null;
    }
  }

  // ------------------------------------------
  // Calculate cost per scene for an org
  // ------------------------------------------
  async getCostPerScene(orgId: string): Promise<number> {
    try {
      const summary = await this.getOrgCostSummary(orgId);
      if (!summary) return 0;
      return summary.cost_per_scene;
    } catch (err) {
      console.error("[CostEngine] getCostPerScene failed:", err);
      return 0;
    }
  }

  // ------------------------------------------
  // Calculate cost per user per month for an org
  // ------------------------------------------
  async getCostPerUser(orgId: string): Promise<{
    totalCost: number;
    userCount: number;
    costPerUser: number;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) return { totalCost: 0, userCount: 0, costPerUser: 0 };

      // Get member count
      const { count: userCount, error: memberError } = await supabase
        .from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);

      if (memberError) {
        console.error("[CostEngine] Failed to count users:", memberError);
        return { totalCost: 0, userCount: 0, costPerUser: 0 };
      }

      const summary = await this.getOrgCostSummary(orgId);
      const totalCost = summary?.total_cost ?? 0;
      const users = userCount ?? 1;
      const costPerUser = users > 0 ? totalCost / users : 0;

      return { totalCost, userCount: users, costPerUser };
    } catch (err) {
      console.error("[CostEngine] getCostPerUser error:", err);
      return { totalCost: 0, userCount: 0, costPerUser: 0 };
    }
  }

  // ------------------------------------------
  // Get GPU utilization metrics
  // ------------------------------------------
  async getGPUUtilization(): Promise<{
    avgUtilization: number;
    totalMemoryUsedGb: number;
    totalMemoryTotalGb: number;
    byRegion: Record<string, { utilization: number; memoryUsed: number }>;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return {
          avgUtilization: 0,
          totalMemoryUsedGb: 0,
          totalMemoryTotalGb: 0,
          byRegion: {},
        };
      }

      // Try to get GPU metrics from the gpu_metrics table
      const { data: metrics, error } = await supabase
        .from("gpu_metrics")
        .select("worker_id, gpu_utilization_percent, gpu_memory_used_gb, gpu_memory_total_gb")
        .order("recorded_at", { ascending: false })
        .limit(100);

      if (error || !metrics || metrics.length === 0) {
        // No GPU metrics data available yet
        return {
          avgUtilization: 0,
          totalMemoryUsedGb: 0,
          totalMemoryTotalGb: 0,
          byRegion: {},
        };
      }

      const totalUtil = metrics.reduce(
        (sum, m) => sum + (Number(m.gpu_utilization_percent) || 0),
        0,
      );
      const totalMemUsed = metrics.reduce(
        (sum, m) => sum + (Number(m.gpu_memory_used_gb) || 0),
        0,
      );
      const totalMemTotal = metrics.reduce(
        (sum, m) => sum + (Number(m.gpu_memory_total_gb) || 0),
        0,
      );

      // Group by region via workers table
      const byRegion: Record<string, { utilization: number; memoryUsed: number }> = {};

      const { data: workers } = await supabase
        .from("workers")
        .select("worker_id, region")
        .in("worker_id", metrics.map((m: { worker_id: string }) => m.worker_id));

      if (workers && workers.length > 0) {
        const regionMap = new Map(workers.map((w: { worker_id: string; region: string }) => [w.worker_id, w.region]));
        const regionBuckets: Record<string, { utilSum: number; memSum: number; count: number }> = {};

        for (const metric of metrics) {
          const region = regionMap.get(metric.worker_id) ?? "unknown";
          if (!regionBuckets[region]) {
            regionBuckets[region] = { utilSum: 0, memSum: 0, count: 0 };
          }
          regionBuckets[region].utilSum += Number(metric.gpu_utilization_percent) || 0;
          regionBuckets[region].memSum += Number(metric.gpu_memory_used_gb) || 0;
          regionBuckets[region].count += 1;
        }

        for (const [region, bucket] of Object.entries(regionBuckets)) {
          byRegion[region] = {
            utilization: bucket.count > 0 ? bucket.utilSum / bucket.count : 0,
            memoryUsed: bucket.memSum,
          };
        }
      }

      return {
        avgUtilization: metrics.length > 0 ? totalUtil / metrics.length : 0,
        totalMemoryUsedGb: totalMemUsed,
        totalMemoryTotalGb: totalMemTotal,
        byRegion,
      };
    } catch (err) {
      console.error("[CostEngine] getGPUUtilization error:", err);
      return {
        avgUtilization: 0,
        totalMemoryUsedGb: 0,
        totalMemoryTotalGb: 0,
        byRegion: {},
      };
    }
  }

  // ------------------------------------------
  // Get storage growth rate
  // ------------------------------------------
  async getStorageGrowth(): Promise<{
    currentMb: number;
    growthRateMbPerDay: number;
    projectedMbNext30Days: number;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return { currentMb: 0, growthRateMbPerDay: 0, projectedMbNext30Days: 0 };
      }

      // Get current storage usage from usage_metrics
      const { data: storageMetrics, error } = await supabase
        .from("usage_metrics")
        .select("value, created_at")
        .eq("metric_type", "storage_used_mb")
        .order("created_at", { ascending: false })
        .limit(30);

      if (error || !storageMetrics || storageMetrics.length === 0) {
        return { currentMb: 0, growthRateMbPerDay: 0, projectedMbNext30Days: 0 };
      }

      const currentMb = Number(storageMetrics[0].value) || 0;

      // Calculate growth rate from historical data
      let growthRateMbPerDay = 0;

      if (storageMetrics.length >= 2) {
        const newest = new Date(storageMetrics[0].created_at).getTime();
        const oldest = new Date(storageMetrics[storageMetrics.length - 1].created_at).getTime();
        const newestVal = Number(storageMetrics[0].value) || 0;
        const oldestVal = Number(storageMetrics[storageMetrics.length - 1].value) || 0;
        const daysDiff = (newest - oldest) / (1000 * 60 * 60 * 24);

        if (daysDiff > 0) {
          growthRateMbPerDay = (newestVal - oldestVal) / daysDiff;
        }
      }

      const projectedMbNext30Days = currentMb + growthRateMbPerDay * 30;

      return {
        currentMb,
        growthRateMbPerDay: Math.max(0, growthRateMbPerDay),
        projectedMbNext30Days: Math.max(0, projectedMbNext30Days),
      };
    } catch (err) {
      console.error("[CostEngine] getStorageGrowth error:", err);
      return { currentMb: 0, growthRateMbPerDay: 0, projectedMbNext30Days: 0 };
    }
  }

  // ------------------------------------------
  // Check if org should be throttled
  // ------------------------------------------
  async shouldThrottleOrg(orgId: string): Promise<{
    throttled: boolean;
    reason?: string;
    usagePercent?: number;
  }> {
    try {
      const result = await checkFreeTierLimits(orgId);
      const exceeded = result.exceeded;
      const exceededLimits = Object.entries(result.limits).filter(
        ([, val]) => val.exceeded,
      );

      if (!exceeded) {
        return { throttled: false };
      }

      // Calculate overall usage percentage (max across all limits)
      const maxUsagePercent = Math.max(
        ...Object.values(result.limits).map((l) =>
          l.max > 0 ? (l.current / l.max) * 100 : 0,
        ),
      );

      const reasons = exceededLimits.map(
        ([key]) => key.replace(/_/g, " "),
      );

      return {
        throttled: true,
        reason: `Free tier limit exceeded: ${reasons.join(", ")}`,
        usagePercent: Math.round(maxUsagePercent),
      };
    } catch (err) {
      console.error("[CostEngine] shouldThrottleOrg error:", err);
      return { throttled: false };
    }
  }

  // ------------------------------------------
  // Get tier multiplier for an org and cost type
  // ------------------------------------------
  async getTierMultiplier(orgId: string, costType: CostType): Promise<number> {
    try {
      const supabase = await createClient();
      if (!supabase) return 1.0;

      const { data: org, error } = await supabase
        .from("organizations")
        .select("plan")
        .eq("id", orgId)
        .single();

      if (error || !org) return 1.0;

      const plan = (org.plan ?? "free").toLowerCase();
      const planMultipliers = PLAN_MULTIPLIERS[plan] ?? PLAN_MULTIPLIERS.free;
      return planMultipliers[costType] ?? 1.0;
    } catch (err) {
      console.error("[CostEngine] getTierMultiplier error:", err);
      return 1.0;
    }
  }

  // ------------------------------------------
  // Get all cost configs
  // ------------------------------------------
  async getCostConfigs(): Promise<ProcessingCostConfig[]> {
    try {
      const supabase = await createClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("processing_cost_configs")
        .select("*")
        .eq("is_active", true);

      if (error || !data) {
        // Return default configs if table doesn't exist
        return Object.entries(DEFAULT_UNIT_COSTS).map(([type, info], idx) => ({
          id: `default-${idx}`,
          cost_type: type,
          unit_cost_usd: info.unitCost,
          unit: info.unit,
          currency: "USD",
          free_multiplier: PLAN_MULTIPLIERS.free[type] ?? 1.0,
          pro_multiplier: PLAN_MULTIPLIERS.pro[type] ?? 1.0,
          business_multiplier: PLAN_MULTIPLIERS.business[type] ?? 1.0,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
      }

      return data as ProcessingCostConfig[];
    } catch (err) {
      console.error("[CostEngine] getCostConfigs error:", err);
      return [];
    }
  }

  // ------------------------------------------
  // Smart queue prioritization — returns org priority score
  // ------------------------------------------
  async getOrgPriorityScore(orgId: string): Promise<{
    score: number; // 0-100, higher = more priority
    plan: string;
    isEnterprise: boolean;
    monthlySpend: number;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return { score: 25, plan: "free", isEnterprise: false, monthlySpend: 0 };
      }

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("plan")
        .eq("id", orgId)
        .single();

      if (orgError || !org) {
        return { score: 25, plan: "free", isEnterprise: false, monthlySpend: 0 };
      }

      const plan = (org.plan ?? "free").toLowerCase();
      const isEnterprise = plan === "business";

      // Calculate monthly spend
      const summary = await this.getOrgCostSummary(orgId);
      const monthlySpend = summary?.total_cost ?? 0;

      // Calculate priority score based on plan and spend
      let score = 25; // Base score for free tier

      if (plan === "pro") {
        score = 60;
      } else if (plan === "business") {
        score = 90;
      }

      // Boost score based on monthly spend (up to +10)
      if (monthlySpend > 0) {
        const spendBoost = Math.min(10, Math.floor(monthlySpend / 10));
        score += spendBoost;
      }

      // Check enterprise settings for additional priority
      if (isEnterprise) {
        const { data: enterpriseSettings } = await supabase
          .from("enterprise_settings")
          .select("priority_level")
          .eq("org_id", orgId)
          .single();

        if (enterpriseSettings) {
          score = Math.min(100, score + Number(enterpriseSettings.priority_level));
        }
      }

      return {
        score: Math.min(100, Math.max(0, score)),
        plan,
        isEnterprise,
        monthlySpend,
      };
    } catch (err) {
      console.error("[CostEngine] getOrgPriorityScore error:", err);
      return { score: 25, plan: "free", isEnterprise: false, monthlySpend: 0 };
    }
  }
}

// ============================================
// Singleton instance
// ============================================

let costEngineInstance: CostEngine | null = null;

export function getCostEngine(): CostEngine {
  if (!costEngineInstance) {
    costEngineInstance = new CostEngine();
  }
  return costEngineInstance;
}
