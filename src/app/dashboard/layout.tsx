import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardTopbar } from "@/components/dashboard/DashboardTopbar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import type { User, Organization } from "@/lib/types";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tp = await getTranslations("property");
  const supabase = await createClient();

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">{tp("supabaseNotConfigured")}</h2>
          <p className="text-sm text-muted-foreground">
            {tp("supabaseNotConfiguredDesc")}
          </p>
        </div>
      </div>
    );
  }

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  // All authenticated users with a profile can access the dashboard
  if (!profile) {
    redirect("/auth/login");
  }

  // Get user's organization
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("*, organizations(*)")
    .eq("user_id", authUser.id)
    .limit(1);

  const membership = memberships?.[0];
  const organization = membership?.organizations as Organization | undefined;
  const orgRole = (membership as { role: string })?.role as string ?? "agent";

  return (
    <SidebarProvider>
      <DashboardSidebar
        user={profile as User}
        organization={organization ?? null}
        orgRole={orgRole}
      />
      <SidebarInset>
        <DashboardTopbar
          user={profile as User}
          organization={organization ?? null}
          orgRole={orgRole}
        />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
