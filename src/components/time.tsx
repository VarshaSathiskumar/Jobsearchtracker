"use client";

import { useSyncExternalStore } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";

type Mode = "date" | "datetime" | "relative";

function utcText(d: Date, mode: Mode) {
  // Used for server rendering and hydration, so the first client render always matches the server.
  const iso = d.toISOString();
  return mode === "date" ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function localText(d: Date, mode: Mode) {
  if (mode === "relative") return formatDistanceToNowStrict(d, { addSuffix: true });
  return mode === "date" ? format(d, "MMM d, yyyy") : format(d, "MMM d, yyyy h:mm a");
}

function subscribe(onTick: () => void) {
  const id = setInterval(onTick, 30_000);
  return () => clearInterval(id);
}

/** Renders a timestamp in the viewer's local time zone (and keeps "x minutes ago" fresh) after hydration. */
export function Time({ value, mode = "date", empty = "Never" }: { value: string | Date | null | undefined; mode?: Mode; empty?: string }) {
  const date = value ? new Date(value) : null;
  const stamp = date?.getTime() ?? 0;
  const text = useSyncExternalStore(
    subscribe,
    () => (stamp ? localText(new Date(stamp), mode) : ""),
    () => (stamp ? utcText(new Date(stamp), mode) : ""),
  );

  if (!date) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {text}
    </time>
  );
}
