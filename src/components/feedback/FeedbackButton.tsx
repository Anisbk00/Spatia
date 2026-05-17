"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { FeedbackDialog } from "./FeedbackDialog";
import { cn } from "@/lib/utils";

interface FeedbackButtonProps {
  /** Whether the button is hidden */
  hidden?: boolean;
  /** Optional property ID to associate feedback with */
  propertyId?: string;
  /** Default feedback type to pre-select in the dialog */
  defaultType?: string;
  /** Additional CSS classes */
  className?: string;
}

export function FeedbackButton({
  hidden = false,
  propertyId,
  defaultType,
  className,
}: FeedbackButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (hidden) return null;

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200 hover:scale-110 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 active:scale-95",
          "bg-emerald-600 text-white hover:bg-emerald-700",
          className
        )}
        aria-label="Send feedback"
      >
        {/* Pulse ring animation */}
        <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-25" />
        <MessageSquare className="h-6 w-6 relative z-10" />
      </button>

      <FeedbackDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        propertyId={propertyId}
        defaultType={defaultType}
      />
    </>
  );
}
