import { Ban, Check, CircleDot, Hourglass, PhoneCall, CalendarCheck, Trophy, X, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/constants";
import { STATUS_STYLES } from "@/lib/ui";
import { cn } from "@/lib/utils";

const ICONS: Record<ApplicationStatus, LucideIcon> = {
  applied: CircleDot,
  callback: PhoneCall,
  assessment: Hourglass,
  interview_scheduled: CalendarCheck,
  offer: Trophy,
  rejected: X,
  withdrawn: Ban,
};

export function StatusBadge({ status, className }: { status: ApplicationStatus; className?: string }) {
  const Icon = ICONS[status] ?? Check;
  return (
    <Badge variant="outline" className={cn("gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-medium", STATUS_STYLES[status].badge, className)}>
      <Icon aria-hidden className="size-3" />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function SampleBadge() {
  return (
    <Badge variant="outline" className="rounded-full border-dashed border-amber-400 bg-amber-50 px-2 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
      Sample
    </Badge>
  );
}
