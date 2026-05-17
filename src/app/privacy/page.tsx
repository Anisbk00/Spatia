import { SpatiaLogo } from "@/components/SpatiaLogo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Spatia",
  description: "Spatia Privacy Policy. Learn how we collect, use, and protect your data.",
};

const LAST_UPDATED = "May 12, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5">
            <SpatiaLogo size="lg" />
            <span className="text-lg font-bold tracking-tight">Spatia</span>
          </a>
          <a
            href="/"
            className="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
          >
            &larr; Back to Home
          </a>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        <article className="mx-auto max-w-4xl px-4 sm:px-6 py-12 sm:py-16">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>

          <div className="mt-10 space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">1. Introduction</h2>
              <p>
                Spatia respects your privacy and is committed to protecting your personal data.
                This Privacy Policy explains how we collect, use, disclose, and safeguard your
                information when you use our spatial walkthrough platform.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">2. Information We Collect</h2>
              <h3 className="font-semibold text-gray-900 mb-2">2.1 Information You Provide</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Account information: email address, name, and password when you register.</li>
                <li>Property data: photos, scans, and 3D scene files you upload or generate.</li>
                <li>Profile information: company name, role, and preferences you choose to provide.</li>
                <li>Communication: messages, feedback, or support requests you send to us.</li>
              </ul>

              <h3 className="font-semibold text-gray-900 mt-4 mb-2">2.2 Information Collected Automatically</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Usage data: pages visited, features used, session duration, and click patterns.</li>
                <li>Device information: browser type, operating system, device model, and screen resolution.</li>
                <li>Analytics data: property view counts, engagement time, and sharing metrics for scenes you publish.</li>
              </ul>

              <h3 className="font-semibold text-gray-900 mt-4 mb-2">2.3 Information from Third Parties</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Authentication providers: when you sign in, we receive basic profile data from our auth provider.</li>
                <li>Payment processors: when you subscribe, we receive transaction confirmations (not full card details).</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">3. How We Use Your Information</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>To provide, maintain, and improve the Service, including processing your 3D scene generation requests.</li>
                <li>To create and manage your account and authenticate your access.</li>
                <li>To process payments and manage your subscription.</li>
                <li>To send you service-related communications (account verification, billing receipts, security alerts).</li>
                <li>To analyze usage patterns and improve our product experience.</li>
                <li>To comply with legal obligations and enforce our terms.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">4. Data Sharing and Disclosure</h2>
              <p>We do not sell your personal data. We may share your information only in the following circumstances:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li><strong>Service providers:</strong> Third-party vendors who process data on our behalf (cloud hosting, email delivery, payment processing, 3D rendering pipeline), subject to confidentiality obligations.</li>
                <li><strong>Analytics:</strong> Aggregated, non-personally-identifiable data may be shared with analytics providers to help us understand Service usage.</li>
                <li><strong>Legal requirements:</strong> When required by law, regulation, legal process, or governmental request.</li>
                <li><strong>Business transfers:</strong> In connection with a merger, acquisition, or sale of assets, your data may be transferred to the acquiring entity.</li>
                <li><strong>With your consent:</strong> When you explicitly authorize us to share your information.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">5. Data Storage and Security</h2>
              <p>
                Your data is stored on secure servers with encryption at rest and in transit. We implement
                industry-standard security measures including TLS encryption, access controls, and regular
                security audits. However, no method of electronic storage is 100% secure, and we cannot
                guarantee absolute security.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">6. Data Retention</h2>
              <p>
                We retain your personal data for as long as your account is active or as needed to provide
                you the Service. Property scans and 3D scenes are retained until you delete them or your
                account. Upon account deletion, we will remove your personal data within 30 days, except
                where retention is required by law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">7. Cookies and Tracking</h2>
              <p>
                We use essential cookies to maintain your session and authentication state. We may also use
                analytics cookies to understand how users interact with our Service. You can manage cookie
                preferences through your browser settings. Disabling essential cookies may affect the
                functionality of the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">8. Children&apos;s Privacy</h2>
              <p>
                The Service is not directed to children under 16. We do not knowingly collect personal
                information from children under 16. If we learn that we have collected personal data from a
                child under 16, we will take steps to delete that information promptly.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">9. International Data Transfers</h2>
              <p>
                Your data may be transferred to and processed in countries other than your country of
                residence. These countries may have different data protection laws. We ensure appropriate
                safeguards are in place, including Standard Contractual Clauses where required.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">10. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of any material
                changes by posting the new policy on this page and updating the &quot;Last updated&quot; date.
                Your continued use of the Service after changes become effective constitutes acceptance of
                the revised policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">11. Contact Us</h2>
              <p>
                If you have questions about this Privacy Policy or our data practices, please contact us at:
              </p>
              <div className="mt-2 rounded-lg border bg-gray-50 p-4 text-sm">
                <p><strong>Spatia</strong></p>
                <p>Email: <a href="mailto:privacy@spatia.app" className="text-emerald-600 hover:text-emerald-700 underline">privacy@spatia.app</a></p>
              </div>
            </section>
          </div>
        </article>
      </main>

      {/* Footer */}
      <footer className="border-t bg-gray-50 mt-auto">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Spatia. Immersive Spatial Platform.
        </div>
      </footer>
    </div>
  );
}
