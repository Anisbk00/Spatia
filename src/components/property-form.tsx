"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Camera, Loader2, ArrowLeft, Video } from "lucide-react";
import type {
  CreatePropertyInput,
  FieldErrors,
  PropertyType,
} from "@/lib/types";

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "apartment", label: "Apartment" },
  { value: "house", label: "House" },
  { value: "villa", label: "Villa" },
  { value: "office", label: "Office" },
  { value: "land", label: "Land" },
];

interface PropertyFormProps {
  onCancel?: () => void;
  mode?: "photo" | "video";
}

export function PropertyForm({ onCancel, mode = "photo" }: PropertyFormProps) {
  const router = useRouter();
  const isVideoMode = mode === "video";
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [form, setForm] = useState<CreatePropertyInput>({
    title: "",
    address: "",
    property_type: undefined,
    price: undefined,
    description: "",
  });

  const updateField = <K extends keyof CreatePropertyInput>(
    key: K,
    value: CreatePropertyInput[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    setFieldErrors({});

    const errors: FieldErrors = {};
    if (!form.title?.trim()) {
      errors.title = "Property title is required";
    }
    if (form.price !== undefined && form.price !== null && form.price < 0) {
      errors.price = "Price cannot be negative";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);

    try {
      const apiEndpoint = isVideoMode ? "/api/video/session" : "/api/properties";
      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 422 && data.errors) {
          setFieldErrors(data.errors);
        } else {
          setGlobalError(data.error || "Something went wrong. Please try again.");
        }
        return;
      }

      if (isVideoMode) {
        // Video mode: redirect to video capture page
        const result = data as { property_id: string; session_id: string };
        router.push(`/capture-video/${result.session_id}`);
      } else {
        // Photo mode: redirect to capture session
        const result = data as { property: { id: string }; session: { id: string } };
        router.push(`/capture/${result.session.id}`);
      }
    } catch (err) {
      console.error("[PropertyForm] Submission failed:", err);
      setGlobalError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {globalError && (
        <Alert variant="destructive">
          <AlertDescription>{globalError}</AlertDescription>
        </Alert>
      )}

      {/* Mode indicator */}
      {isVideoMode && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
          <Video className="h-5 w-5 text-emerald-600" />
          <div>
            <p className="text-sm font-medium text-emerald-800">Video Capture Mode</p>
            <p className="text-xs text-emerald-600">Record a walkthrough video for 3D reconstruction</p>
          </div>
        </div>
      )}

      {/* Property Title */}
      <div className="space-y-2">
        <Label htmlFor="title" className="text-sm font-medium">
          Property Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="title"
          type="text"
          placeholder="e.g. Modern 3BR Apartment in Tunis Centre"
          value={form.title}
          onChange={(e) => updateField("title", e.target.value)}
          className="h-12 text-base"
          disabled={submitting}
          autoFocus
        />
        {fieldErrors.title && (
          <p className="text-sm text-destructive">{fieldErrors.title}</p>
        )}
      </div>

      {/* Address */}
      <div className="space-y-2">
        <Label htmlFor="address" className="text-sm font-medium">Address</Label>
        <Input
          id="address"
          type="text"
          placeholder="e.g. 15 Avenue Habib Bourguiba, Tunis"
          value={form.address}
          onChange={(e) => updateField("address", e.target.value)}
          className="h-12 text-base"
          disabled={submitting}
        />
      </div>

      {/* Property Type + Price row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Property Type</Label>
          <Select
            value={form.property_type ?? ""}
            onValueChange={(val) =>
              updateField("property_type", (val || undefined) as PropertyType | undefined)
            }
            disabled={submitting}
          >
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {PROPERTY_TYPES.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>
                  {pt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="price" className="text-sm font-medium">Price</Label>
          <Input
            id="price"
            type="number"
            inputMode="numeric"
            placeholder="e.g. 250000"
            value={form.price ?? ""}
            onChange={(e) =>
              updateField("price", e.target.value === "" ? undefined : Number(e.target.value))
            }
            className="h-12 text-base"
            disabled={submitting}
            min={0}
          />
          {fieldErrors.price && (
            <p className="text-sm text-destructive">{fieldErrors.price}</p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description" className="text-sm font-medium">Description</Label>
        <Textarea
          id="description"
          placeholder="Brief description of the property..."
          value={form.description}
          onChange={(e) => updateField("description", e.target.value)}
          className="min-h-24 text-base resize-none"
          disabled={submitting}
        />
      </div>

      {/* Actions */}
      <div className="space-y-3 pt-2">
        <Button
          type="submit"
          disabled={submitting || !form.title.trim()}
          className={`h-13 w-full text-base font-semibold ${
            isVideoMode
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-emerald-600 hover:bg-emerald-700"
          } disabled:opacity-50`}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Creating...
            </>
          ) : isVideoMode ? (
            <>
              <Video className="mr-2 h-5 w-5" />
              Start Video Capture
            </>
          ) : (
            <>
              <Camera className="mr-2 h-5 w-5" />
              Start Capture Session
            </>
          )}
        </Button>

        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full text-base text-muted-foreground"
            onClick={onCancel}
            disabled={submitting}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
