import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", service: "phone-to-3d" });
}
