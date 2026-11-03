"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Recharts is large, so it is loaded in a separate chunk after the page shell renders.
export const StatusDistributionChart = dynamic(() => import("./charts").then((m) => m.StatusDistributionChart), {
  ssr: false,
  loading: () => <Skeleton className="size-44 rounded-full" />,
});

export const TrendChart = dynamic(() => import("./charts").then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});
