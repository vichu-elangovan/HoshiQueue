const MAX_SEGMENTS = 10;

const FILL = {
  completed: "bg-emerald-400",
  failed: "bg-rose-400",
  processing: "bg-violet-400",
  queued: "bg-cyan-400",
  cancelled: "bg-slate-500",
};

// One segment per allowed attempt, filled for each attempt used.
function AttemptsBar({ attempts, maxAttempts, status }) {
  const total = Math.min(Math.max(maxAttempts, 1), MAX_SEGMENTS);
  const filled = Math.min(attempts, total);

  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 w-4 rounded-full ${
              index < filled ? FILL[status] ?? "bg-slate-500" : "bg-slate-700"
            }`}
          />
        ))}
      </div>
      <span className="text-slate-400">
        {attempts} / {maxAttempts}
        <span className="sr-only"> attempts used</span>
      </span>
    </div>
  );
}

export default AttemptsBar;
