import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardTopbar } from "@/components/dashboard/DashboardTopbar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import type { User, Organization } from "@/lib/types";

/**
 * Check if an error is a Next.js internal error that must be re-thrown.
 * Next.js uses special errors for redirect() and notFound() that must
 * propagate up to the framework for proper handling.
 */
function isNextJsInternalError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  // Next.js redirect errors have a digest starting with "NEXT_REDIRECT"
  if ("digest" in err && typeof (err as { digest: unknown }).digest === "string") {
    const digest = (err as { digest: string }).digest;
    if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) {
      return true;
    }
  }

  return false;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tp = await getTranslations("property");

  try {
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

    // Use admin client to bypass RLS for profile and org queries
    const adminClient = createAdminClient();
    const readClient = adminClient || supabase;

    // Use maybeSingle() — single() throws PGRST116 if no row exists
    const { data: profile } = await readClient
      .from("users")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();

    // All authenticated users with a profile can access the dashboard
    if (!profile) {
      redirect("/auth/login");
    }

    // Get user's organization
    const { data: memberships } = await readClient
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
  } catch (err) {
    // If it's a Next.js internal error (redirect/notFound), re-throw it
    if (isNextJsInternalError(err)) {
      throw err;
    }
    console.error("[DashboardLayout] Rendering error:", err);
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            An error occurred while loading the dashboard. Please try again.
          </p>
        </div>
      </div>
    );
  }
}
