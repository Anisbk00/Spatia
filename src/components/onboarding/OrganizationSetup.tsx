"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
import { Building2, ArrowRight, Loader2 } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "agent", label: "Real Estate Agent" },
  { value: "broker", label: "Broker" },
  { value: "manager", label: "Property Manager" },
  { value: "other", label: "Other" },
] as const;

interface OrganizationSetupProps {
  userId: string;
  userEmail: string;
  existingOrgId: string | null;
}

export function OrganizationSetup({
  userId,
  userEmail,
  existingOrgId,
}: OrganizationSetupProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [agencyName, setAgencyName] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // If user already has an org, skip to next step
  if (existingOrgId) {
    saveOnboardingState({
      currentStep: ONBOARDING_STEPS.FIRST_PROPERTY,
      completedSteps: [ONBOARDING_STEPS.WELCOME, ONBOARDING_STEPS.ORGANIZATION],
      orgId: existingOrgId,
    }).then(() => {
      router.push("/onboarding/first-property");
    });
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agencyName.trim()) {
      setFormError("Agency name is required");
      return;
    }
    if (!role) {
      setFormError("Please select your role");
      return;
    }

    setLoading(true);
    setFormError(null);

    try {
      if (supabase && userId) {
        // Generate a referral code
        let referralCode = "";
        try {
          const { data: rpcCode } = await supabase.rpc("generate_referral_code");
          referralCode = rpcCode || "";
        } catch {
          const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          const arr = new Uint8Array(8);
          crypto.getRandomValues(arr);
          referralCode = Array.from(arr, (b) => chars[b % chars.length]).join("");
        }

        // Create organization
        const { data: org, error: orgError } = await supabase
          .from("organizations")
          .insert({
            name: agencyName.trim(),
            owner_id: userId,
            plan: "free",
            referral_code: referralCode,
          })
          .select()
          .single();

        if (orgError) {
          console.error("[OrganizationSetup] Org creation error:", orgError);
          setFormError("Failed to create organization. Please try again.");
          setLoading(false);
          return;
        }

        // Create membership
        await supabase.from("organization_members").insert({
          org_id: org.id,
          user_id: userId,
          role: "owner",
        });

        // Update user role
        await supabase.from("users").update({ role: "agent" }).eq("id", userId);

        trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, {
          step: ONBOARDING_STEPS.ORGANIZATION,
          agency_name: agencyName,
          role,
        });

        await saveOnboardingState({
          currentStep: ONBOARDING_STEPS.FIRST_PROPERTY,
          completedSteps: [
            ONBOARDING_STEPS.WELCOME,
            ONBOARDING_STEPS.ORGANIZATION,
          ],
          orgId: org.id,
        });

        router.push("/onboarding/first-property");
      }
    } catch (err) {
      console.error("[OrganizationSetup] Submit error:", err);
      setFormError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-0 shadow-xl shadow-emerald-900/5">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
          <Building2 className="h-8 w-8 text-emerald-600" />
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight">
          Set up your agency
        </CardTitle>
        <CardDescription className="text-base">
          Tell us about your real estate business
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="agency-name" className="text-sm font-medium">
              Agency name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="agency-name"
              placeholder="e.g. Smith & Associates Realty"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              className="h-12 text-base"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Email address
            </Label>
            <Input
              id="email"
              type="email"
              value={userEmail}
              className="h-12 text-base bg-muted/50"
              disabled
            />
            <p className="text-xs text-muted-foreground">
              Pre-filled from your account
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role" className="text-sm font-medium">
              Your role <span className="text-destructive">*</span>
            </Label>
            <Select value={role} onValueChange={setRole} disabled={loading}>
              <SelectTrigger className="h-12 w-full text-base">
                <SelectValue placeholder="Select your role" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {formError && (
            <p className="text-sm text-destructive">{formError}</p>
          )}

          <Button
            type="submit"
            disabled={loading || !agencyName.trim() || !role}
            className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating organization...
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
