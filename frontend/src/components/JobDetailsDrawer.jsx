import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { getJob } from "../api";
import AttemptsBar from "./AttemptsBar";
import Status from "./Status";
import { capitalize, formatDateTime, formatRelative } from "../lib/format";

const REFRESH_MS = 5000;

// What the attempt counter means for each state. The worker increments
// `attempts` when an attempt starts and keeps a job in "queued" while it
// waits to retry, so queued with attempts > 0 means a retry is pending.
function describeAttempts({ status, attempts, max_attempts: max }) {
  switch (status) {
    case "completed":
      return attempts <= 1
        ? "Completed on the first attempt."
        : `Completed after ${attempts} attempts.`;
    case "failed":
      return attempts >= max
        ? `All ${max} attempts were used.`
        : `Stopped after ${attempts} of ${max} attempts.`;
    case "processing":
      return `Running attempt ${attempts} of ${max}.`;
    case "queued":
      return attempts === 0
        ? "Waiting for a worker to pick it up."
        : `${attempts} of ${max} attempts used. Waiting to retry.`;
    case "cancelled":
      return attempts === 0
        ? "Cancelled before it ran."
        : `Cancelled after ${attempts} of ${max} attempts.`;
    default:
      return "";
  }
}

// The worker only saves failure_reason when the final attempt fails.
function describeMissingReason({ status, attempts }) {
  if (status === "failed") return "No reason was recorded for this failure.";
  if (attempts > 0 && (status === "queued" || status === "processing")) {
    return "Not saved yet. It is recorded if the final attempt fails.";
  }
  return "No failure recorded.";
}

function CopyButton({ text, label, children = "Copy" }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context, denied permission).
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-violet-500/40"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="text-xs font-medium tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-sm text-slate-200">{children}</dd>
    </div>
  );
}

// `initialJob` is the row the user clicked, shown immediately while the
// latest copy is fetched. Mount with key={jobId} so state resets per job.
function JobDetailsDrawer({ jobId, initialJob, live, onClose }) {
  const [latest, setLatest] = useState(null);
  const [refreshError, setRefreshError] = useState(false);
  const closeButton = useRef(null);

  // Close on Escape; hand focus back to whatever opened the drawer.
  useEffect(() => {
    const opener = document.activeElement;
    closeButton.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  // Fetch the current state now, then keep it fresh while auto-refresh is on.
  useEffect(() => {
    const stale = new AbortController();

    async function load() {
      try {
        const job = await getJob(jobId);
        if (stale.signal.aborted) return;
        setLatest(job);
        setRefreshError(false);
      } catch {
        if (!stale.signal.aborted) setRefreshError(true);
      }
    }

    load();
    const timer = live ? setInterval(load, REFRESH_MS) : null;

    return () => {
      stale.abort();
      if (timer) clearInterval(timer);
    };
  }, [jobId, live]);

  const job = latest ?? initialJob;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-drawer-title"
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-slate-800 bg-[#0d1425] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 p-6">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium tracking-wide text-slate-500">
              JOB DETAILS
            </p>
            <h2
              id="job-drawer-title"
              className="text-2xl font-bold tracking-tight"
            >
              Job <span className="text-violet-300">#{job.id}</span>
            </h2>
            <div>
              <Status value={capitalize(job.status)} />
            </div>
          </div>

          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close job details"
            className="rounded-xl border border-slate-800 bg-slate-900 p-2.5 text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <dl className="flex flex-1 flex-col gap-7 p-6">
          <Field label="TASK">
            <span className="font-mono text-slate-100 wrap-anywhere">{job.task_name}</span>
          </Field>

          <Field label="RETRY ATTEMPTS">
            <div className="flex flex-col gap-3">
              <AttemptsBar
                attempts={job.attempts}
                maxAttempts={job.max_attempts}
                status={job.status}
              />
              <p className="text-slate-400">{describeAttempts(job)}</p>
            </div>
          </Field>

          <Field label="FAILURE REASON">
            {job.failure_reason ? (
              <div className="flex flex-col gap-3">
                <pre className="whitespace-pre-wrap break-words rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 font-mono text-[13px] leading-relaxed text-rose-200">
                  {job.failure_reason}
                </pre>
                <div>
                  <CopyButton
                    text={job.failure_reason}
                    label="Copy failure reason"
                  />
                </div>
              </div>
            ) : (
              <p className="text-slate-500">{describeMissingReason(job)}</p>
            )}
          </Field>

          <Field label="CREATED">
            <p>{formatDateTime(job.created_at)}</p>
            <p className="mt-1 text-slate-500">
              {formatRelative(job.created_at)}
            </p>
          </Field>
        </dl>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 p-6 text-xs text-slate-500">
          <span>
            {refreshError
              ? "Couldn't refresh this job. Showing the last known state."
              : live
                ? "Refreshing every 5 seconds"
                : "Auto-refresh is paused"}
          </span>
          <CopyButton text={String(job.id)} label="Copy job ID">
            Copy job ID
          </CopyButton>
        </footer>
      </aside>
    </div>
  );
}

export default JobDetailsDrawer;
