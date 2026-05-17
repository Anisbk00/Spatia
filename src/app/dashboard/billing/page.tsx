import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  getUserOrganization,
  getBillingData,
  getUsageLimits,
} from "@/lib/supabase/dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  CreditCard,
  Home,
  HardDrive,
  Box,
  ArrowUpRight,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import type { PaymentStatus, InvoiceStatus } from "@/lib/types";

// ── Currency formatter ──────────────────────────────────────────────────────

function formatCurrency(
  amount: number | null,
  currency: string = "usd"
): string {
  if (amount === null || amount === undefined) return "—";
  // Amounts are stored in the smallest currency unit (cents)
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

// ── Status badge helpers ────────────────────────────────────────────────────

const paymentBadgeStyles: Record<
  PaymentStatus,
  { bg: string; text: string; border: string }
> = {
  pending: {
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
  },
  succeeded: {
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
  failed: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
  refunded: {
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-200",
  },
};

const invoiceBadgeStyles: Record<
  InvoiceStatus,
  { bg: string; text: string; border: string }
> = {
  draft: {
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-200",
  },
  paid: {
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
  void: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
  uncollectible: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
};

const subscriptionBadgeStyles: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  active: {
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
  trialing: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  past_due: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
  canceled: {
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-200",
  },
};

// ── Page Component ──────────────────────────────────────────────────────────

export default async function BillingPage() {
  const tb = await getTranslations("billing");
  const tc = await getTranslations("common");

  const supabase = await createClient();
  if (!supabase) redirect("/auth/login");

  let user;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("[DashboardBilling] getUser error:", error.message);
    }
    user = data.user;
  } catch (err) {
    console.error("[DashboardBilling] getUser threw:", err);
  }
  if (!user) redirect("/auth/login");

  const { organization } = await getUserOrganization(user.id);

  if (!organization) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Card className="max-w-md border-0 shadow-lg">
          <CardHeader>
            <CardTitle>{tc("noOrganization")}</CardTitle>
            <CardDescription>
              {tb("noOrganizationDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><a href="/onboarding">{tc("createOrganization")}</a></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [billing, usageLimits] = await Promise.all([
    getBillingData(organization.id),
    getUsageLimits(organization.id),
  ]);

  const { subscription, plan } = billing;
  const subStatus = subscription?.status ?? "inactive";
  const subBadge = subscriptionBadgeStyles[subStatus] ?? {
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-200",
  };

  // Calculate progress percentages
  const propertiesPct =
    usageLimits.properties.limit !== null
      ? Math.min(
          Math.round(
            (usageLimits.properties.used / usageLimits.properties.limit) * 100
          ),
          100
        )
      : null;

  const storagePct =
    usageLimits.storage.limitMB !== null
      ? Math.min(
          Math.round(
            (usageLimits.storage.usedMB / usageLimits.storage.limitMB) * 100
          ),
          100
        )
      : null;

  const generationsPct =
    usageLimits.generations.limit !== null
      ? Math.min(
          Math.round(
            (usageLimits.generations.used / usageLimits.generations.limit) * 100
          ),
          100
        )
      : null;

  // Determine if near limit (>= 80%)
  const isNearLimit = (pct: number | null) => pct !== null && pct >= 80;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tb("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tb("subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <form action="/api/billing/portal" method="GET">
            <Button variant="outline" size="sm" type="submit">
              <ExternalLink className="mr-1 h-4 w-4" />
              {tb("manageBilling")}
            </Button>
          </form>
          <Button size="sm" asChild>
            <Link href="/dashboard/settings">
              <ArrowUpRight className="mr-1 h-4 w-4" />
              {tb("upgradePlan")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Subscription Card */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                {tb("currentPlan")}
              </CardTitle>
              <CardDescription>
                {plan?.name
                  ? plan.name.charAt(0).toUpperCase() + plan.name.slice(1)
                  : "Free"}{" "}
                {tb("planSuffix")}
              </CardDescription>
            </div>
            <Badge variant="outline" className={`${subBadge.bg} ${subBadge.text} ${subBadge.border} w-fit`}>
              {subStatus}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">{tb("monthlyCost")}</p>
              <p className="text-2xl font-bold tabular-nums">
                {plan?.price_monthly
                  ? formatCurrency(plan.price_monthly)
                  : "$0.00"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{tb("nextBillingDate")}</p>
              <p className="text-lg font-semibold">
                {subscription?.current_period_end
                  ? format(
                      new Date(subscription.current_period_end),
                      "MMM d, yyyy"
                    )
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{tb("provider")}</p>
              <p className="text-lg font-semibold capitalize">
                {subscription?.provider || "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage Metrics */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{tb("usage")}</CardTitle>
          <CardDescription>
            {tb("usageDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Properties */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Home className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{tb("properties")}</span>
              </div>
              <span
                className={`tabular-nums ${
                  isNearLimit(propertiesPct)
                    ? "text-red-600 font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                {usageLimits.properties.used}
                {usageLimits.properties.limit !== null
                  ? ` / ${usageLimits.properties.limit}`
                  : ` / ${tb("unlimited")}`}
              </span>
            </div>
            {usageLimits.properties.limit !== null ? (
              <Progress value={propertiesPct ?? 0} />
            ) : (
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary w-1" />
              </div>
            )}
          </div>

          {/* Storage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{tb("storage")}</span>
              </div>
              <span
                className={`tabular-nums ${
                  isNearLimit(storagePct)
                    ? "text-red-600 font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                {usageLimits.storage.usedMB.toLocaleString()} MB
                {usageLimits.storage.limitMB !== null
                  ? ` / ${usageLimits.storage.limitMB.toLocaleString()} MB`
                  : ` / ${tb("unlimited")}`}
              </span>
            </div>
            {usageLimits.storage.limitMB !== null ? (
              <Progress value={storagePct ?? 0} />
            ) : (
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary w-1" />
              </div>
            )}
          </div>

          {/* 3D Generations */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Box className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{tb("generations")}</span>
              </div>
              <span
                className={`tabular-nums ${
                  isNearLimit(generationsPct)
                    ? "text-red-600 font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                {usageLimits.generations.used}
                {usageLimits.generations.limit !== null
                  ? ` / ${usageLimits.generations.limit}`
                  : ` / ${tb("unlimited")}`}
              </span>
            </div>
            {usageLimits.generations.limit !== null ? (
              <Progress value={generationsPct ?? 0} />
            ) : (
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary w-1" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{tb("paymentHistory")}</CardTitle>
          <CardDescription>{tb("paymentHistoryDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {billing.payments.length === 0 && billing.invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <CreditCard className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {tb("noPaymentHistory")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tb("invoiceId")}</TableHead>
                    <TableHead>{tb("amount")}</TableHead>
                    <TableHead>{tb("status")}</TableHead>
                    <TableHead>{tb("date")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Invoices take priority */}
                  {billing.invoices.length > 0
                    ? billing.invoices.map((invoice) => {
                        const invBadge =
                          invoiceBadgeStyles[invoice.status] ?? {
                            bg: "bg-gray-50",
                            text: "text-gray-600",
                            border: "border-gray-200",
                          };
                        return (
                          <TableRow key={invoice.id}>
                            <TableCell className="font-mono text-sm">
                              {invoice.id.slice(0, 8)}…
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatCurrency(invoice.amount, invoice.currency)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`${invBadge.bg} ${invBadge.text} ${invBadge.border}`}
                              >
                                {invoice.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground whitespace-nowrap">
                              {format(
                                new Date(invoice.created_at),
                                "MMM d, yyyy"
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    : billing.payments.map((payment) => {
                        const payBadge =
                          paymentBadgeStyles[payment.status] ?? {
                            bg: "bg-gray-50",
                            text: "text-gray-600",
                            border: "border-gray-200",
                          };
                        return (
                          <TableRow key={payment.id}>
                            <TableCell className="font-mono text-sm">
                              {payment.id.slice(0, 8)}…
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatCurrency(payment.amount, payment.currency)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`${payBadge.bg} ${payBadge.text} ${payBadge.border}`}
                              >
                                {payment.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground whitespace-nowrap">
                              {format(
                                new Date(payment.created_at),
                                "MMM d, yyyy"
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
