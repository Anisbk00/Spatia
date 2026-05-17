import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CaptureSessionClient from "@/components/capture/CaptureSessionClient";
import type { CaptureSession, Property } from "@/lib/types";

interface CaptureSessionData {
  session: CaptureSession;
  property: Property;
}

export default async function CaptureSessionPage({
  params,
}: {
  params: Promise<{ session_id: string }>;
}) {
  const { session_id } = await params;
  const supabase = await createClient();

  if (!supabase) {
    return <CaptureSessionClient sessionId={session_id} initialData={null} />;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Verify agent/admin role
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "agent" && profile.role !== "admin")) {
    redirect("/explore");
  }

  // Fetch capture session with property
  const { data: session } = await supabase
    .from("capture_sessions")
    .select("*")
    .eq("id", session_id)
    .single();

  if (!session) {
    return <CaptureSessionClient sessionId={session_id} initialData={null} />;
  }

  // Fetch property
  const { data: property } = await supabase
    .from("properties")
    .select("*")
    .eq("id", session.property_id)
    .single();

  if (!property) {
    return <CaptureSessionClient sessionId={session_id} initialData={null} />;
  }

  const initialData: CaptureSessionData = {
    session: session as CaptureSession,
    property: property as Property,
  };

  return (
    <CaptureSessionClient sessionId={session_id} initialData={initialData} />
  );
}
