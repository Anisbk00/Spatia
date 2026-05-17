"use client";

import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Eye, Link as LinkIcon, Archive, Trash2, Pencil } from "lucide-react";
import { useCallback } from "react";
import { useTranslations } from "next-intl";

interface PropertyActionsProps {
  propertyId: string;
  propertyStatus: string;
}

export function PropertyActions({ propertyId, propertyStatus }: PropertyActionsProps) {
  const router = useRouter();
  const td = useTranslations("dashboard");
  const tc = useTranslations("common");

  const handleCopyLink = useCallback(async () => {
    const url = `${window.location.origin}/property/${propertyId}`;
    await navigator.clipboard.writeText(url);
  }, [propertyId]);

  const handleOpenViewer = useCallback(() => {
    window.open(`/view/${propertyId}`, "_blank");
  }, [propertyId]);

  const handleArchive = useCallback(async () => {
    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch (err) {
      console.error("[PropertyActions] Failed to archive property:", err);
    }
  }, [propertyId, router]);

  const handleDelete = useCallback(async () => {
    if (!confirm(td("deleteConfirm"))) {
      return;
    }
    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
      }
    } catch (err) {
      console.error("[PropertyActions] Failed to delete property:", err);
    }
  }, [propertyId, router, td]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">{tc("openMenu")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <a href={`/properties/${propertyId}/edit`} className="cursor-pointer">
            <Pencil className="h-4 w-4" />
            {tc("edit")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleOpenViewer} className="cursor-pointer">
          <Eye className="h-4 w-4" />
          {td("openViewer")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer">
          <LinkIcon className="h-4 w-4" />
          {td("copyShareLink")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {propertyStatus !== "archived" && (
          <DropdownMenuItem onClick={handleArchive} className="cursor-pointer">
            <Archive className="h-4 w-4" />
            {td("archive")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={handleDelete}
          variant="destructive"
          className="cursor-pointer"
        >
          <Trash2 className="h-4 w-4" />
          {tc("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
