import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Stripe Customer Portal redirect
// When Stripe is configured, this will create a portal session and redirect
// For now, it redirects back to billing with a message

export async function GET(request: NextRequest) {
  // Auth check — must be authenticated
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeKey) {
    // Stripe not configured — redirect back to billing page
    const referer = request.headers.get("referer") || "/dashboard/billing";
    try {
      const refUrl = new URL(referer, request.url);
      if (refUrl.origin !== new URL(request.url).origin) {
        return NextResponse.redirect(new URL("/dashboard/billing", request.url));
      }
    } catch {
      return NextResponse.redirect(new URL("/dashboard/billing", request.url));
    }
    return NextResponse.redirect(new URL(referer, request.url));
  }

  // When Stripe is configured:
  // const stripe = require("stripe")(stripeKey);
  // const session = await stripe.billingPortal.sessions.create({...});
  // return NextResponse.redirect(session.url);

  return NextResponse.redirect(new URL("/dashboard/billing", request.url));
}
