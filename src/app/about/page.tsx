import { SpatiaLogo } from "@/components/SpatiaLogo";
import { Button } from "@/components/ui/button";
import { ArrowRight, Building2, Rotate3d, Users } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Spatia",
  description:
    "Learn about Spatia — the phone-to-3D platform turning real estate properties into immersive spatial walkthroughs.",
};

const VALUES = [
  {
    icon: Rotate3d,
    title: "Spatial Intelligence",
    desc: "We believe every space deserves to be experienced, not just photographed. Our 3D technology bridges the gap between physical properties and digital exploration.",
  },
  {
    icon: Building2,
    title: "Built for Real Estate",
    desc: "Every feature is designed around how agents, brokers, and agencies actually work — from capture to client delivery.",
  },
  {
    icon: Users,
    title: "Accessible to Everyone",
    desc: "No special equipment, no training, no expensive hardware. If you have a phone, you have a 3D scanner.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
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

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/40" />
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-16 sm:pt-24 sm:pb-20 text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 leading-[1.1]">
            Making Every Property{" "}
            <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              Explorable
            </span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-gray-600 leading-relaxed max-w-2xl mx-auto">
            Spatia is the phone-to-3D platform that turns any real estate property into an
            immersive spatial walkthrough — no special equipment, no complex software, just your phone.
          </p>
          <div className="mt-8">
            <Button
              asChild
              size="lg"
              className="h-14 px-8 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20"
            >
              <a href="/auth/login">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="py-20 sm:py-28 bg-gray-50/50">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-600 mb-2">
            Our Story
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 mb-6">
            Real estate deserves better than flat photos
          </h2>
          <div className="space-y-4 text-gray-700 leading-relaxed text-lg">
            <p>
              For decades, real estate professionals have relied on static photos and video tours to
              showcase properties. But photos can&apos;t convey the feeling of walking through a space — the
              flow between rooms, the proportions, the natural light at different times of day.
            </p>
            <p>
              Professional 3D scanning solutions exist, but they require expensive dedicated hardware
              and specialized operators. That puts immersive walkthroughs out of reach for most agents
              and agencies, especially those managing a large volume of properties.
            </p>
            <p>
              Spatia changes that. By combining advanced Gaussian Splat technology with a guided
              mobile capture flow, we&apos;ve made it possible to create professional-quality 3D walkthroughs
              using nothing more than the phone in your pocket. Capture, generate, share — in minutes,
              not days.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-600 mb-2 text-center">
            What Drives Us
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 mb-12 text-center">
            Our core principles
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {VALUES.map((val) => (
              <div
                key={val.title}
                className="rounded-2xl border border-gray-200/80 p-8 hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-600/5 transition-all duration-300"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <val.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{val.title}</h3>
                <p className="text-gray-600 leading-relaxed">{val.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 sm:py-28 bg-gradient-to-br from-emerald-50 via-white to-teal-50/40">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900">
            Ready to transform your listings?
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            Join thousands of real estate professionals already using Spatia to create immersive 3D
            property experiences.
          </p>
          <div className="mt-8">
            <Button
              asChild
              size="lg"
              className="h-14 px-10 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20"
            >
              <a href="/auth/login">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-gray-50 mt-auto">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Spatia. Immersive Spatial Platform.
        </div>
      </footer>
    </div>
  );
}
