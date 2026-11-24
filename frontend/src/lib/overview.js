const UNAVAILABLE = "—"; // stats are loading or the API cannot be reached
export const NOT_AVAILABLE = "N/A"; // the API answered, but there is nothing to measure yet

// The API computes success rate as completed / (completed + failed) * 100 and
// sends null until at least one job has finished.
export function formatSuccessRate(rate) {
  return Number.isFinite(rate) ? `${rate}%` : NOT_AVAILABLE;
}

// The throughput chart buckets jobs by when they were created, not completed.
export function throughputCaption(periodLabel) {
  return `Jobs created (not completed) · ${periodLabel}`;
}

// The small caption under each overview card. Every number comes from the API
// (`stats` is the /dashboard/stats response); nothing here is a placeholder.
// Pass null while stats are loading or unavailable.
export function metricNote(name, stats) {
  if (!stats) return UNAVAILABLE;

  switch (name) {
    case "Total executions":
      return "Recorded jobs";
    case "Successful": {
      const rate = stats.success_rate;
      return Number.isFinite(rate)
        ? `${formatSuccessRate(rate)} success rate`
        : `${NOT_AVAILABLE} · no finished jobs yet`;
    }
    case "Queue depth":
      return stats.queued > 0 ? "Waiting for workers" : "No jobs waiting";
    case "Failed executions":
      return stats.failed > 0 ? "Require investigation" : "No failed jobs";
    default:
      return UNAVAILABLE;
  }
}
