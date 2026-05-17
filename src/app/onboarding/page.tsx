"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Home,
  Sparkles,
  Building2,
  ArrowRight,
  Loader2,
  Smartphone,
  Camera,
  Upload,
  Wand2,
  CheckCircle2,
  RotateCw,
  PartyPopper,
  Eye,
  SkipForward,
  AlertTriangle,
  Search,
  Calendar,
  GitCompareArrows,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { SpatiaLogo } from "@/components/SpatiaLogo";

// ============================================
// Constants
// ============================================

const TOTAL_STEPS = 5; // Steps 0-4

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
  }),
};

const PROPERTY_TYPES = [
  { value: "apartment", label: "Apartment" },
  { value: "house", label: "House" },
  { value: "villa", label: "Villa" },
  { value: "office", label: "Office" },
  { value: "land", label: "Land" },
] as const;

const ROLE_OPTIONS = [
  { value: "agent", label: "Real Estate Agent" },
  { value: "broker", label: "Broker" },
  { value: "manager", label: "Property Manager" },
  { value: "other", label: "Other" },
] as const;

// ============================================
// Main Component
// ============================================

export default function OnboardingPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [direction, setDirection] = useState(1);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [propertyCreated, setPropertyCreated] = useState(false);

  // Role selection state
  const [userRole, setUserRole] = useState<"agent" | "client" | null>(null);

  // Auth state
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [orgId, setOrgId] = useState<string | null>(null);

  // Form state
  const [agencyName, setAgencyName] = useState("");
  const [role, setRole] = useState("");
  const [propertyTitle, setPropertyTitle] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // ============================================
  // Initialize: check auth + existing onboarding
  // ============================================

  useEffect(() => {
    async function init() {
      if (!supabase) {
        setInitializing(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth/login");
        return;
      }

      setUserId(user.id);
      setUserEmail(user.email ?? "");

      // Set tracking context
      const tracker = (await import("@/lib/event-tracking")).EventTracker.getInstance();
      tracker.setContext(user.id, "");

      // Check existing onboarding state
      try {
        const res = await fetch("/api/onboarding");
        if (res.ok) {
          const data = await res.json();
          if (data.state) {
            if (data.state.is_completed) {
              router.push("/dashboard");
              return;
            }
            setCurrentStep(data.state.current_step ?? 0);
            setCompletedSteps(data.state.completed_steps ?? []);
            if (data.state.org_id) {
              setOrgId(data.state.org_id);
            }
            // Detect role from completed steps — if on step 3+ but steps 1-2 not completed, user is a client
            const steps = data.state.completed_steps ?? [];
            if (!steps.includes(1) && !steps.includes(2) && (data.state.current_step ?? 0) >= 3) {
              setUserRole("client");
            } else if (steps.includes(1)) {
              setUserRole("agent");
            }
          }
        }
      } catch (err) {
        console.error("[Onboarding] Failed to fetch onboarding state:", err);
      }

      setInitializing(false);
    }

    init();
  }, [supabase, router]);

  // ============================================
  // Helpers
  // ============================================

  const saveOnboardingState = useCallback(
    async (step: number, completed: number[], extra?: { org_id?: string; is_completed?: boolean; skipped?: boolean; metadata?: Record<string, string> }) => {
      try {
        await fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_step: step,
            completed_steps: completed,
            org_id: extra?.org_id ?? orgId,
            is_completed: extra?.is_completed ?? false,
            skipped: extra?.skipped ?? false,
            metadata: extra?.metadata,
          }),
        });
      } catch (err) {
        console.error("[Onboarding] Failed to save onboarding state:", err);
      }
    },
    [orgId]
  );

  const goToStep = useCallback(
    (step: number) => {
      setDirection(step > currentStep ? 1 : -1);
      setCurrentStep(step);
    },
    [currentStep]
  );

  const completeStep = useCallback(
    async (step: number) => {
      const newCompleted = Array.from(new Set([...completedSteps, step])).sort();
      setCompletedSteps(newCompleted);
      const nextStep = step + 1;
      goToStep(nextStep);
      await saveOnboardingState(nextStep, newCompleted);
    },
    [completedSteps, goToStep, saveOnboardingState]
  );

  // ============================================
  // Step handlers
  // ============================================

  const handleRoleSelect = async (selectedRole: "agent" | "client") => {
    setUserRole(selectedRole);
    trackEvent(EVENT_TYPES.ONBOARDING_STARTED, { step: 0, role: selectedRole });

    if (selectedRole === "agent") {
      await saveOnboardingState(0, [0]);
      setCompletedSteps([0]);
      goToStep(1);
    } else {
      // Client: update role to "client" in the database, skip org setup and property creation
      if (supabase && userId) {
        await supabase
          .from("users")
          .update({ role: "client" })
          .eq("id", userId);
      }
      await saveOnboardingState(3, [0], { metadata: { role: "client" } });
      setCompletedSteps([0]);
      goToStep(3);
    }
  };

  const handleOrgSubmit = async (e: React.FormEvent) => {
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
        // Generate a referral code using the database RPC
        let referralCode = "";
        try {
          const { data: rpcCode } = await supabase.rpc("generate_referral_code");
          referralCode = rpcCode || "";
        } catch (err) {
          console.error("[Onboarding] Referral code RPC failed, using fallback:", err);
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
          console.error("Org creation error:", orgError);
          setFormError("Failed to create organization. Please try again.");
          setLoading(false);
          return;
        }

        setOrgId(org.id);

        // Create membership
        const { error: memberError } = await supabase
          .from("organization_members")
          .insert({
            org_id: org.id,
            user_id: userId,
            role: "owner",
          });

        if (memberError) {
          console.error("Member creation error:", memberError);
        }

        // Update user role to agent
        await supabase
          .from("users")
          .update({ role: "agent" })
          .eq("id", userId);
      }

      trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, { step: 1, agency_name: agencyName, role });
      await completeStep(1);
    } catch (err) {
      console.error("Org submit error:", err);
      setFormError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePropertySubmit = async (e: React.FormEvent) => {
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

      if (res.ok) {
        setPropertyCreated(true);
        trackEvent(EVENT_TYPES.FIRST_PROPERTY_CREATED, { step: 2 });
      } else {
        const data = await res.json();
        console.error("Property creation error:", data);
      }

      trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, { step: 2 });
      await completeStep(2);
    } catch (err) {
      console.error("Property submit error:", err);
      setFormError("Failed to create property. You can try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipProperty = async () => {
    trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, { step: 2, skipped: true });
    await completeStep(2);
  };

  const handleTutorialComplete = async () => {
    trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, { step: 3 });
    await completeStep(3);
  };

  const handleFinish = async () => {
    trackEvent(EVENT_TYPES.ONBOARDING_COMPLETED, { step: 4, property_created: propertyCreated, role: userRole });

    try {
      await fetch("/api/onboarding/complete", { method: "POST" });
    } catch (err) {
      console.error("[Onboarding] Failed to mark onboarding complete:", err);
    }

    // Buyers with properties go to dashboard, buyers without go to explore
    if (userRole === "client") {
      router.push(propertyCreated ? "/dashboard" : "/explore");
    } else {
      router.push("/dashboard");
    }
  };

  const handleSkipAll = async () => {
    trackEvent(EVENT_TYPES.ONBOARDING_COMPLETED, { step: currentStep, skipped: true });

    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_step: 4,
          completed_steps: [...completedSteps],
          is_completed: true,
          skipped: true,
        }),
      });
    } catch (err) {
      console.error("[Onboarding] Failed to save skip state:", err);
    }

    // Buyers go to explore (no properties in skip path), agents/admins go to dashboard
    if (userRole === "client") {
      router.push("/explore");
    } else {
      router.push("/dashboard");
    }
  };

  const handleSkipSetup = async () => {
    if (userRole === "client" && currentStep === 3) {
      // For clients on tutorial step, go to completion instead of skipping entirely
      trackEvent(EVENT_TYPES.ONBOARDING_STEP_COMPLETED, { step: 3, skipped: true });
      await completeStep(3);
    } else {
      await handleSkipAll();
    }
  };

  // ============================================
  // Supabase not configured
  // ============================================

  if (!supabase) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
        <header className="w-full px-4 py-5 sm:px-6">
          <div className="mx-auto flex max-w-md items-center gap-2">
            <SpatiaLogo size="lg" />
            <span className="text-lg font-semibold tracking-tight">
              Spatia
            </span>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-8">
          <Card className="w-full max-w-md border-0 shadow-xl">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="h-7 w-7 text-amber-600" />
              </div>
              <CardTitle className="text-xl">Supabase Not Configured</CardTitle>
              <CardDescription>
                Onboarding requires Supabase. Add your credentials to{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                  .env.local
                </code>
              </CardDescription>
            </CardHeader>
          </Card>
        </main>

        <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
          Spatia &middot; Immersive Spatial Platform
        </footer>
      </div>
    );
  }

  // ============================================
  // Loading state
  // ============================================

  if (initializing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="mt-3 text-sm text-muted-foreground">Loading onboarding...</p>
      </div>
    );
  }

  // ============================================
  // Progress calculation
  // ============================================

  // Calculate display step and total based on role
  const getProgressInfo = () => {
    if (userRole === "client") {
      // Client flow: Step 0 (welcome) → Step 3 (tutorial) → Step 4 (completion)
      const displayStep = currentStep === 3 ? 1 : currentStep === 4 ? 2 : 0;
      const displayTotal = 2;
      const progressVal = displayTotal > 0 ? (displayStep / displayTotal) * 100 : 0;
      return { displayStep, displayTotal, progressVal };
    }
    // Agent flow: Step 0 → 1 → 2 → 3 → 4
    const displayTotal = TOTAL_STEPS - 1; // 4
    const progressVal = (currentStep / displayTotal) * 100;
    return { displayStep: currentStep, displayTotal, progressVal };
  };

  const { displayStep, displayTotal, progressVal: progressValue } = getProgressInfo();

  // ============================================
  // Render
  // ============================================

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
      {/* Header with progress */}
      <header className="w-full px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <SpatiaLogo size="lg" />
              <span className="text-lg font-semibold tracking-tight">
                Spatia
              </span>
            </div>
            {currentStep > 0 && currentStep < 4 && (
              <button
                onClick={handleSkipSetup}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <SkipForward className="h-3 w-3" />
                Skip setup
              </button>
            )}
          </div>
          {currentStep > 0 && (
            <div className="space-y-1.5">
              <Progress
                value={progressValue}
                className="h-2 bg-emerald-100 [&>[data-slot=progress-indicator]]:bg-emerald-500"
              />
              <p className="text-xs text-muted-foreground text-right">
                Step {displayStep} of {displayTotal}
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Main content area */}
      <main className="flex flex-1 items-center justify-center px-4 py-4 sm:py-8">
        <div className="w-full max-w-lg">
          <AnimatePresence mode="wait" custom={direction}>
            {/* ====== Step 0: Welcome + Role Selection ====== */}
            {currentStep === 0 && (
              <motion.div
                key="step-0"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" as const }}
              >
                <Card className="border-0 shadow-xl shadow-emerald-900/5">
                  <CardHeader className="text-center pb-2">
                    <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-100">
                      <Sparkles className="h-10 w-10 text-emerald-600" />
                    </div>
                    <CardTitle className="text-3xl font-bold tracking-tight sm:text-4xl">
                      Welcome to{" "}
                      <span className="text-emerald-600">Spatia</span>
                    </CardTitle>
                    <CardDescription className="text-lg mt-3 max-w-sm mx-auto">
                      How will you use Spatia?
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-2">
                    {/* Role selection cards */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <button
                        onClick={() => handleRoleSelect("agent")}
                        className="group flex flex-col items-center gap-3 rounded-xl border-2 border-emerald-200 bg-white p-6 text-center transition-all hover:border-emerald-500 hover:bg-emerald-50/50 hover:shadow-md"
                      >
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 transition-colors group-hover:bg-emerald-200">
                          <Building2 className="h-7 w-7" />
                        </div>
                        <div>
                          <p className="text-base font-semibold">I&apos;m an Agent</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Create properties, capture 3D tours, and share with clients
                          </p>
                        </div>
                      </button>

                      <button
                        onClick={() => handleRoleSelect("client")}
                        className="group flex flex-col items-center gap-3 rounded-xl border-2 border-emerald-200 bg-white p-6 text-center transition-all hover:border-emerald-500 hover:bg-emerald-50/50 hover:shadow-md"
                      >
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 transition-colors group-hover:bg-emerald-200">
                          <Search className="h-7 w-7" />
                        </div>
                        <div>
                          <p className="text-base font-semibold">I&apos;m a Buyer</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Browse properties, explore 3D virtual tours, and find your dream home
                          </p>
                        </div>
                      </button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ====== Step 1: Organization Setup (Agents only) ====== */}
            {currentStep === 1 && (
              <motion.div
                key="step-1"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" as const }}
              >
                <Card className="border-0 shadow-xl shadow-emerald-900/5">
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
                    <form onSubmit={handleOrgSubmit} className="space-y-5">
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
              </motion.div>
            )}

            {/* ====== Step 2: Create First Property (Agents only) ====== */}
            {currentStep === 2 && (
              <motion.div
                key="step-2"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" as const }}
              >
                <Card className="border-0 shadow-xl shadow-emerald-900/5">
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
                    <form onSubmit={handlePropertySubmit} className="space-y-5">
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
                        <Select value={propertyType} onValueChange={setPropertyType} disabled={loading}>
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
                        onClick={handleSkipProperty}
                        disabled={loading}
                        className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-2 flex items-center justify-center gap-1.5"
                      >
                        <SkipForward className="h-4 w-4" />
                        I&apos;ll do this later
                      </button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ====== Step 3: Tutorial (Agents: How Capture Works / Clients: How to Explore) ====== */}
            {currentStep === 3 && (
              <motion.div
                key="step-3"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" as const }}
              >
                <Card className="border-0 shadow-xl shadow-emerald-900/5">
                  <CardHeader className="text-center pb-2">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
                      {userRole === "client" ? (
                        <Eye className="h-8 w-8 text-emerald-600" />
                      ) : (
                        <Smartphone className="h-8 w-8 text-emerald-600" />
                      )}
                    </div>
                    <CardTitle className="text-2xl font-bold tracking-tight">
                      {userRole === "client"
                        ? "How to explore properties"
                        : "How capture works"}
                    </CardTitle>
                    <CardDescription className="text-base">
                      {userRole === "client"
                        ? "Discover and experience properties in immersive 3D"
                        : "Create stunning 3D walkthroughs in four simple steps"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {userRole === "client" ? (
                      // Client tutorial: focused on browsing and exploring
                      <>
                        {[
                          {
                            step: 1,
                            icon: <Search className="h-5 w-5" />,
                            title: "Browse properties",
                            desc: "Search and filter listings by location, type, and price range",
                            color: "bg-emerald-100 text-emerald-600",
                          },
                          {
                            step: 2,
                            icon: <Eye className="h-5 w-5" />,
                            title: "Explore 3D tours",
                            desc: "Step inside properties with immersive virtual walkthroughs — no download needed",
                            color: "bg-teal-100 text-teal-600",
                          },
                          {
                            step: 3,
                            icon: <Calendar className="h-5 w-5" />,
                            title: "Schedule viewings",
                            desc: "Book in-person visits directly from any property page",
                            color: "bg-cyan-100 text-cyan-600",
                          },
                          {
                            step: 4,
                            icon: <GitCompareArrows className="h-5 w-5" />,
                            title: "Compare & decide",
                            desc: "Save your favorites and compare properties side by side to find the perfect home",
                            color: "bg-emerald-100 text-emerald-700",
                          },
                        ].map((item) => (
                          <div
                            key={item.step}
                            className="flex items-start gap-4 rounded-xl border border-emerald-100 bg-white p-4"
                          >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-bold">
                              {item.step}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`flex h-6 w-6 items-center justify-center rounded-md ${item.color}`}>
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
                      </>
                    ) : (
                      // Agent tutorial: existing capture-focused content
                      <>
                        {[
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
                        ].map((item) => (
                          <div
                            key={item.step}
                            className="flex items-start gap-4 rounded-xl border border-emerald-100 bg-white p-4"
                          >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-bold">
                              {item.step}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`flex h-6 w-6 items-center justify-center rounded-md ${item.color}`}>
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
                      </>
                    )}

                    <Button
                      onClick={handleTutorialComplete}
                      className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700 mt-2"
                    >
                      Got it!
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* ====== Step 4: Success / Complete ====== */}
            {currentStep === 4 && (
              <motion.div
                key="step-4"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" as const }}
              >
                <Card className="border-0 shadow-xl shadow-emerald-900/5">
                  <CardHeader className="text-center pb-2">
                    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-100">
                      <PartyPopper className="h-10 w-10 text-emerald-600" />
                    </div>
                    <CardTitle className="text-3xl font-bold tracking-tight">
                      You&apos;re all set!
                    </CardTitle>
                    <CardDescription className="text-lg mt-2">
                      {userRole === "client"
                        ? "Start exploring amazing properties"
                        : "Your account is ready to go"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {/* Accomplishments */}
                    {userRole === "client" ? (
                      /* Client accomplishments */
                      <div className="space-y-3 rounded-xl bg-emerald-50/60 p-4">
                        <p className="text-sm font-semibold text-emerald-800 mb-3">
                          What you&apos;ve accomplished:
                        </p>

                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                          <span className="text-sm">Account created</span>
                        </div>

                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                          <span className="text-sm">Learned how to explore properties</span>
                        </div>
                      </div>
                    ) : (
                      /* Agent accomplishments (original) */
                      <div className="space-y-3 rounded-xl bg-emerald-50/60 p-4">
                        <p className="text-sm font-semibold text-emerald-800 mb-3">
                          What you&apos;ve accomplished:
                        </p>

                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                          <span className="text-sm">Account created</span>
                        </div>

                        {completedSteps.includes(1) && (
                          <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                            <span className="text-sm">
                              Agency set up
                              {agencyName && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  — {agencyName}
                                </span>
                              )}
                            </span>
                          </div>
                        )}

                        {propertyCreated ? (
                          <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                            <span className="text-sm">
                              First property created
                              {propertyTitle && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  — {propertyTitle}
                                </span>
                              )}
                            </span>
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
                      </div>
                    )}

                    {/* Contextual message */}
                    {userRole === "client" ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                        <p className="text-sm font-medium text-emerald-800">
                          Start browsing properties and exploring 3D virtual tours!
                        </p>
                        <p className="text-xs text-emerald-600 mt-1">
                          Discover your dream home with immersive walkthroughs
                        </p>
                      </div>
                    ) : propertyCreated ? (
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
                      className="h-12 w-full text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
                    >
                      {userRole === "client" ? "Start Exploring" : "Go to Dashboard"}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        Spatia &middot; Immersive Spatial Platform
      </footer>
    </div>
  );
}
