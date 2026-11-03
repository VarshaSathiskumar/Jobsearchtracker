import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCard({
  title, value, delta, href, icon: Icon, tone,
}: {
  title: string;
  value: number;
  delta: number;
  href: string;
  icon: LucideIcon;
  tone: "blue" | "rose" | "violet" | "teal" | "amber";
}) {
  const tones = {
    blue: { chip: "bg-blue-100 text-blue-700", bar: "from-blue-500 to-indigo-500" },
    rose: { chip: "bg-rose-100 text-rose-700", bar: "from-rose-500 to-orange-400" },
    violet: { chip: "bg-violet-100 text-violet-700", bar: "from-violet-500 to-fuchsia-500" },
    teal: { chip: "bg-teal-100 text-teal-700", bar: "from-teal-500 to-emerald-400" },
    amber: { chip: "bg-amber-100 text-amber-800", bar: "from-amber-400 to-orange-400" },
  }[tone];

  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", tones.bar)} aria-hidden />
      <div className="flex items-center justify-between">
        <span className={cn("grid size-9 place-items-center rounded-xl", tones.chip)}>
          <Icon className="size-4.5" aria-hidden />
        </span>
        <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>
      <div>
        <p className="text-3xl font-semibold tabular-nums tracking-tight" data-testid={`kpi-${title}`}>{value}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{title}</p>
      </div>
      <p className={cn("text-xs font-medium", delta > 0 ? "text-emerald-700" : "text-muted-foreground")}>
        {delta > 0 ? `+${delta} new since last sync` : "No new since last sync"}
      </p>
    </Link>
  );
}
