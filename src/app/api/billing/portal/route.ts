import { NextRequest, NextResponse } from "next/server";

// Stripe Customer Portal redirect
// When Stripe is configured, this will create a portal session and redirect
// For now, it redirects back to billing with a message

export async function GET(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeKey) {
    // Stripe not configured — redirect back to billing page
    const referer = request.headers.get("referer") || "/dashboard/billing";
    return NextResponse.redirect(new URL(referer));
  }

  // When Stripe is configured:
  // const stripe = require("stripe")(stripeKey);
  // const session = await stripe.billingPortal.sessions.create({...});
  // return NextResponse.redirect(session.url);

  return NextResponse.redirect(new URL("/dashboard/billing", request.url));
}
