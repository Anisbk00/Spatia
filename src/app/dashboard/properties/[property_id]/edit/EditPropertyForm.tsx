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
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, ImageIcon } from "lucide-react";
import type { PropertyType, PropertyStatus } from "@/lib/types";

interface EditPropertyFormProps {
  propertyId: string;
  orgRole: string;
  initialData: {
    title: string;
    address: string;
    property_type: PropertyType | undefined;
    price: number | undefined;
    description: string;
    status: PropertyStatus;
    cover_image_url: string;
  };
}

const PROPERTY_TYPES: { value: PropertyType; labelKey: string }[] = [
  { value: "apartment", labelKey: "apartment" },
  { value: "house", labelKey: "house" },
  { value: "villa", labelKey: "villa" },
  { value: "office", labelKey: "office" },
  { value: "land", labelKey: "land" },
];

const PROPERTY_STATUSES: { value: PropertyStatus; labelKey: string }[] = [
  { value: "draft", labelKey: "statusDraft" },
  { value: "capturing", labelKey: "statusCapturing" },
  { value: "processing", labelKey: "statusProcessing" },
  { value: "ready", labelKey: "statusReady" },
  { value: "archived", labelKey: "statusArchived" },
];

type FieldKey = "title" | "address" | "property_type" | "price" | "description" | "status" | "cover_image_url";
type FieldErrors = Partial<Record<FieldKey, string>>;

export function EditPropertyForm({
  propertyId,
  orgRole,
  initialData,
}: EditPropertyFormProps) {
  const router = useRouter();
  const t = useTranslations("property");
  const tc = useTranslations("common");

  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [form, setForm] = useState({
    title: initialData.title,
    address: initialData.address,
    property_type: initialData.property_type,
    price: initialData.price,
    description: initialData.description,
    status: initialData.status,
    cover_image_url: initialData.cover_image_url,
  });

  const isAdmin = orgRole === "owner" || orgRole === "admin";

  const updateField = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key as FieldKey]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key as FieldKey];
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

    // Build the PATCH payload — only include changed fields
    const payload: Record<string, unknown> = {};

    if (form.title !== initialData.title) payload.title = form.title.trim();
    if (form.address !== initialData.address) payload.address = form.address?.trim() || null;
    if (form.property_type !== initialData.property_type) payload.property_type = form.property_type || null;
    if (form.price !== initialData.price) payload.price = form.price ?? null;
    if (form.description !== initialData.description) payload.description = form.description?.trim() || null;
    if (isAdmin && form.status !== initialData.status) payload.status = form.status;
    if (form.cover_image_url !== initialData.cover_image_url) payload.cover_image_url = form.cover_image_url?.trim() || null;

    // If nothing changed, just redirect back
    if (Object.keys(payload).length === 0) {
      router.push(`/dashboard/properties/${propertyId}`);
      return;
    }

    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

      router.push(`/dashboard/properties/${propertyId}`);
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

      <Separator />

      {/* Admin-only fields */}
      {isAdmin && (
        <>
          {/* Status */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("status")}</Label>
            <Select
              value={form.status}
              onValueChange={(val) =>
                updateField("status", val as PropertyStatus)
              }
              disabled={submitting}
            >
              <SelectTrigger className="h-12 text-base">
                <SelectValue placeholder={t("selectStatus")} />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_STATUSES.map((ps) => (
                  <SelectItem key={ps.value} value={ps.value}>
                    {t(ps.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cover Image URL */}
          <div className="space-y-2">
            <Label htmlFor="cover_image_url" className="text-sm font-medium flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" />
              {t("coverImageUrl")}
            </Label>
            <Input
              id="cover_image_url"
              type="url"
              placeholder={t("coverImageUrlPlaceholder")}
              value={form.cover_image_url}
              onChange={(e) => updateField("cover_image_url", e.target.value)}
              className="h-12 text-base"
              disabled={submitting}
            />
          </div>

          <Separator />
        </>
      )}

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          className="h-12 text-base text-muted-foreground"
          disabled={submitting}
          asChild
        >
          <a href={`/dashboard/properties/${propertyId}`}>
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
              {t("saving")}
            </>
          ) : (
            <>
              <Save className="mr-2 h-5 w-5" />
              {tc("save")}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
