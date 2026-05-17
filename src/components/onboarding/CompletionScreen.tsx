"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";
import { markOnboardingComplete } from "@/lib/onboarding/onboardingState";
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
  ArrowRight,
  CheckCircle2,
  Loader2,
  PartyPopper,
  RotateCw,
} from "lucide-react";
import type { OnboardingState } from "@/lib/types";

interface CompletionScreenProps {
  userId: string;
  userEmail: string;
  orgId: string | null;
  onboardingState: OnboardingState | null;
  userRole: string; // "agent" | "client" | "admin"
}

export function CompletionScreen({
  userId,
  userEmail,
  orgId,
  onboardingState,
  userRole,
}: CompletionScreenProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const isClient = userRole === "client";
  const completedSteps = onboardingState?.completed_steps ?? [];
  const hasOrg = completedSteps.includes(ONBOARDING_STEPS.ORGANIZATION) || !!orgId;
  const hasProperty = completedSteps.includes(ONBOARDING_STEPS.FIRST_PROPERTY);

  const handleFinish = async () => {
    setLoading(true);

    trackEvent(EVENT_TYPES.ONBOARDING_COMPLETED, {
      step: ONBOARDING_STEPS.COMPLETION,
      property_created: hasProperty,
    });

    await markOnboardingComplete();

    // Use server-side redirect page for reliable role-based routing
    // (ensures session cookies are available and role is fresh from DB)
    window.location.href = "/auth/redirect";
  };

  return (
    <Card className="w-full max-w-md border-0 shadow-xl shadow-emerald-900/5">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-100">
          <PartyPopper className="h-10 w-10 text-emerald-600" />
        </div>
        <CardTitle className="text-3xl font-bold tracking-tight">
          You&apos;re all set!
        </CardTitle>
        <CardDescription className="text-lg mt-2">
          Your account is ready to go
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Accomplishments */}
        <div className="space-y-3 rounded-xl bg-emerald-50/60 p-4">
          <p className="text-sm font-semibold text-emerald-800 mb-3">
            What you&apos;ve accomplished:
          </p>

          {isClient ? (
            <>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <span className="text-sm">Account created ✓</span>
              </div>

              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <span className="text-sm">Learned how to explore properties ✓</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <span className="text-sm">Account created</span>
              </div>

              {hasOrg && (
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  <span className="text-sm">Agency set up</span>
                </div>
              )}

              {hasProperty ? (
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  <span className="text-sm">First property created</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <RotateCw className="h-5 w-5 text-amber-500 shrink-0" />
                  <span className="text-sm text-muted-foreground">
                    Go to dashboard to create your first property
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <span className="text-sm">Learned the capture process</span>
              </div>
            </>
          )}
        </div>

        {/* Contextual message */}
        {isClient ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-sm font-medium text-emerald-800">
              Start browsing properties and exploring 3D virtual tours!
            </p>
          </div>
        ) : hasProperty ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-sm font-medium text-emerald-800">
              🎉 Your first property is ready for capture!
            </p>
            <p className="text-xs text-emerald-600 mt-1">
              Open the capture tool on your phone to start scanning
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-sm font-medium text-amber-800">
              Create your first property to unlock 3D walkthroughs
            </p>
            <p className="text-xs text-amber-600 mt-1">
              It only takes a minute to add a listing
            </p>
          </div>
        )}

        <Button
          onClick={handleFinish}
          disabled={loading}
          className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Finishing up...
            </>
          ) : (
            <>
              {isClient ? "Start Exploring" : "Go to Dashboard"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
