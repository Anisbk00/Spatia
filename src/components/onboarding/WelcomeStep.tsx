"use client";

import { motion } from "framer-motion";
import { Camera, Wand2, Eye, ArrowRight } from "lucide-react";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SpatiaLogo } from "@/components/SpatiaLogo";

// ============================================
// Types
// ============================================

interface WelcomeStepProps {
  onStart: () => void;
}

// ============================================
// Feature data
// ============================================

const features = [
  {
    icon: <Camera className="h-5 w-5" />,
    title: "Scan",
    desc: "Use your phone",
  },
  {
    icon: <Wand2 className="h-5 w-5" />,
    title: "Generate",
    desc: "AI-powered 3D",
  },
  {
    icon: <Eye className="h-5 w-5" />,
    title: "Share",
    desc: "Immersive tours",
  },
] as const;

// ============================================
// Animation variants
// ============================================

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.4, ease: "easeOut" as const },
  }),
};

// ============================================
// Component
// ============================================

export function WelcomeStep({ onStart }: WelcomeStepProps) {
  const handleStart = () => {
    trackEvent(EVENT_TYPES.ONBOARDING_STARTED, { step: 0 });
    onStart();
  };

  return (
    <Card className="border-0 shadow-xl shadow-emerald-900/5">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-6">
          <SpatiaLogo size="lg" />
        </div>
        <CardTitle className="text-3xl font-bold tracking-tight sm:text-4xl">
          Welcome to{" "}
          <span className="text-emerald-600">Spatia</span>
        </CardTitle>
        <CardDescription className="text-lg mt-3 max-w-sm mx-auto">
          Turn any property into an interactive 3D experience in minutes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-2">
        {/* Feature highlights */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="flex flex-col items-center gap-1.5 rounded-xl bg-emerald-50/60 p-4 text-center"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                {feature.icon}
              </div>
              <p className="text-sm font-semibold">{feature.title}</p>
              <p className="text-xs text-muted-foreground">{feature.desc}</p>
            </motion.div>
          ))}
        </div>

        <Button
          onClick={handleStart}
          className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
          size="lg"
        >
          Let&apos;s Get Started
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
