"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";
import { saveOnboardingState } from "@/lib/onboarding/onboardingState";
import { ONBOARDING_STEPS } from "@/lib/onboarding/onboardingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Home,
  ArrowRight,
  Loader2,
  SkipForward,
} from "lucide-react";

const PROPERTY_TYPES = [
  { value: "apartment", label: "Apartment" },
  { value: "house", label: "House" },
  { value: "villa", label: "Villa" },
  { value: "office", label: "Office" },
  { value: "land", label: "Land" },
] as const;

interface FirstPropertySetupProps {
  userId: string;
  orgId: string;
}

export function FirstPropertySetup({
  userId,
  orgId,
}: FirstPropertySetupProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [propertyTitle, setPropertyTitle] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyTitle.trim()) {
      setFormError("Property title is required");
      return;
    }

    setLoading(true);
    setFormError(null);

    try {
      const res = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: propertyTitle.trim(),
          property_type: propertyType || undefined,
          address: propertyAddress.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const errorMsg = data?.error || "Failed to create property. Please try again.";
        setFormError(errorMsg);
        return;
      }

      trackEvent(EVENT_TYPES.FIRST_PROPERTY_CREATED, {
        step: ONBOARDING_STEPS.FIRST_PROPERTY,
      });

      trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, {
        step: ONBOARDING_STEPS.FIRST_PROPERTY,
      });

      await saveOnboardingState({
        currentStep: ONBOARDING_STEPS.TUTORIAL,
        completedSteps: [
          ONBOARDING_STEPS.WELCOME,
          ONBOARDING_STEPS.ORGANIZATION,
          ONBOARDING_STEPS.FIRST_PROPERTY,
        ],
        orgId,
      });

      router.push("/onboarding/tutorial");
    } catch (err) {
      console.error("[FirstPropertySetup] Submit error:", err);
      setFormError("Failed to create property. You can try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, {
      step: ONBOARDING_STEPS.FIRST_PROPERTY,
      skipped: true,
    });

    await saveOnboardingState({
      currentStep: ONBOARDING_STEPS.TUTORIAL,
      completedSteps: [
        ONBOARDING_STEPS.WELCOME,
        ONBOARDING_STEPS.ORGANIZATION,
        ONBOARDING_STEPS.FIRST_PROPERTY,
      ],
      orgId,
      skipped: true,
    });

    router.push("/onboarding/tutorial");
  };

  return (
    <Card className="w-full max-w-md border-0 shadow-xl shadow-emerald-900/5">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
          <Home className="h-8 w-8 text-emerald-600" />
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight">
          Create your first listing
        </CardTitle>
        <CardDescription className="text-base">
          Add a property to get started right away
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="property-title" className="text-sm font-medium">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="property-title"
              placeholder="e.g. Modern Downtown Loft"
              value={propertyTitle}
              onChange={(e) => setPropertyTitle(e.target.value)}
              className="h-12 text-base"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="property-type" className="text-sm font-medium">
              Property type
            </Label>
            <Select
              value={propertyType}
              onValueChange={setPropertyType}
              disabled={loading}
            >
              <SelectTrigger className="h-12 w-full text-base">
                <SelectValue placeholder="Select property type" />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_TYPES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="property-address" className="text-sm font-medium">
              Address
            </Label>
            <Input
              id="property-address"
              placeholder="e.g. 123 Main St, New York, NY"
              value={propertyAddress}
              onChange={(e) => setPropertyAddress(e.target.value)}
              className="h-12 text-base"
              disabled={loading}
            />
          </div>

          {formError && (
            <p className="text-sm text-destructive">{formError}</p>
          )}

          <Button
            type="submit"
            disabled={loading || !propertyTitle.trim()}
            className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating listing...
              </>
            ) : (
              <>
                Create My First Listing
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>

          <button
            type="button"
            onClick={handleSkip}
            disabled={loading}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-2 flex items-center justify-center gap-1.5"
          >
            <SkipForward className="h-4 w-4" />
            I&apos;ll do this later
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
