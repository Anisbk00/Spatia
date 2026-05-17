"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";
import { saveOnboardingState } from "@/lib/onboarding/onboardingState";
import { ONBOARDING_STEPS } from "@/lib/onboarding/onboardingState";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Smartphone,
  ArrowRight,
  Camera,
  Upload,
  Wand2,
  Search,
  Eye,
  Calendar,
  BarChart3,
} from "lucide-react";

interface TutorialFlowProps {
  userId: string;
  userRole: string; // "agent" | "client" | "admin"
}

const agentSteps = [
  {
    step: 1,
    icon: <Smartphone className="h-5 w-5" />,
    title: "Open the app on your phone",
    desc: "Access the capture tool from any mobile browser — no download required",
    color: "bg-emerald-100 text-emerald-600",
  },
  {
    step: 2,
    icon: <Camera className="h-5 w-5" />,
    title: "Scan each room",
    desc: "Follow guided instructions to photograph every angle of the space",
    color: "bg-teal-100 text-teal-600",
  },
  {
    step: 3,
    icon: <Upload className="h-5 w-5" />,
    title: "Photos upload automatically",
    desc: "Images are securely uploaded and processed in the background",
    color: "bg-cyan-100 text-cyan-600",
  },
  {
    step: 4,
    icon: <Wand2 className="h-5 w-5" />,
    title: "3D scene generates",
    desc: "Our AI transforms your photos into an interactive 3D walkthrough",
    color: "bg-emerald-100 text-emerald-700",
  },
];

const clientSteps = [
  {
    step: 1,
    icon: <Search className="h-5 w-5" />,
    title: "Browse properties",
    desc: "Search through verified listings with detailed information and photos",
    color: "bg-emerald-100 text-emerald-600",
  },
  {
    step: 2,
    icon: <Eye className="h-5 w-5" />,
    title: "3D Virtual Tours",
    desc: "Experience immersive 3D walkthroughs from any device — no app needed",
    color: "bg-teal-100 text-teal-600",
  },
  {
    step: 3,
    icon: <Calendar className="h-5 w-5" />,
    title: "Schedule viewings",
    desc: "Book in-person visits directly through the platform",
    color: "bg-cyan-100 text-cyan-600",
  },
  {
    step: 4,
    icon: <BarChart3 className="h-5 w-5" />,
    title: "Compare & decide",
    desc: "Compare properties side-by-side with all the details that matter",
    color: "bg-emerald-100 text-emerald-700",
  },
];

export function TutorialFlow({ userId, userRole }: TutorialFlowProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const isClient = userRole === "client";
  const steps = isClient ? clientSteps : agentSteps;
  const tutorialTitle = isClient
    ? "How to explore properties"
    : "How capture works";
  const tutorialDesc = isClient
    ? "Discover and evaluate properties in four simple steps"
    : "Create stunning 3D walkthroughs in four simple steps";

  const handleComplete = async () => {
    setLoading(true);

    trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, {
      step: ONBOARDING_STEPS.TUTORIAL,
    });

    const completedStepsForRole = isClient
      ? [ONBOARDING_STEPS.WELCOME, ONBOARDING_STEPS.TUTORIAL]
      : [
          ONBOARDING_STEPS.WELCOME,
          ONBOARDING_STEPS.ORGANIZATION,
          ONBOARDING_STEPS.FIRST_PROPERTY,
          ONBOARDING_STEPS.TUTORIAL,
        ];

    await saveOnboardingState({
      currentStep: ONBOARDING_STEPS.COMPLETION,
      completedSteps: completedStepsForRole,
    });

    router.push("/onboarding/completion");
  };

  return (
    <Card className="w-full max-w-md border-0 shadow-xl shadow-emerald-900/5">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
          {isClient ? (
            <Search className="h-8 w-8 text-emerald-600" />
          ) : (
            <Smartphone className="h-8 w-8 text-emerald-600" />
          )}
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight">
          {tutorialTitle}
        </CardTitle>
        <CardDescription className="text-base">{tutorialDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map((item) => (
          <div
            key={item.step}
            className="flex items-start gap-4 rounded-xl border border-emerald-100 bg-white p-4"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-bold">
              {item.step}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-md ${item.color}`}
                >
                  {item.icon}
                </span>
                <p className="text-sm font-semibold">{item.title}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {item.desc}
              </p>
            </div>
          </div>
        ))}

        <Button
          onClick={handleComplete}
          disabled={loading}
          className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700 mt-2"
        >
          Got it!
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
