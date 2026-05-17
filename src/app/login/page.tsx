"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/**
 * Legacy /login route — redirects to /auth/login.
 *
 * Preserves query parameters (error, next, etc.) for seamless migration.
 * All new links should use /auth/login directly.
 */
export default function LoginPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const qs = searchParams.toString();
    const target = qs ? `/auth/login?${qs}` : "/auth/login";
    router.replace(target);
  }, [searchParams, router]);

  return null;
}
