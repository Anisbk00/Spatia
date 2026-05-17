"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getFunnelMetrics,
  getRetentionData,
  getActivationRate,
  getAvgTimeToActivation,
  getCaptureCompletionRate,
  getShareRate,
  getSignupTrend,
} from "@/lib/growth/funnel-analytics";
import type { FunnelData, RetentionData, FunnelStep } from "@/lib/types";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Users,
  Zap,
  Clock,
  Camera,
  TrendingUp,
  ShieldAlert,
  ArrowDown,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  Cell,
} from "recharts";

// ============================================
// Types
// ============================================

interface StuckUser {
  user_id: string;
  email: string;
  signed_up_at: string;
  days_since_signup: number;
}

type DateRange = "7" | "30" | "90";

// ============================================
// Emerald color palette for funnel
// ============================================

const EMERALD_COLORS = [
  "#064e3b", // emerald-900
  "#065f46", // emerald-800
  "#047857", // emerald-700
  "#059669", // emerald-600
  "#10b981", // emerald-500
  "#34d399", // emerald-400
];

// ============================================
// Chart configs
// ============================================

const signupChartConfig = {
  count: {
    label: "Signups",
    color: "#10b981",
  },
};

const retentionChartConfig = {
  d1: {
    label: "D1 Retention",
    color: "#065f46",
  },
  d7: {
    label: "D7 Retention",
    color: "#059669",
  },
  d30: {
    label: "D30 Retention",
    color: "#34d399",
  },
};

const funnelChartConfig = {
  count: {
    label: "Users",
    color: "#059669",
  },
};

// ============================================
// Admin Dashboard Page
// ============================================

export default function AdminDashboardPage() {
  const router = useRouter();

  // State
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("30");
  const [loading, setLoading] = useState(true);

  // Data state
  const [funnelData, setFunnelData] = useState<FunnelData | null>(null);
  const [activationRate, setActivationRate] = useState<number | null>(null);
  const [avgTimeToActivation, setAvgTimeToActivation] = useState<number | null>(null);
  const [captureCompletionRate, setCaptureCompletionRate] = useState<number | null>(null);
  const [shareRate, setShareRate] = useState<number | null>(null);
  const [signupTrend, setSignupTrend] = useState<Array<{ date: string; count: number }>>([]);
  const [retentionData, setRetentionData] = useState<RetentionData[]>([]);
  const [stuckUsers, setStuckUsers] = useState<StuckUser[]>([]);

  // ============================================
  // Admin check
  // ============================================

  useEffect(() => {
    async function checkAdmin() {
      const supabase = createClient();
      if (!supabase) {
        setIsAdmin(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth/login");
        return;
      }

      const { data: profile } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!profile || profile.role !== "admin") {
        router.push("/dashboard");
        return;
      }

      setIsAdmin(true);
    }

    checkAdmin();
  }, [router]);

  // ============================================
  // Data fetching
  // ============================================

  const fetchAllData = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;

    setLoading(true);

    try {
      const days = parseInt(dateRange);

      const [
        funnelResult,
        activationResult,
        avgTimeResult,
        captureResult,
        shareResult,
        signupResult,
        retentionResult,
      ] = await Promise.allSettled([
        getFunnelMetrics(supabase),
        getActivationRate(supabase),
        getAvgTimeToActivation(supabase),
        getCaptureCompletionRate(supabase),
        getShareRate(supabase),
        getSignupTrend(supabase, days),
        getRetentionData(supabase, days),
      ]);

      if (funnelResult.status === "fulfilled") setFunnelData(funnelResult.value);
      if (activationResult.status === "fulfilled") setActivationRate(activationResult.value);
      if (avgTimeResult.status === "fulfilled") setAvgTimeToActivation(avgTimeResult.value);
      if (captureResult.status === "fulfilled") setCaptureCompletionRate(captureResult.value);
      if (shareResult.status === "fulfilled") setShareRate(shareResult.value);
      if (signupResult.status === "fulfilled") setSignupTrend(signupResult.value);
      if (retentionResult.status === "fulfilled") setRetentionData(retentionResult.value);

      // Fetch stuck users from API
      try {
        const res = await fetch("/api/growth/stuck-users");
        if (res.ok) {
          const data = await res.json();
          setStuckUsers(data.stuck_users || []);
        }
      } catch (err) {
        console.error("[AdminDashboard] Failed to fetch stuck users:", err);
      }
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    if (isAdmin === true) {
      fetchAllData();
    }
  }, [isAdmin, fetchAllData]);

  // ============================================
  // Loading / redirect states
  // ============================================

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
          <p className="text-sm text-muted-foreground">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center space-y-3">
          <ShieldAlert className="h-12 w-12 text-red-400 mx-auto" />
          <h2 className="text-lg font-semibold">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            You need admin privileges to view this page.
          </p>
        </div>
      </div>
    );
  }

  // ============================================
  // Retention chart data transform
  // ============================================

  const retentionChartData = retentionData.length > 0
    ? [
        {
          period: "D1",
          rate:
            retentionData.reduce((sum, r) => sum + r.d1, 0) /
            retentionData.length,
        },
        {
          period: "D7",
          rate:
            retentionData.reduce((sum, r) => sum + r.d7, 0) /
            retentionData.length,
        },
        {
          period: "D30",
          rate:
            retentionData.reduce((sum, r) => sum + r.d30, 0) /
            retentionData.length,
        },
      ]
    : [];

  // ============================================
  // Render
  // ============================================

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* ============ Header ============ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Growth &amp; Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Internal dashboard — Beta launch metrics
          </p>
        </div>
        <Select
          value={dateRange}
          onValueChange={(val) => setDateRange(val as DateRange)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ============ Row 1: Key Metrics Cards ============ */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Signups */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-600" />
              Total Signups
            </CardDescription>
            {loading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <CardTitle className="text-3xl font-bold tabular-nums">
                {funnelData?.totalUsers?.toLocaleString() ?? "—"}
              </CardTitle>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Users who created an account
            </p>
          </CardContent>
        </Card>

        {/* Activation Rate */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-emerald-600" />
              Activation Rate
            </CardDescription>
            {loading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <CardTitle className="text-3xl font-bold tabular-nums">
                {activationRate !== null ? `${activationRate}%` : "—"}
              </CardTitle>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Users who created their first property
            </p>
          </CardContent>
        </Card>

        {/* Avg Time to Activation */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-600" />
              Avg Time to Activation
            </CardDescription>
            {loading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <CardTitle className="text-3xl font-bold tabular-nums">
                {avgTimeToActivation !== null
                  ? `${avgTimeToActivation}h`
                  : "—"}
              </CardTitle>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              From signup to first property
            </p>
          </CardContent>
        </Card>

        {/* Capture Completion Rate */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-emerald-600" />
              Capture Completion Rate
            </CardDescription>
            {loading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <CardTitle className="text-3xl font-bold tabular-nums">
                {captureCompletionRate !== null
                  ? `${captureCompletionRate}%`
                  : "—"}
              </CardTitle>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Sessions started → completed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ============ Row 2: Funnel Visualization ============ */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Activation Funnel</CardTitle>
          <CardDescription>
            User progression through the product activation flow
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 flex-1" />
                </div>
              ))}
            </div>
          ) : funnelData && funnelData.steps.length > 0 ? (
            <div className="space-y-2">
              {funnelData.steps.map((step: FunnelStep, index: number) => {
                const maxCount = funnelData.steps[0]?.count || 1;
                const widthPct =
                  maxCount > 0 ? Math.max((step.count / maxCount) * 100, 8) : 8;

                return (
                  <div key={step.step} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">
                          {step.label}
                        </span>
                        {index > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-emerald-600 shrink-0">
                            <ArrowDown className="h-3 w-3" />
                            {step.rate}%
                          </span>
                        )}
                      </div>
                      <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                        {step.count.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-8 w-full rounded-md bg-muted/50 overflow-hidden">
                      <div
                        className="h-full rounded-md transition-all duration-500 flex items-center justify-end pr-2"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: EMERALD_COLORS[index] || EMERALD_COLORS[EMERALD_COLORS.length - 1],
                        }}
                      >
                        {widthPct > 15 && (
                          <span className="text-xs font-medium text-white tabular-nums">
                            {step.count.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                No funnel data yet. Data will appear here once users start
                signing up.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============ Row 3: Charts side by side ============ */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Signup Trend */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Signup Trend</CardTitle>
            <CardDescription>Daily signups over the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : signupTrend.length > 0 ? (
              <ChartContainer config={signupChartConfig} className="h-[250px] w-full">
                <LineChart
                  data={signupTrend}
                  margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(val: string) => {
                      const d = new Date(val);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    className="text-xs"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    allowDecimals={false}
                    className="text-xs"
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(label) => {
                          const d = new Date(label as string);
                          return d.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          });
                        }}
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="var(--color-count)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#10b981" }}
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-[250px] text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  No signup data yet.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Retention */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Retention</CardTitle>
            <CardDescription>
              Average D1, D7, D30 retention rates across cohorts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : retentionChartData.length > 0 ? (
              <ChartContainer config={retentionChartConfig} className="h-[250px] w-full">
                <BarChart
                  data={retentionChartData}
                  margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="period"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    className="text-xs"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    domain={[0, 100]}
                    tickFormatter={(val: number) => `${val}%`}
                    className="text-xs"
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => `${Number(value).toFixed(1)}%`}
                      />
                    }
                  />
                  <Bar
                    dataKey="rate"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={56}
                  >
                    {retentionChartData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={EMERALD_COLORS[index + 1] || "#10b981"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-[250px] text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  No retention data yet.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ============ Row 4: Stuck Users Table ============ */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Stuck Users</CardTitle>
          <CardDescription>
            Users who signed up but never activated (48+ hours, no property created)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : stuckUsers.length > 0 ? (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Signed Up</TableHead>
                    <TableHead className="text-right">Days Since Signup</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stuckUsers.map((user) => {
                    const isAtRisk = user.days_since_signup >= 7;
                    return (
                      <TableRow key={user.user_id}>
                        <TableCell className="font-medium">
                          {user.email}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(user.signed_up_at).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {user.days_since_signup}
                        </TableCell>
                        <TableCell>
                          {isAtRisk ? (
                            <Badge
                              variant="destructive"
                              className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-950 dark:text-red-400 dark:border-red-900"
                            >
                              At risk
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900"
                            >
                              Needs nudge
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
                <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                No stuck users found. All signed-up users have activated!
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
