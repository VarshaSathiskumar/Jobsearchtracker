"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Briefcase, CalendarCheck, CircleHelp, CircleX, LayoutDashboard, Mail, PhoneCall, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: LucideIcon; badgeKey?: "needsReview" };

const ITEMS: Item[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/applications", label: "All Applications", icon: Briefcase },
  { href: "/rejections", label: "Rejections", icon: CircleX },
  { href: "/callbacks", label: "Interview Callbacks", icon: PhoneCall },
  { href: "/interviews", label: "Interview Scheduled", icon: CalendarCheck },
  { href: "/job-alerts", label: "Job Alerts", icon: Bell },
  { href: "/other-emails", label: "Other Emails", icon: Mail },
  { href: "/needs-review", label: "Needs Review", icon: CircleHelp, badgeKey: "needsReview" },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-teal-400 text-white shadow-sm">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight">Job Tracker</span>
        <span className="block text-xs text-muted-foreground">AI inbox assistant</span>
      </span>
    </Link>
  );
}

export function NavLinks({ counts, onNavigate }: { counts: { needsReview: number }; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
        const count = item.badgeKey ? counts[item.badgeKey] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_0_var(--primary)]" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} aria-hidden />
            <span className="flex-1 truncate">{item.label}</span>
            {count > 0 && (
              <span className="min-w-5 rounded-full bg-amber-100 px-1.5 text-center text-xs font-semibold text-amber-900" aria-label={`${count} items need review`}>
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ counts }: { counts: { needsReview: number } }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 border-r bg-sidebar/90 p-4 backdrop-blur lg:flex">
      <Brand />
      <NavLinks counts={counts} />
      <p className="mt-auto px-2 text-xs leading-relaxed text-muted-foreground">Read-only Gmail access. Emails are never modified or sent.</p>
    </aside>
  );
}
