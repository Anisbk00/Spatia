"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ViewerFeedbackPromptProps {
  /** Optional property ID to associate feedback with */
  propertyId?: string;
  /** Callback when the prompt is dismissed (either by user or auto-dismiss) */
  onDismiss?: () => void;
  /** Whether the prompt is visible */
  visible?: boolean;
}

export function ViewerFeedbackPrompt({
  propertyId,
  onDismiss,
  visible = true,
}: ViewerFeedbackPromptProps) {
  const [isVisible, setIsVisible] = useState(visible);
  const [hasResponded, setHasResponded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-dismiss after 10 seconds
  const dismiss = useCallback(() => {
    setIsVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  useEffect(() => {
    if (!isVisible || hasResponded) return;

    const timer = setTimeout(() => {
      dismiss();
    }, 10_000);

    return () => clearTimeout(timer);
  }, [isVisible, hasResponded, dismiss]);

  // Sync with visible prop
  useEffect(() => {
    setIsVisible(visible);
  }, [visible]);

  const handleFeedback = async (isHelpful: boolean) => {
    if (isSubmitting) return;

    setHasResponded(true);
    setIsSubmitting(true);

    const sentiment = isHelpful ? "positive" : "negative";

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "general",
          sentiment,
          comment: isHelpful
            ? "3D tour was helpful"
            : "3D tour was not helpful",
          property_id: propertyId || undefined,
          metadata: {
            source: "viewer_feedback_prompt",
            response: isHelpful ? "helpful" : "not_helpful",
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit feedback");
      }

      // Track event
      trackEvent(EVENT_TYPES.FEEDBACK_SUBMITTED, {
        feedback_type: "general",
        sentiment,
        source: "viewer_feedback_prompt",
        property_id: propertyId || null,
      });

      toast({
        title: isHelpful ? "Thanks for the feedback!" : "We'll do better",
        description: isHelpful
          ? "Glad the 3D tour was useful!"
          : "We'll work on improving the experience.",
      });
    } catch (err) {
      console.error("[ViewerFeedbackPrompt] Feedback submission failed:", err);
      // Silently fail — don't disrupt the viewer experience
    } finally {
      setIsSubmitting(false);
      // Dismiss after a brief moment so the user sees the response
      setTimeout(dismiss, 800);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-20 right-6 z-40 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <Card className="w-72 shadow-lg border-emerald-200/60 bg-white/95 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-sm font-medium text-gray-900">
              Was this 3D tour useful?
            </p>
            <button
              onClick={dismiss}
              className="rounded-sm opacity-60 hover:opacity-100 transition-opacity focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFeedback(true)}
              disabled={isSubmitting || hasResponded}
              className={cn(
                "flex-1 gap-1.5 text-xs h-9 transition-all",
                hasResponded
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
              )}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              Helpful
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFeedback(false)}
              disabled={isSubmitting || hasResponded}
              className={cn(
                "flex-1 gap-1.5 text-xs h-9 transition-all",
                hasResponded
                  ? "border-red-200 bg-red-50 text-red-600"
                  : "hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              )}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              Not helpful
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
