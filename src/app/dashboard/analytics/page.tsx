import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization, getAnalytics } from "@/lib/supabase/dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Eye, Box, Trophy, Monitor, Globe2, BarChart3 } from "lucide-react";
import { ViewsChart } from "./analytics-charts";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/auth/login");

  let user;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("[DashboardAnalytics] getUser error:", error.message);
    }
    user = data.user;
  } catch (err) {
    console.error("[DashboardAnalytics] getUser threw:", err);
  }
  if (!user) redirect("/auth/login");

  const { organization } = await getUserOrganization(user.id);

  if (!organization) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Card className="max-w-md border-0 shadow-lg">
          <CardHeader>
            <CardTitle>No Organization</CardTitle>
            <CardDescription>
              You need to create or join an organization to view analytics.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><a href="/onboarding">Create Organization</a></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const analytics = await getAnalytics(organization.id);

  const topProperty =
    analytics.topProperties.length > 0 ? analytics.topProperties[0] : null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Insights and performance metrics for your properties.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Total Property Views
            </CardDescription>
            <CardTitle className="text-3xl font-bold tabular-nums">
              {analytics.totalViews.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Across all your listed properties
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Box className="h-4 w-4" />
              3D Scenes Generated
            </CardDescription>
            <CardTitle className="text-3xl font-bold tabular-nums">
              {analytics.scenesGenerated.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              This month
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              Top Property
            </CardDescription>
            <CardTitle className="text-xl font-bold truncate">
              {topProperty ? topProperty.title : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topProperty ? (
              <p className="text-xs text-muted-foreground">
                {topProperty.views.toLocaleString()} views
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                No views recorded yet
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Views Over Time Chart */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Views Over Time</CardTitle>
          <CardDescription>Daily property views for the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.viewsOverTime.length > 0 ? (
            <ViewsChart data={analytics.viewsOverTime} />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                No view data yet. Views will appear here once your properties are
                visited.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Grid: Top Properties + Breakdowns */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Top Viewed Properties */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Top Viewed Properties</CardTitle>
            <CardDescription>Properties with the most views</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics.topProperties.length > 0 ? (
              <div className="space-y-3">
                {analytics.topProperties.map((prop, i) => (
                  <div
                    key={prop.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium truncate">
                        {prop.title}
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums shrink-0">
                      {prop.views.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No property views yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Device Breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Device Breakdown
            </CardTitle>
            <CardDescription>View sessions by device type</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics.deviceBreakdown.length > 0 ? (
              <div className="space-y-3">
                {analytics.deviceBreakdown.map((item) => {
                  const total = analytics.deviceBreakdown.reduce(
                    (sum, d) => sum + d.count,
                    0
                  );
                  const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                  return (
                    <div key={item.device} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium capitalize">
                          {item.device}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {item.count.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No device data yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Country Breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe2 className="h-4 w-4" />
              Country Breakdown
            </CardTitle>
            <CardDescription>View sessions by country</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics.countryBreakdown.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {analytics.countryBreakdown.map((item) => {
                  const total = analytics.countryBreakdown.reduce(
                    (sum, c) => sum + c.count,
                    0
                  );
                  const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                  return (
                    <div
                      key={item.country}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-medium capitalize">
                        {item.country}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground tabular-nums text-xs w-12 text-right">
                          {item.count}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No country data yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
