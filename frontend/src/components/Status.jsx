function Status({ value }) {
  const styles = {
    Completed: "text-emerald-400 bg-emerald-400/10",
    Failed: "text-rose-400 bg-rose-400/10",
    Queued: "text-cyan-400 bg-cyan-400/10",
    Cancelled: "text-slate-400 bg-slate-400/10",
    Processing: "text-violet-400 bg-violet-400/10",
  };

  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${styles[value]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value}
    </span>
  );
}

export default Status;
