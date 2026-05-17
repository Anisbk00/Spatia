"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

interface PropertiesFiltersProps {
  status: string | undefined;
  propertyType: string | undefined;
  search: string | undefined;
}

export function PropertiesFilters({
  status,
  propertyType,
  search,
}: PropertiesFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const td = useTranslations("dashboard");
  const tp = useTranslations("property");

  const updateParams = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset to page 1 when filters change
      params.delete("page");
      router.push(`/dashboard/properties?${params.toString()}`);
    },
    [router, searchParams]
  );

  const handleSearch = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const searchValue = formData.get("search") as string;
      updateParams("search", searchValue || undefined);
    },
    [updateParams]
  );

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* Search input */}
      <form onSubmit={handleSearch} className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="search"
          placeholder={td("searchByTitle")}
          defaultValue={search ?? ""}
          className="pl-9 h-9"
        />
      </form>

      {/* Status filter */}
      <Select
        value={status ?? "all"}
        onValueChange={(value) => updateParams("status", value)}
      >
        <SelectTrigger className="w-[150px] h-9">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{td("allStatuses")}</SelectItem>
          <SelectItem value="draft">{tp("statusDraft")}</SelectItem>
          <SelectItem value="capturing">{tp("statusCapturing")}</SelectItem>
          <SelectItem value="processing">{tp("statusProcessing")}</SelectItem>
          <SelectItem value="ready">{tp("statusReady")}</SelectItem>
          <SelectItem value="archived">{tp("statusArchived")}</SelectItem>
        </SelectContent>
      </Select>

      {/* Property type filter */}
      <Select
        value={propertyType ?? "all"}
        onValueChange={(value) => updateParams("type", value)}
      >
        <SelectTrigger className="w-[150px] h-9">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{td("allTypes")}</SelectItem>
          <SelectItem value="apartment">{tp("apartment")}</SelectItem>
          <SelectItem value="house">{tp("house")}</SelectItem>
          <SelectItem value="villa">{tp("villa")}</SelectItem>
          <SelectItem value="office">{tp("office")}</SelectItem>
          <SelectItem value="land">{tp("land")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
