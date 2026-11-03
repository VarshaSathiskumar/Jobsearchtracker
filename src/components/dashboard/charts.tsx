"use client";

import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/constants";
import { STATUS_STYLES } from "@/lib/ui";

export function StatusDistributionChart({ data }: { data: { status: ApplicationStatus; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const rows = data.filter((d) => d.count > 0).map((d) => ({ ...d, name: STATUS_LABELS[d.status] }));
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative size-44 shrink-0" role="img" aria-label={`Status distribution of ${total} applications`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="count" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
              {rows.map((r) => (
                <Cell key={r.status} fill={STATUS_STYLES[r.status].chart} />
              ))}
            </Pie>
            <Tooltip formatter={(v, n) => [String(v), String(n)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{total}</p>
            <p className="text-xs text-muted-foreground">applications</p>
          </div>
        </div>
      </div>
      <ul className="grid w-full grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-1">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: STATUS_STYLES[r.status].chart }} aria-hidden />
              {r.name}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {r.count} <span className="text-xs">({Math.round((r.count / total) * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrendChart({ data }: { data: { week: string; applied: number; rejected: number; progressed: number }[] }) {
  const fmt = (w: string) => {
    const d = new Date(w + "T00:00:00Z");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  };
  return (
    <div className="h-64 w-full" role="img" aria-label="Weekly applications, rejections and positive responses">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gApplied" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gProg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3e6f1" />
          <XAxis dataKey="week" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#596079" }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#596079" }} tickLine={false} axisLine={false} />
          <Tooltip labelFormatter={(l) => `Week of ${fmt(String(l))}`} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="applied" name="Applications" stroke="#3b82f6" strokeWidth={2} fill="url(#gApplied)" />
          <Area type="monotone" dataKey="progressed" name="Callbacks, interviews, offers" stroke="#14b8a6" strokeWidth={2} fill="url(#gProg)" />
          <Area type="monotone" dataKey="rejected" name="Rejections" stroke="#f43f5e" strokeWidth={2} fill="none" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
