import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/supabase/dashboard";
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
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Building2,
  Users,
  Shield,
  Clock,
} from "lucide-react";
import { InviteMemberDialog } from "@/components/InviteMemberDialog";
import { format } from "date-fns";
import type { OrgRole } from "@/lib/types";

// ── Role badge styles ───────────────────────────────────────────────────────

const roleBadgeStyles: Record<
  OrgRole,
  { bg: string; text: string; border: string }
> = {
  owner: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
  },
  agent: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  viewer: {
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-200",
  },
};

// ── Page Component ──────────────────────────────────────────────────────────

export default async function SettingsPage() {
  const ts = await getTranslations("settings");
  const tc = await getTranslations("common");

  const supabase = await createClient();
  if (!supabase) redirect("/auth/login");

  let user;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("[DashboardSettings] getUser error:", error.message);
    }
    user = data.user;
  } catch (err) {
    console.error("[DashboardSettings] getUser threw:", err);
  }
  if (!user) redirect("/auth/login");

  const { organization, membership, members } = await getUserOrganization(
    user.id
  );

  if (!organization) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Card className="max-w-md border-0 shadow-lg">
          <CardHeader>
            <CardTitle>{tc("noOrganization")}</CardTitle>
            <CardDescription>
              {ts("noOrganizationDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><a href="/onboarding">{tc("createOrganization")}</a></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const memberCount = members.length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{ts("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ts("subtitle")}
        </p>
      </div>

      {/* Organization Settings */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {ts("organization")}
          </CardTitle>
          <CardDescription>
            {ts("organizationDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {ts("organizationName")}
              </p>
              <p className="text-base font-semibold">{organization.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">{ts("plan")}</p>
              <Badge variant="secondary" className="capitalize">
                {organization.plan || "free"}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">{ts("members")}</p>
              <p className="text-base font-semibold tabular-nums">
                {ts("memberCount", { count: memberCount })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Team Management */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                {ts("teamMembers")}
              </CardTitle>
              <CardDescription>
                {ts("teamMembersDesc")}
              </CardDescription>
            </div>
            <InviteMemberDialog orgId={organization.id} />
          </div>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {ts("noTeamMembers")}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {members.map((member) => {
                const memberUser = member.user;
                const role = member.role as OrgRole;
                const roleStyle = roleBadgeStyles[role] ?? {
                  bg: "bg-gray-50",
                  text: "text-gray-600",
                  border: "border-gray-200",
                };

                const initials = memberUser?.full_name
                  ? memberUser.full_name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2)
                  : memberUser?.email?.[0]?.toUpperCase() ?? "?";

                const displayName =
                  memberUser?.full_name || memberUser?.email || "Unknown";

                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarImage
                        src={memberUser?.avatar_url ?? undefined}
                        alt={displayName}
                      />
                      <AvatarFallback className="text-xs">
                        {initials}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {displayName}
                        </p>
                        <Badge
                          variant="outline"
                          className={`${roleStyle.bg} ${roleStyle.text} ${roleStyle.border}`}
                        >
                          {role === "owner" && (
                            <Shield className="mr-1 h-3 w-3" />
                          )}
                          {role}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {memberUser?.email}
                      </p>
                    </div>

                    <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                      <Clock className="h-3 w-3" />
                      {format(new Date(member.created_at), "MMM d, yyyy")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
