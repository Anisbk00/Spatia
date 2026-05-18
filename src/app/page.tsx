"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SpatiaLogo } from "@/components/SpatiaLogo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Camera,
  ArrowRight,
  Sparkles,
  Play,
  Smartphone,
  Brain,
  Share2,
  Wifi,
  Monitor,
  Zap,
  ChevronRight,
  Star,
  Quote,
} from "lucide-react";

// ─── Analytics Hook ────────────────────────────────────────────────────────────
function useLandingAnalytics() {
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    // Fire-and-forget analytics event (public endpoint, no auth required)
    fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            event_type: "LANDING_PAGE_VIEW",
            metadata: { page: "landing", referrer: document.referrer || "direct" },
            device_type: /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop",
          },
        ],
      }),
    }).catch(() => {
      /* Analytics should never block UX */
    });
  }, []);

  const trackCta = useCallback((ctaName: string) => {
    fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            event_type: "CTA_CLICK",
            metadata: { cta: ctaName, page: "landing" },
            device_type: /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop",
          },
        ],
      }),
    }).catch(() => {});
  }, []);

  const trackSignupStarted = useCallback(() => {
    fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            event_type: "SIGNUP_STARTED",
            metadata: { page: "landing" },
            device_type: /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop",
          },
        ],
      }),
    }).catch(() => {});
  }, []);

  return { trackCta, trackSignupStarted };
}

// ─── Animated Section (intersection observer, no ref leakage) ────────────────
function AnimatedSection({
  children,
  className = "",
  ariaLabel,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const [isInView, setIsInView] = useState(false);
  const sectionRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.unobserve(node);
        }
      },
      { threshold: 0.12 }
    );
    observer.observe(node);
  }, []);

  return (
    <section
      id={id}
      ref={sectionRef}
      className={`transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
      aria-label={ariaLabel}
    >
      {children}
    </section>
  );
}

// ─── Main Landing Page Component ───────────────────────────────────────────────
export default function LandingPage() {
  const router = useRouter();
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const { trackCta, trackSignupStarted } = useLandingAnalytics();

  const handlePrimaryCta = useCallback(() => {
    trackSignupStarted();
    trackCta("start_free");
    router.push("/auth/signup");
  }, [router, trackCta, trackSignupStarted]);

  const handleSecondaryCta = useCallback(() => {
    trackCta("watch_demo");
    router.push("/explore");
  }, [router, trackCta]);

  const handleCtaButton = useCallback(() => {
    trackSignupStarted();
    trackCta("cta_bottom");
    router.push("/auth/signup");
  }, [router, trackCta, trackSignupStarted]);

  return (
    <div className="min-h-screen flex flex-col bg-background" style={{ scrollBehavior: "smooth" }}>
      {/* ─── HERO SECTION ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b" aria-label="Hero">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 via-background to-emerald-50/30 dark:from-emerald-950/20 dark:via-background dark:to-emerald-950/10 pointer-events-none" />
        {/* Subtle dot pattern */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, #059669 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24 lg:py-32">
          <div className="max-w-3xl">
            <Badge
              variant="secondary"
              className="mb-6 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900"
            >
              <Sparkles className="me-1.5 h-3.5 w-3.5" />
              {t("badge")}
            </Badge>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] text-foreground">
              {t("heroHeadline")}
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl">
              {t("heroSubheadline")}
            </p>

            <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Button
                size="lg"
                className="h-12 sm:h-13 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 px-8"
                onClick={handlePrimaryCta}
              >
                {t("heroPrimaryCta")}
                <ArrowRight className="ms-2 h-4.5 w-4.5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 sm:h-13 text-base font-medium"
                onClick={handleSecondaryCta}
              >
                <Play className="me-2 h-4 w-4" />
                {t("heroSecondaryCta")}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ─── INTERACTIVE DEMO PREVIEW ────────────────────────────────────────── */}
      <AnimatedSection id="demo" className="border-b" ariaLabel="Demo Preview">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-10">
            <Badge variant="outline" className="mb-4">
              {t("demoBadge")}
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {t("demoTitle")}
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              {t("demoSubtitle")}
            </p>
          </div>

          {/* 3D Viewer Preview Card — CSS perspective room */}
          <div className="relative rounded-2xl border bg-card overflow-hidden shadow-2xl max-w-4xl mx-auto aspect-video">
            {/* Simulated 3D room using CSS perspective */}
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-950/60">
              <div className="relative w-full h-full" style={{ perspective: "800px" }}>
                {/* Floor plane */}
                <div
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[140%] h-[55%]"
                  style={{
                    transform: "rotateX(65deg)",
                    transformOrigin: "bottom center",
                    background: "linear-gradient(180deg, rgba(5,150,105,0.08) 0%, rgba(5,150,105,0.15) 100%)",
                    backgroundImage: "repeating-linear-gradient(90deg, rgba(5,150,105,0.12) 0px, rgba(5,150,105,0.12) 1px, transparent 1px, transparent 60px), repeating-linear-gradient(0deg, rgba(5,150,105,0.12) 0px, rgba(5,150,105,0.12) 1px, transparent 1px, transparent 60px)",
                  }}
                />
                {/* Back wall */}
                <div
                  className="absolute top-[5%] left-1/2 -translate-x-1/2 w-[70%] h-[50%] rounded-t-lg"
                  style={{
                    background: "linear-gradient(180deg, rgba(5,150,105,0.06) 0%, rgba(5,150,105,0.03) 100%)",
                    border: "1px solid rgba(5,150,105,0.1)",
                    borderBottom: "none",
                  }}
                >
                  {/* Window on back wall */}
                  <div className="absolute top-[15%] left-1/2 -translate-x-1/2 w-[35%] h-[55%] rounded-md bg-gradient-to-b from-sky-200/60 to-sky-100/40 dark:from-sky-900/30 dark:to-sky-800/20 border border-emerald-200/30 dark:border-emerald-800/20">
                    <div className="absolute inset-[6px] rounded-sm bg-gradient-to-b from-sky-100/80 to-white/40 dark:from-sky-900/20 dark:to-sky-800/10">
                      {/* Window cross */}
                      <div className="absolute top-1/2 -translate-y-1/2 w-full h-px bg-emerald-200/40 dark:bg-emerald-800/30" />
                      <div className="absolute left-1/2 -translate-x-1/2 h-full w-px bg-emerald-200/40 dark:bg-emerald-800/30" />
                    </div>
                  </div>
                </div>
                {/* Left wall */}
                <div
                  className="absolute top-[5%] left-0 w-[18%] h-[50%]"
                  style={{
                    background: "linear-gradient(90deg, rgba(5,150,105,0.1) 0%, rgba(5,150,105,0.04) 100%)",
                    borderRight: "1px solid rgba(5,150,105,0.08)",
                    borderRadius: "4px 0 0 0",
                  }}
                />
                {/* Right wall */}
                <div
                  className="absolute top-[5%] right-0 w-[18%] h-[50%]"
                  style={{
                    background: "linear-gradient(-90deg, rgba(5,150,105,0.1) 0%, rgba(5,150,105,0.04) 100%)",
                    borderLeft: "1px solid rgba(5,150,105,0.08)",
                    borderRadius: "0 4px 0 0",
                  }}
                />
                {/* Furniture silhouettes */}
                {/* Table */}
                <div className="absolute bottom-[42%] left-1/2 -translate-x-1/2 w-[18%] h-[8%]">
                  <div className="w-full h-[40%] bg-emerald-600/10 dark:bg-emerald-400/10 rounded-sm" />
                  <div className="absolute top-[40%] left-[10%] w-[2px] h-[60%] bg-emerald-600/10 dark:bg-emerald-400/10" />
                  <div className="absolute top-[40%] right-[10%] w-[2px] h-[60%] bg-emerald-600/10 dark:bg-emerald-400/10" />
                </div>
                {/* Plant */}
                <div className="absolute bottom-[42%] right-[22%] flex flex-col items-center">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/15 dark:bg-emerald-400/15" />
                  <div className="w-4 h-4 -mt-2 rounded-full bg-emerald-500/12 dark:bg-emerald-400/12" />
                  <div className="w-1 h-3 bg-emerald-600/10 dark:bg-emerald-400/10 rounded-full" />
                  <div className="w-3 h-2 bg-emerald-600/8 dark:bg-emerald-400/8 rounded-sm" />
                </div>
                {/* Couch */}
                <div className="absolute bottom-[42%] left-[20%] w-[20%] h-[6%]">
                  <div className="w-full h-full bg-emerald-600/8 dark:bg-emerald-400/8 rounded-t-md" />
                  <div className="absolute -top-[60%] left-0 w-full h-[65%] bg-emerald-600/6 dark:bg-emerald-400/6 rounded-t-md" />
                </div>
              </div>
            </div>

            {/* Overlay badge — bottom left */}
            <div className="absolute bottom-4 start-4 sm:bottom-6 sm:start-6">
              <div className="bg-background/90 backdrop-blur-sm rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 border shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-xs sm:text-sm font-medium text-muted-foreground">
                    3D Walkthrough — Ready
                  </span>
                </div>
              </div>
            </div>

            {/* Top-right FPS counter */}
            <div className="absolute top-4 end-4 sm:top-6 sm:end-6">
              <div className="bg-background/90 backdrop-blur-sm rounded-md px-2 py-1 border shadow-sm">
                <span className="text-xs font-mono text-muted-foreground">60 FPS</span>
              </div>
            </div>

            {/* Click to explore hint */}
            <div className="absolute top-4 start-4 sm:top-6 sm:start-6">
              <div className="bg-emerald-600/90 backdrop-blur-sm rounded-md px-3 py-1.5">
                <span className="text-xs font-medium text-white">Click & drag to explore</span>
              </div>
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* ─── HOW IT WORKS ───────────────────────────────────────────────────── */}
      <AnimatedSection id="how-it-works" className="border-b bg-muted/30" ariaLabel="How It Works">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {t("howItWorksTitle")}
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
              {t("howItWorksSubtitle")}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-6">
            {[
              {
                icon: Camera,
                title: t("step1Title"),
                desc: t("step1Desc"),
                step: "1",
                color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
              },
              {
                icon: Brain,
                title: t("step2Title"),
                desc: t("step2Desc"),
                step: "2",
                color: "bg-teal-100 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",
              },
              {
                icon: Share2,
                title: t("step3Title"),
                desc: t("step3Desc"),
                step: "3",
                color: "bg-cyan-100 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="relative flex flex-col items-center text-center">
                  {/* Connector line (hidden on mobile) */}
                  {i < 2 && (
                    <div className="hidden md:block absolute top-10 start-[calc(50%+3rem)] w-[calc(100%-6rem)] h-px bg-border" />
                  )}
                  <div className={`flex h-20 w-20 items-center justify-center rounded-2xl ${item.color} mb-5 relative z-10`}>
                    <Icon className="h-9 w-9" />
                    <span className="absolute -top-2 -end-2 flex h-6 w-6 items-center justify-center rounded-full bg-background border text-xs font-bold text-foreground">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </AnimatedSection>

      {/* ─── FEATURES ───────────────────────────────────────────────────────── */}
      <AnimatedSection id="features" className="border-b" ariaLabel="Features">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {t("featuresTitle")}
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
              {t("featuresSubtitle")}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Smartphone, titleKey: "feature1Title", descKey: "feature1Desc", color: "text-emerald-600 dark:text-emerald-400" },
              { icon: Brain, titleKey: "feature2Title", descKey: "feature2Desc", color: "text-teal-600 dark:text-teal-400" },
              { icon: Share2, titleKey: "feature3Title", descKey: "feature3Desc", color: "text-cyan-600 dark:text-cyan-400" },
              { icon: Wifi, titleKey: "feature4Title", descKey: "feature4Desc", color: "text-emerald-600 dark:text-emerald-400" },
              { icon: Monitor, titleKey: "feature5Title", descKey: "feature5Desc", color: "text-teal-600 dark:text-teal-400" },
              { icon: Zap, titleKey: "feature6Title", descKey: "feature6Desc", color: "text-cyan-600 dark:text-cyan-400" },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className="group rounded-xl border bg-card p-6 hover:shadow-md transition-shadow"
                >
                  <div className={`mb-4 ${item.color}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold mb-1.5">{t(item.titleKey as Parameters<typeof t>[0])}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t(item.descKey as Parameters<typeof t>[0])}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </AnimatedSection>

      {/* ─── SOCIAL PROOF ───────────────────────────────────────────────────── */}
      <AnimatedSection id="social-proof" className="border-b bg-muted/30" ariaLabel="Social Proof">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {t("socialProofTitle")}
            </h2>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-3 gap-4 sm:gap-8 max-w-2xl mx-auto mb-12">
            {[
              { value: t("metric1Value"), label: t("metric1Label") },
              { value: t("metric2Value"), label: t("metric2Label") },
              { value: t("metric3Value"), label: t("metric3Label") },
            ].map((metric, i) => (
              <div key={i} className="text-center">
                <div className="text-2xl sm:text-4xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                  {metric.value}
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {metric.label}
                </div>
              </div>
            ))}
          </div>

          {/* Testimonials */}
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                name: t("testimonial1Name"),
                role: t("testimonial1Role"),
                quote: t("testimonial1Quote"),
              },
              {
                name: t("testimonial2Name"),
                role: t("testimonial2Role"),
                quote: t("testimonial2Quote"),
              },
              {
                name: t("testimonial3Name"),
                role: t("testimonial3Role"),
                quote: t("testimonial3Quote"),
              },
            ].map((testimonial, i) => (
              <div
                key={i}
                className="rounded-xl border bg-card p-6 flex flex-col"
              >
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-emerald-500 text-emerald-500" />
                  ))}
                </div>
                <div className="mb-4 flex-1">
                  <Quote className="h-5 w-5 text-muted-foreground/40 mb-2 rotate-180" />
                  <p className="text-sm text-muted-foreground leading-relaxed italic">
                    &ldquo;{testimonial.quote}&rdquo;
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-4 border-t">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white font-semibold text-sm">
                    {testimonial.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{testimonial.name}</div>
                    <div className="text-xs text-muted-foreground">{testimonial.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      {/* ─── PRICING ─────────────────────────────────────────────────────── */}
      <AnimatedSection id="pricing" className="border-b bg-muted/30" ariaLabel="Pricing">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {t("pricingTitle")}
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
              {t("pricingSubtitle")}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              {
                name: t("plan1Name"),
                price: t("plan1Price"),
                period: t("plan1Period"),
                desc: t("plan1Desc"),
                features: [t("plan1Feature1"), t("plan1Feature2"), t("plan1Feature3")],
                cta: t("plan1Cta"),
                highlighted: false,
              },
              {
                name: t("plan2Name"),
                price: t("plan2Price"),
                period: t("plan2Period"),
                desc: t("plan2Desc"),
                features: [t("plan2Feature1"), t("plan2Feature2"), t("plan2Feature3"), t("plan2Feature4")],
                cta: t("plan2Cta"),
                highlighted: true,
              },
              {
                name: t("plan3Name"),
                price: t("plan3Price"),
                period: t("plan3Period"),
                desc: t("plan3Desc"),
                features: [t("plan3Feature1"), t("plan3Feature2"), t("plan3Feature3"), t("plan3Feature4")],
                cta: t("plan3Cta"),
                highlighted: false,
              },
            ].map((plan, i) => (
              <div
                key={i}
                className={`relative rounded-xl border p-6 flex flex-col ${plan.highlighted ? "border-emerald-500 shadow-lg shadow-emerald-500/10 bg-card" : "bg-card"}`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-emerald-600 text-white border-0 text-xs">{t("popularBadge")}</Badge>
                  </div>
                )}
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{plan.desc}</p>
                <ul className="mt-6 space-y-3 flex-1">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm">
                      <svg className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className={`mt-6 w-full ${plan.highlighted ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                  variant={plan.highlighted ? "default" : "outline"}
                  onClick={handlePrimaryCta}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      {/* ─── CTA SECTION ─────────────────────────────────────────────────────── */}
      <AnimatedSection className="border-b" ariaLabel="Call to Action">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="relative rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-8 sm:p-12 lg:p-16 text-center overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.1),transparent_50%)] pointer-events-none" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.05),transparent_40%)] pointer-events-none" />

            <div className="relative">
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight">
                {t("ctaTitle")}
              </h2>
              <p className="mt-4 text-emerald-100 max-w-lg mx-auto text-base sm:text-lg">
                {t("ctaSubtitle")}
              </p>
              <div className="mt-8">
                <Button
                  size="lg"
                  className="h-13 text-base font-semibold bg-white text-emerald-700 hover:bg-emerald-50 shadow-lg px-8"
                  onClick={handleCtaButton}
                >
                  {t("ctaButton")}
                  <ChevronRight className="ms-1.5 h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* ─── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <SpatiaLogo size="sm" />
                <span className="font-semibold tracking-tight">{tc("appName")}</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
                {t("footerDescription")}
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-sm font-semibold mb-3">{t("footerProduct")}</h4>
              <ul className="space-y-2">
                <li>
                  <a href="/explore" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t("footerExplore")}
                  </a>
                </li>
                <li>
                  <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t("footerFeatures")}
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t("footerPricing")}
                  </a>
                </li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-sm font-semibold mb-3">{t("footerCompany")}</h4>
              <ul className="space-y-2">
                <li>
                  <a href="/about" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t("footerAbout")}
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-sm font-semibold mb-3">{t("footerLegal")}</h4>
              <ul className="space-y-2">
                <li>
                  <a href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t("footerPrivacy")}
                  </a>
                </li>
                <li>
                  <a href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t("footerTerms")}
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {t("footerCopyright", { year: new Date().getFullYear() })}
            </p>
            <div className="flex items-center gap-3">
              {/* Social placeholders */}
              <span className="text-xs text-muted-foreground/60">Twitter</span>
              <span className="text-xs text-muted-foreground/60">LinkedIn</span>
              <span className="text-xs text-muted-foreground/60">GitHub</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
