"use client";

import Link from "next/link";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "@/components/ui/pagination";

interface PropertiesPaginationProps {
  currentPage: number;
  totalPages: number;
  status: string | undefined;
  propertyType: string | undefined;
  search: string | undefined;
}

function buildHref(
  page: number,
  status: string | undefined,
  propertyType: string | undefined,
  search: string | undefined
): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (propertyType) params.set("type", propertyType);
  if (search) params.set("search", search);
  params.set("page", String(page));
  return `/dashboard/properties?${params.toString()}`;
}

function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "ellipsis")[] = [1];

  if (current > 3) {
    pages.push("ellipsis");
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("ellipsis");
  }

  pages.push(total);

  return pages;
}

export function PropertiesPagination({
  currentPage,
  totalPages,
  status,
  propertyType,
  search,
}: PropertiesPaginationProps) {
  const pages = getPageNumbers(currentPage, totalPages);

  return (
    <Pagination>
      <PaginationContent>
        {currentPage > 1 && (
          <PaginationItem>
            <PaginationPrevious
              href={buildHref(currentPage - 1, status, propertyType, search)}
            />
          </PaginationItem>
        )}

        {pages.map((page, index) =>
          page === "ellipsis" ? (
            <PaginationItem key={`ellipsis-${index}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={page}>
              <PaginationLink
                href={buildHref(page, status, propertyType, search)}
                isActive={page === currentPage}
              >
                {page}
              </PaginationLink>
            </PaginationItem>
          )
        )}

        {currentPage < totalPages && (
          <PaginationItem>
            <PaginationNext
              href={buildHref(currentPage + 1, status, propertyType, search)}
            />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  );
}
