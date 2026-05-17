import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("[Signout] Failed:", error.message);
    return NextResponse.json(
      { error: "Failed to sign out" },
      { status: 500 }
    );
  }

  return NextResponse.redirect(new URL("/auth/login", process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:3000"));
}
