import { getMonitoringSystem } from "@/lib/monitoring";
import { NextResponse } from "next/server";

/**
 * GET /api/admin/monitoring/health
 * Public health check endpoint. No auth required.
 */
export async function GET() {
  const monitoring = getMonitoringSystem();
  const health = await monitoring.healthCheck();

  const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;

  return NextResponse.json(health, { status: statusCode });
}
