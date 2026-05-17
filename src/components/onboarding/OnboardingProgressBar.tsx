"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

// ============================================
// Types
// ============================================

interface OnboardingProgressBarProps {
  currentStep: number;
  completedSteps: number[];
  totalSteps?: number;
}

// ============================================
// Component
// ============================================

export function OnboardingProgressBar({
  currentStep,
  completedSteps,
  totalSteps = 5,
}: OnboardingProgressBarProps) {
  const steps = Array.from({ length: totalSteps }, (_, i) => i);

  return (
    <div className="w-full">
      {/* Step indicators row */}
      <div className="flex items-center justify-center">
        {steps.map((step, index) => {
          const isCompleted = completedSteps.includes(step);
          const isCurrent = step === currentStep;
          const isFuture = !isCompleted && !isCurrent;

          return (
            <div key={step} className="flex items-center">
              {/* Step circle */}
              <motion.div
                className="relative flex items-center justify-center"
                initial={false}
                animate={{
                  scale: isCurrent ? 1.1 : 1,
                }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <AnimatePresence mode="wait">
                  {isCompleted ? (
                    <motion.div
                      key="completed"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600"
                    >
                      <CheckCircle2 className="h-5 w-5 text-white" />
                    </motion.div>
                  ) : isCurrent ? (
                    <motion.div
                      key="current"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-bold"
                    >
                      {step + 1}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="future"
                      initial={{ scale: 0.8, opacity: 0.5 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0.5 }}
                      transition={{ duration: 0.2 }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium"
                    >
                      {step + 1}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Connector line between steps */}
              {index < steps.length - 1 && (
                <motion.div
                  className="h-0.5 w-6 sm:w-10"
                  initial={false}
                  animate={{
                    backgroundColor:
                      isCompleted && completedSteps.includes(steps[index + 1])
                        ? "#059669" // emerald-600
                        : isCompleted
                          ? "#d1d5db" // gray-300
                          : "#e5e7eb", // gray-200
                  }}
                  transition={{ duration: 0.3 }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step counter text */}
      <motion.p
        className="mt-2 text-center text-xs text-muted-foreground"
        key={currentStep}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        Step {currentStep + 1} of {totalSteps}
      </motion.p>
    </div>
  );
}
