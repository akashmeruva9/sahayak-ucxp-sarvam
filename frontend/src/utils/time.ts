/** Time + date helpers for history grouping and message timestamps. */

export type DateBucket = "Today" | "Yesterday" | "Earlier";

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function bucketFor(ts: number, now = Date.now()): DateBucket {
  const today = startOfDay(now);
  const day = startOfDay(ts);
  if (day === today) return "Today";
  if (day === today - DAY) return "Yesterday";
  return "Earlier";
}

/** e.g. "9:41 AM" */
export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Relative label used on conversation cards, e.g. "2h ago", "Mon". */
export function formatRelative(ts: number, now = Date.now()): string {
  const diff = now - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** mm:ss recording timer. */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
