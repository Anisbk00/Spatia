"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { trackEvent, EVENT_TYPES } from "@/lib/event-tracking";
import { Loader2 } from "lucide-react";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId?: string;
  defaultType?: string;
}

const FEEDBACK_TYPES = [
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "general", label: "General Feedback" },
  { value: "capture", label: "Capture Feedback" },
] as const;

const SENTIMENT_OPTIONS = [
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "negative", label: "Negative" },
] as const;

export function FeedbackDialog({
  open,
  onOpenChange,
  propertyId,
  defaultType,
}: FeedbackDialogProps) {
  const [type, setType] = useState(defaultType ?? "general");
  const [comment, setComment] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValidType = (t: string): t is "bug" | "feature" | "general" | "capture" | "nps" => {
    return ["bug", "feature", "general", "capture", "nps"].includes(t);
  };

  const handleSubmit = async () => {
    if (!comment.trim()) return;

    setIsSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        type: isValidType(type) ? type : "general",
        comment: comment.trim(),
        property_id: propertyId || undefined,
        metadata: {},
      };

      if (sentiment) {
        payload.sentiment = sentiment;
      }

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit feedback");
      }

      // Track event
      trackEvent(EVENT_TYPES.FEEDBACK_SUBMITTED, {
        feedback_type: type,
        sentiment: sentiment || null,
        has_comment: true,
        property_id: propertyId || null,
      });

      // Show success toast
      toast({
        title: "Feedback submitted",
        description: "Thank you for your feedback! We appreciate your input.",
      });

      // Reset form and close
      setComment("");
      setSentiment("");
      setType(defaultType ?? "general");
      onOpenChange(false);
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

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form when closing
      setComment("");
      setSentiment("");
      setType(defaultType ?? "general");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
          <DialogDescription>
            Help us improve Spatia. Share your thoughts, report issues,
            or suggest features.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Type Select */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="feedback-type">Feedback Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="feedback-type" className="w-full">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {FEEDBACK_TYPES.map((ft) => (
                  <SelectItem key={ft.value} value={ft.value}>
                    {ft.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Comment Textarea */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="feedback-comment">
              Comment <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="feedback-comment"
              placeholder="Tell us what you think..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Sentiment Select */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="feedback-sentiment">
              Sentiment <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Select value={sentiment} onValueChange={setSentiment}>
              <SelectTrigger id="feedback-sentiment" className="w-full">
                <SelectValue placeholder="How do you feel?" />
              </SelectTrigger>
              <SelectContent>
                {SENTIMENT_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!comment.trim() || isSubmitting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Feedback"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
