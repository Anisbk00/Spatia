// ============================================
// Email Notification Service
// ============================================
// Email service abstraction with system_logs tracking.
// Integrates with Supabase for delivery tracking and audit.
// Provider integration (Resend, SendGrid, etc.) can be added
// by implementing the sendEmail function with a real provider.
// ============================================

import { createClient } from "@/lib/supabase/server";

// ============================================
// Types
// ============================================

export type EmailTemplate = "welcome" | "scene_ready" | "first_property" | "onboarding_reminder";

export interface EmailMessage {
  to: string;
  subject: string;
  template: EmailTemplate;
  data: Record<string, unknown>;
}

// ============================================
// Main send function
// ============================================

/**
 * Send an email using the configured email provider.
 *
 * Logs to system_logs for delivery tracking and audit.
 * Replace the console.log with a real provider (Resend, SendGrid)
 * when email provider credentials are configured.
 *
 * @param message - The email message to send
 * @returns Whether the email was sent successfully
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  // Attempt to send via the email API endpoint
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    if (baseUrl) {
      const response = await fetch(`${baseUrl}/api/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });

      if (response.ok) {
        return true;
      }
      // If API returns 404 or 501, email provider is not configured
      // Fall through to system_logs tracking
    }
  } catch (err) {
    console.error("[EmailService] API send failed:", err);
    // API not available, fall through to logging
  }

  // Log to system_logs for tracking (always, even if send succeeds)
  try {
    const supabase = await createClient();
    if (supabase) {
      await supabase.from("system_logs").insert({
        level: "info",
        source: "api",
        message: `Email notification: ${message.template}`,
        metadata: {
          to: message.to,
          subject: message.subject,
          template: message.template,
          data: message.data,
          delivery_status: "logged",
        },
        user_id: (message.data.user_id as string) || null,
        org_id: (message.data.org_id as string) || null,
      });
    }
  } catch (error) {
    console.error("[sendEmail] Failed to log to system_logs:", error);
  }

  return false; // API send failed and no real delivery occurred
}

// ============================================
// Email template generators
// ============================================

/**
 * Escape HTML special characters to prevent XSS in email templates.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getWelcomeEmailHtml(userName: string): string {
  const safeName = escapeHtml(userName);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to PropView3D</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; color: #111827;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="margin: 0 0 20px; font-size: 24px; font-weight: 700; color: #111827;">
        Welcome to PropView3D, ${safeName}! 🏠
      </h1>
      <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #4b5563;">
        We're excited to have you on board. PropView3D transforms your phone photos into
        stunning 3D property tours that captivate buyers and close deals faster.
      </p>
      <div style="margin: 24px 0; padding: 20px; background-color: #f0fdf4; border-radius: 8px; border-left: 4px solid #22c55e;">
        <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #166534;">Get started in 3 easy steps:</p>
        <ol style="margin: 0; padding-left: 20px; color: #166534; font-size: 14px; line-height: 1.8;">
          <li>Create your first property listing</li>
          <li>Capture photos using your phone</li>
          <li>Share the 3D tour with clients</li>
        </ol>
      </div>
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "/dashboard"}/dashboard" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Go to Dashboard →
      </a>
      <p style="margin: 24px 0 0; font-size: 14px; color: #6b7280;">
        Questions? Reply to this email or visit our help center.
      </p>
    </div>
    <p style="margin: 20px 0 0; text-align: center; font-size: 12px; color: #9ca3af;">
      PropView3D — Transform properties with 3D tours
    </p>
  </div>
</body>
</html>`;
}

/**
 * Generate HTML for the scene ready email.
 */
export function getSceneReadyEmailHtml(
  propertyTitle: string,
  propertyId: string,
): string {
  const safeTitle = escapeHtml(propertyTitle);
  const viewUrl = `/view/${propertyId}`;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your 3D Tour is Ready!</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; color: #111827;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="margin: 0 0 20px; font-size: 24px; font-weight: 700; color: #111827;">
        Your 3D Tour is Ready! 🎉
      </h1>
      <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #4b5563;">
        Great news! The 3D tour for <strong>${safeTitle}</strong> has been
        generated and is ready to share with your clients.
      </p>
      <div style="margin: 24px 0; padding: 20px; background-color: #eff6ff; border-radius: 8px; border-left: 4px solid #3b82f6;">
        <p style="margin: 0; font-size: 14px; color: #1e40af;">
          <strong>Next steps:</strong> Share the tour link via email, social media, or embed it on your website.
        </p>
      </div>
      <a href="${viewUrl}" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        View 3D Tour →
      </a>
      <p style="margin: 24px 0 0; font-size: 14px; color: #6b7280;">
        Tip: Share the tour directly from the dashboard to track views and engagement.
      </p>
    </div>
    <p style="margin: 20px 0 0; text-align: center; font-size: 12px; color: #9ca3af;">
      PropView3D — Transform properties with 3D tours
    </p>
  </div>
</body>
</html>`;
}

/**
 * Generate HTML for the first property email.
 */
export function getFirstPropertyEmailHtml(propertyTitle: string): string {
  const safeTitle = escapeHtml(propertyTitle);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your First Property is Set Up!</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; color: #111827;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="margin: 0 0 20px; font-size: 24px; font-weight: 700; color: #111827;">
        Your First Property is Set Up! 🏗️
      </h1>
      <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #4b5563;">
        You've created <strong>${safeTitle}</strong> — nice work!
        You're one step closer to creating an immersive 3D experience for your clients.
      </p>
      <div style="margin: 24px 0; padding: 20px; background-color: #fefce8; border-radius: 8px; border-left: 4px solid #eab308;">
        <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #854d0e;">What's next?</p>
        <p style="margin: 0; font-size: 14px; color: #854d0e; line-height: 1.6;">
          Use your phone to capture photos of the property. Our AI will transform them into
          a stunning 3D tour that you can share anywhere.
        </p>
      </div>
      <a href="${process.env.NEXT_PUBLIC_APP_URL || ""}/properties/new" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Start Capturing →
      </a>
    </div>
    <p style="margin: 20px 0 0; text-align: center; font-size: 12px; color: #9ca3af;">
      PropView3D — Transform properties with 3D tours
    </p>
  </div>
</body>
</html>`;
}

/**
 * Generate HTML for the onboarding reminder email.
 */
export function getOnboardingReminderHtml(daysSinceSignup: number): string {
  const urgencyLevel =
    daysSinceSignup >= 7 ? "high" : daysSinceSignup >= 3 ? "medium" : "low";
  const urgencyColor =
    urgencyLevel === "high"
      ? "#dc2626"
      : urgencyLevel === "medium"
        ? "#f59e0b"
        : "#22c55e";

  const message =
    daysSinceSignup >= 7
      ? "We noticed you haven't set up your first property yet. Don't miss out on the power of 3D property tours!"
      : daysSinceSignup >= 3
        ? "You're almost there! Complete your setup to start creating stunning 3D tours."
        : "Ready to create your first 3D tour? It only takes a few minutes.";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Complete Your Setup</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; color: #111827;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="margin: 0 0 20px; font-size: 24px; font-weight: 700; color: #111827;">
        Let's Get You Started 🚀
      </h1>
      <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #4b5563;">
        ${message}
      </p>
      <div style="margin: 24px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px; border-left: 4px solid ${urgencyColor};">
        <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #111827;">
          It only takes 3 steps:
        </p>
        <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #4b5563; line-height: 1.8;">
          <li>Create a property listing</li>
          <li>Take photos with your phone</li>
          <li>Share the 3D tour</li>
        </ul>
      </div>
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "/dashboard"}/dashboard" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Continue Setup →
      </a>
      <p style="margin: 24px 0 0; font-size: 14px; color: #6b7280;">
        Need help? Our support team is just a reply away.
      </p>
    </div>
    <p style="margin: 20px 0 0; text-align: center; font-size: 12px; color: #9ca3af;">
      PropView3D — Transform properties with 3D tours
    </p>
  </div>
</body>
</html>`;
}
