export const capitalize = (value) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "";

// "3m ago", "2h ago", "5d ago"; `now` is injectable so callers can tick.
export function formatRelative(value, now = Date.now()) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "—";

  const seconds = Math.round((now - time) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}
