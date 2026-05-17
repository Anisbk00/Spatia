import { SpatiaLogo } from "@/components/SpatiaLogo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Spatia",
  description: "Spatia Terms of Service. Read the terms that govern your use of Spatia's platform.",
};

const LAST_UPDATED = "May 12, 2026";

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>

          <div className="mt-10 space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">1. Acceptance of Terms</h2>
              <p>
                By accessing or using Spatia&apos;s website and services, you agree to be bound by these
                Terms of Service. If you do not agree to these Terms, you may not access or use the
                Service. These Terms apply to all visitors, users, and others who access or use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">2. Description of Service</h2>
              <p>
                Spatia provides an immersive spatial walkthrough platform that enables users to create,
                explore, and share interactive 3D property experiences. The Service includes web-based
                tools, analytics, and sharing features.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">3. Account Registration</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>You must register for an account to access certain features of the Service.</li>
                <li>You must provide accurate, current, and complete information during registration.</li>
                <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
                <li>You must notify us immediately of any unauthorized use of your account.</li>
                <li>You must be at least 16 years old to create an account.</li>
                <li>One person or entity may not maintain more than one free account.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">4. Acceptable Use</h2>
              <p>You agree not to use the Service to:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li>Violate any applicable law or regulation.</li>
                <li>Infringe upon the intellectual property rights of others.</li>
                <li>Upload content that is illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable.</li>
                <li>Attempt to gain unauthorized access to any portion of the Service or related systems.</li>
                <li>Use the Service for any unauthorized commercial solicitation.</li>
                <li>Interfere with or disrupt the Service or servers connected to the Service.</li>
                <li>Use automated tools (bots, scrapers) to access the Service without our prior written consent.</li>
                <li>Reverse-engineer, decompile, or disassemble any part of the Service.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">5. Your Content</h2>
              <p>
                You retain ownership of any content you upload to the Service, including property photos,
                3D scenes, and metadata. By uploading content, you grant Spatia a
                worldwide, non-exclusive, royalty-free license to process, store, and distribute your
                content solely for the purpose of providing the Service, including generating 3D
                scenes and enabling sharing features.
              </p>
              <p className="mt-2">
                You represent and warrant that you have all rights necessary to grant us this license and
                that your content does not violate any third-party rights.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">6. Intellectual Property</h2>
              <p>
                The Service and its original content (excluding your content), features, and functionality
                are and shall remain the exclusive property of Spatia and its licensors. The Service is
                protected by copyright, trademark, and other laws. Our trademarks and trade dress may not
                be used in connection with any product or service without prior written consent.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">7. Subscription and Payments</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>Certain features of the Service require a paid subscription.</li>
                <li>Subscription fees are billed in advance on a monthly or annual basis, depending on the plan selected.</li>
                <li>All fees are non-refundable except as expressly set forth in these Terms or required by applicable law.</li>
                <li>We reserve the right to change our pricing with 30 days&apos; advance notice. Price changes will take effect at the start of your next billing cycle.</li>
                <li>You may cancel your subscription at any time. Access to paid features will continue until the end of your current billing period.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">8. Service Availability</h2>
              <p>
                We strive to provide continuous, uninterrupted access to the Service but cannot guarantee
                it. We reserve the right to modify, suspend, or discontinue the Service (or any part
                thereof) at any time, including the availability of any feature, database, or content,
                with reasonable notice where feasible. We will not be liable for any modification,
                suspension, or discontinuance of the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">9. Termination</h2>
              <p>
                We may terminate or suspend your account immediately, without prior notice or liability,
                for any reason, including without limitation if you breach these Terms. Upon termination,
                your right to use the Service will immediately cease.
              </p>
              <p className="mt-2">
                You may delete your account at any time through your account settings. Upon account
                deletion, your personal data will be removed in accordance with our Privacy Policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">10. Limitation of Liability</h2>
              <p>
                In no event shall Spatia, its directors, employees, partners, agents, suppliers, or
                affiliates be liable for any indirect, incidental, special, consequential, or punitive
                damages, including without limitation loss of profits, data, use, goodwill, or other
                intangible losses, resulting from (a) your access to or use of or inability to access or
                use the Service; (b) any conduct or content of any third party on the Service; (c) any
                content obtained from the Service; or (d) unauthorized access, use, or alteration of
                your transmissions or content.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">11. Disclaimer</h2>
              <p>
                The Service is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis. Spatia expressly
                disclaims all warranties of any kind, whether express or implied, including but not
                limited to the implied warranties of merchantability, fitness for a particular purpose,
                and non-infringement. Spatia makes no warranty that the Service will meet your
                requirements, be uninterrupted, timely, secure, or error-free.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">12. Governing Law</h2>
              <p>
                These Terms shall be governed and construed in accordance with applicable laws, without
                regard to conflict of law provisions. Our failure to enforce any right or provision of
                these Terms will not be considered a waiver of those rights.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">13. Changes to Terms</h2>
              <p>
                We reserve the right to modify or replace these Terms at any time. If a revision is
                material, we will provide at least 30 days&apos; notice prior to any new terms taking effect.
                What constitutes a material change will be determined at our sole discretion. Your
                continued use of the Service after any changes constitutes acceptance of the new Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">14. Contact Us</h2>
              <p>
                If you have any questions about these Terms, please contact us at:
              </p>
              <div className="mt-2 rounded-lg border bg-gray-50 p-4 text-sm">
                <p><strong>Spatia</strong></p>
                <p>Email: <a href="mailto:legal@spatia.app" className="text-emerald-600 hover:text-emerald-700 underline">legal@spatia.app</a></p>
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
