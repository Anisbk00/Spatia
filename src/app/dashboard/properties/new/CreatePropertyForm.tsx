"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { Camera, Loader2, Video } from "lucide-react";
import type { PropertyType, FieldErrors } from "@/lib/types";

interface CreatePropertyFormProps {
  orgId: string;
  orgRole: string;
  isVideoMode: boolean;
}

const PROPERTY_TYPES: { value: PropertyType; labelKey: string }[] = [
  { value: "apartment", labelKey: "apartment" },
  { value: "house", labelKey: "house" },
  { value: "villa", labelKey: "villa" },
  { value: "office", labelKey: "office" },
  { value: "land", labelKey: "land" },
];

export function CreatePropertyForm({
  orgId,
  orgRole,
  isVideoMode,
}: CreatePropertyFormProps) {
  const router = useRouter();
  const t = useTranslations("property");
  const tc = useTranslations("common");

  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [form, setForm] = useState({
    title: "",
    address: "",
    property_type: undefined as PropertyType | undefined,
    price: undefined as number | undefined,
    description: "",
  });

  const updateField = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key as keyof FieldErrors]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key as keyof FieldErrors];
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
      errors.title = t("titleRequired");
    }
    if (form.price !== undefined && form.price !== null && form.price < 0) {
      errors.price = t("priceNonNegative");
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
          setGlobalError(data.error || t("errorCreating"));
        }
        return;
      }

      // In dashboard context, redirect to properties list (not capture flow)
      if (isVideoMode) {
        const result = data as { property_id: string; session_id: string };
        router.push(`/capture-video/${result.session_id}`);
      } else {
        // Dashboard create: redirect to the new property detail page
        const result = data as { property: { id: string }; session: { id: string } };
        router.push(`/dashboard/properties/${result.property.id}`);
      }
    } catch {
      setGlobalError(t("networkError"));
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

      {/* Video mode indicator */}
      {isVideoMode && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
          <Video className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-800">{t("videoModeIndicator")}</p>
            <p className="text-xs text-emerald-600">{t("videoModeIndicatorDesc")}</p>
          </div>
        </div>
      )}

      {/* Property Title */}
      <div className="space-y-2">
        <Label htmlFor="title" className="text-sm font-medium">
          {t("propertyName")} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="title"
          type="text"
          placeholder={t("propertyNamePlaceholder")}
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
        <Label htmlFor="address" className="text-sm font-medium">
          {t("address")}
        </Label>
        <Input
          id="address"
          type="text"
          placeholder={t("addressPlaceholder")}
          value={form.address}
          onChange={(e) => updateField("address", e.target.value)}
          className="h-12 text-base"
          disabled={submitting}
        />
      </div>

      {/* Property Type + Price row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("propertyType")}</Label>
          <Select
            value={form.property_type ?? ""}
            onValueChange={(val) =>
              updateField("property_type", (val || undefined) as PropertyType | undefined)
            }
            disabled={submitting}
          >
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder={t("selectType")} />
            </SelectTrigger>
            <SelectContent>
              {PROPERTY_TYPES.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>
                  {t(pt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="price" className="text-sm font-medium">
            {t("price")}
          </Label>
          <Input
            id="price"
            type="number"
            inputMode="numeric"
            placeholder={t("pricePlaceholder")}
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
        <Label htmlFor="description" className="text-sm font-medium">
          {t("description")}
        </Label>
        <Textarea
          id="description"
          placeholder={t("descriptionPlaceholder")}
          value={form.description}
          onChange={(e) => updateField("description", e.target.value)}
          className="min-h-24 text-base resize-none"
          disabled={submitting}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          className="h-12 text-base text-muted-foreground"
          disabled={submitting}
          asChild
        >
          <a href="/dashboard/properties">
            {tc("cancel")}
          </a>
        </Button>
        <Button
          type="submit"
          disabled={submitting || !form.title.trim()}
          className="h-12 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {t("creating")}
            </>
          ) : isVideoMode ? (
            <>
              <Video className="mr-2 h-5 w-5" />
              {t("startVideoCapture")}
            </>
          ) : (
            <>
              <Camera className="mr-2 h-5 w-5" />
              {t("createProperty")}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
