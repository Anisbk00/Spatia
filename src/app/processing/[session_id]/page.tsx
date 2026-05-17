import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ProcessingStatus } from "@/components/processing/ProcessingStatus";
import { SpatiaLogo } from "@/components/SpatiaLogo";

export default async function ProcessingPage({
  params,
}: {
  params: Promise<{ session_id: string }>;
}) {
  const { session_id } = await params;
  const supabase = await createClient();

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-xl">
          <CardHeader className="text-center">
            <CardTitle>Supabase Not Configured</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Use admin client for reads to bypass RLS
  const adminClient = createAdminClient();
  const readClient = adminClient || supabase;

  // Fetch session + property for context
  const { data: session } = await readClient
    .from("capture_sessions")
    .select("*, properties(*)")
    .eq("id", session_id)
    .single();

  const property = session?.properties as {
    id: string;
    title: string;
    status: string;
  } | null;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <SpatiaLogo size="md" />
            <span className="font-semibold tracking-tight">
              Spatia
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-lg">
          <a
            href="/dashboard"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </a>

          <Card className="border-0 shadow-xl">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl font-bold tracking-tight">
                Generating 3D Scene
              </CardTitle>
              <CardDescription className="text-base">
                {property?.title ?? "Your property"}
              </CardDescription>
            </CardHeader>

            <CardContent>
              <ProcessingStatus sessionId={session_id} />
            </CardContent>
          </Card>

          <div className="mt-4 text-center">
            <a href="/dashboard">
              <Button variant="outline" className="h-12 text-base">
                Return to Dashboard
              </Button>
            </a>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        Spatia &middot; Immersive Spatial Platform
      </footer>
    </div>
  );
}
