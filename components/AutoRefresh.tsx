"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const timeout = window.setTimeout(() => {
      router.refresh();
    }, 4_000);

    return () => window.clearTimeout(timeout);
  }, [enabled, router]);

  return null;
}
