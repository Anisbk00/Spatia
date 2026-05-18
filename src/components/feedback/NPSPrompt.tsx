"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface NPSPromptProps {
  propertyId?: string;
  onClose: () => void;
}

const NPS_DISMISS_KEY = "nps_prompt_dismissed";
const NPS_LATER_KEY = "nps_prompt_later";

function getRatingColor(rating: number): string {
  if (rating <= 3) return "bg-red-500 hover:bg-red-600 text-white";
  if (rating <= 6) return "bg-amber-400 hover:bg-amber-500 text-gray-900";
  if (rating <= 8) return "bg-emerald-400 hover:bg-emerald-500 text-gray-900";
  return "bg-emerald-600 hover:bg-emerald-700 text-white";
}

function getRatingLabel(rating: number): string {
  if (rating <= 6) return "Detractor";
  if (rating <= 8) return "Passive";
  return "Promoter";
}

export function NPSPrompt({ propertyId, onClose }: NPSPromptProps) {
  const [open, setOpen] = useState(true);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check if already dismissed
  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(NPS_DISMISS_KEY);
      const laterDate = localStorage.getItem(NPS_LATER_KEY);

      if (dismissed === "never") {
        setOpen(false);
        onClose();
        return;
      }

      if (laterDate) {
        const laterUntil = new Date(laterDate);
        if (new Date() < laterUntil) {
          setOpen(false);
          onClose();
          return;
        }
      }
    } catch (err) {
      console.error("[NPSPrompt] localStorage read failed:", err);
    }
  }, [onClose]);

  const handleAskLater = () => {
    try {
      // Don't ask again for 7 days
      const laterDate = new Date();
      laterDate.setDate(laterDate.getDate() + 7);
      localStorage.setItem(NPS_LATER_KEY, laterDate.toISOString());
    } catch (err) {
      console.error("[NPSPrompt] localStorage write failed:", err);
    }
    setOpen(false);
    onClose();
  };

  const handleDontAskAgain = () => {
    try {
      localStorage.setItem(NPS_DISMISS_KEY, "never");
    } catch (err) {
      console.error("[NPSPrompt] localStorage write failed:", err);
    }
    setOpen(false);
    onClose();
  };

  const handleSubmit = async () => {
    if (rating === null) return;

    setIsSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        type: "nps",
        rating,
        comment: comment.trim() || undefined,
        property_id: propertyId || undefined,
        metadata: {
          nps_category: getRatingLabel(rating),
        },
      };

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit rating");
      }

      // Track event
      trackEvent(EVENT_TYPES.NPS_SCORE_SUBMITTED, {
        nps_rating: rating,
        nps_category: getRatingLabel(rating),
        has_comment: !!comment.trim(),
        property_id: propertyId || null,
      });

      // Show success toast
      toast({
        title: "Thank you for your rating!",
        description: "Your feedback helps us improve the Spatia experience.",
      });

      // Mark as dismissed after successful submission
      try {
        localStorage.setItem(NPS_DISMISS_KEY, "never");
      } catch (err) {
        console.error("[NPSPrompt] localStorage write failed:", err);
      }

      setOpen(false);
      onClose();
    } catch (error) {
      toast({
        title: "Submission failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleAskLater(); }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        {/* Custom close button */}
        <button
          onClick={handleAskLater}
          className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <DialogHeader>
          <DialogTitle>Rate Your Experience</DialogTitle>
          <DialogDescription>
            How likely are you to recommend Spatia to a colleague or
            friend?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-2">
          {/* Rating Scale */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span>Not likely</span>
              <span>Very likely</span>
            </div>
            <div className="grid grid-cols-11 gap-1.5">
              {Array.from({ length: 11 }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setRating(i)}
                  className={cn(
                    "h-10 rounded-md text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1",
                    rating === i
                      ? getRatingColor(i) + " scale-110 shadow-md"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                  aria-label={`Rate ${i} out of 10`}
                >
                  {i}
                </button>
              ))}
            </div>
            {rating !== null && (
              <div className="text-center">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
                    rating <= 6
                      ? "bg-red-100 text-red-700"
                      : rating <= 8
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                  )}
                >
                  {getRatingLabel(rating)}
                </span>
              </div>
            )}
          </div>

          {/* Optional Comment */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="nps-comment">
              Additional comments{" "}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Textarea
              id="nps-comment"
              placeholder="What's the main reason for your score?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="resize-none"
              maxLength={2000}
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={handleSubmit}
            disabled={rating === null || isSubmitting}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Rating"
            )}
          </Button>
          <div className="flex gap-4 justify-center text-sm">
            <button
              onClick={handleAskLater}
              className="text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
            >
              Ask me later
            </button>
            <button
              onClick={handleDontAskAgain}
              className="text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
            >
              Don&apos;t ask again
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
