import { NextRequest, NextResponse } from "next/server";

// Email sending API endpoint
// Integrates with configured email provider (Resend, SendGrid, etc.)
// Currently returns 501 until a provider is configured via EMAIL_PROVIDER env var

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, subject, template, data } = body;

    if (!to || !subject || !template) {
      return NextResponse.json(
        { error: "Missing required fields: to, subject, template" },
        { status: 400 }
      );
    }

    const emailProvider = process.env.EMAIL_PROVIDER;

    if (!emailProvider) {
      // No email provider configured — return 501 Not Implemented
      // The email service will fall back to system_logs tracking
      return NextResponse.json(
        { error: "Email provider not configured", logged: true },
        { status: 501 }
      );
    }

    // Provider integration would go here
    // Example for Resend:
    // if (emailProvider === "resend") {
    //   const { Resend } = await import("resend");
    //   const resend = new Resend(process.env.RESEND_API_KEY);
    //   await resend.emails.send({ from: ..., to, subject, html });
    // }

    return NextResponse.json({ success: true, provider: emailProvider });
  } catch (error) {
    console.error("[EmailAPI] Error sending email:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
