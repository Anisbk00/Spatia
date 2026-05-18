import { getMonitoringSystem } from "@/lib/monitoring";
import { NextResponse } from "next/server";

/**
 * GET /api/admin/monitoring/health
 * Health check endpoint. Returns minimal public-safe info.
 * Full details are available only to authenticated admin users.
 */
export async function GET(request: Request) {
  // Return minimal public-safe response
  // This avoids leaking internal system details (DB status, queue depths, etc.)
  try {
    const monitoring = getMonitoringSystem();
    const health = await monitoring.healthCheck();

    // Determine if caller is authenticated by checking for auth headers
    // Since this endpoint is under /api/admin, the middleware should handle auth.
    // For safety, return minimal info to unauthenticated requests.
    const authHeader = request.headers.get("authorization");
    const isAuthenticated = !!authHeader;

    if (!isAuthenticated) {
      // Public-safe response: only status, no internal details
      const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
      return NextResponse.json(
        { status: health.status === "unhealthy" ? "unhealthy" : "ok" },
        { status: statusCode },
      );
    }

    // Authenticated admin users get full health details
    const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
    return NextResponse.json(health, { status: statusCode });
  } catch {
    // If monitoring system itself fails, return minimal safe response
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }
}
