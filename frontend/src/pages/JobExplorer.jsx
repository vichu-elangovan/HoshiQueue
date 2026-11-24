import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search, SearchX, TriangleAlert, X } from "lucide-react";

import { getJob, getJobs } from "../api";
import AttemptsBar from "../components/AttemptsBar";
import JobDetailsDrawer from "../components/JobDetailsDrawer";
import Pagination from "../components/Pagination";
import Panel from "../components/Panel";
import Status from "../components/Status";
import useDebouncedValue from "../hooks/useDebouncedValue";
import { capitalize, formatDateTime, formatRelative } from "../lib/format";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

const SEARCH_MODES = [
  { value: "task", label: "Task name" },
  { value: "id", label: "Job ID" },
];

const PAGE_SIZES = [10, 25, 50];
const REFRESH_MS = 5000;
const MAX_JOB_ID = 2147483647; // PostgreSQL INTEGER; larger IDs make the API fail

// "42" -> 42, anything that cannot be a real job ID -> null
function parseJobId(text) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const id = Number(trimmed);
  return id >= 1 && id <= MAX_JOB_ID ? id : null;
}

function describeError(error) {
  if (!error.response) {
    return "Can't reach the HoshiQueue API. Check that the backend is running.";
  }
  const detail = error.response.data?.detail;
  return typeof detail === "string"
    ? detail
    : `The API returned an error (HTTP ${error.response.status}).`;
}

// Re-renders itself every second so "Updated 4s ago" stays current without
// re-rendering the whole table.
function UpdatedAgo({ at }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!at) return null;
  return (
    <span className="text-xs text-slate-500">
      Updated {formatRelative(at, now)}
    </span>
  );
}

function FailureReason({ value }) {
  if (!value) return <span className="text-slate-600">—</span>;
  return (
    <span className="block max-w-[260px] truncate text-slate-400" title={value}>
      {value}
    </span>
  );
}

function JobExplorer() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchMode, setSearchMode] = useState("task");
  const [searchInput, setSearchInput] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [live, setLive] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const [data, setData] = useState(null); // { total, jobs } once loaded
  const [busy, setBusy] = useState(false); // user-driven load in flight
  const [refreshing, setRefreshing] = useState(false); // any load in flight
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selected, setSelected] = useState(null);

  // Task-name search is debounced; the status filter and ID lookup are not.
  const debouncedInput = useDebouncedValue(searchInput.trim(), 350);
  const idMode = searchMode === "id";
  const taskQuery = idMode ? "" : debouncedInput;
  const idValue = idMode ? parseJobId(debouncedInput) : null;
  const idInvalid = idMode && searchInput.trim() !== "" && parseJobId(searchInput) === null;
  const lookingUpId = idValue !== null;

  // The page resets to the first one whenever the query changes, without an
  // effect: a stored page only counts while its query key still matches.
  const queryKey = `${searchMode}|${taskQuery}|${idValue}|${statusFilter}|${pageSize}`;
  const [pageState, setPageState] = useState({ key: queryKey, page: 0 });
  const page = pageState.key === queryKey ? pageState.page : 0;
  const goToPage = (next) => setPageState({ key: queryKey, page: next });

  useEffect(() => {
    // Aborted when the query changes or the page unmounts, so a slow response
    // for an old query can never overwrite newer results.
    const stale = new AbortController();

    async function load(silent) {
      if (silent && document.hidden) return;

      setRefreshing(true);
      if (!silent) setBusy(true);

      try {
        let result;

        if (idValue !== null) {
          try {
            result = { total: 1, jobs: [await getJob(idValue)] };
          } catch (err) {
            if (err.response?.status !== 404) throw err;
            result = { total: 0, jobs: [] };
          }
        } else {
          const params = { limit: pageSize, offset: page * pageSize };
          if (statusFilter !== "all") params.status = statusFilter;
          if (taskQuery) params.q = taskQuery;
          result = await getJobs(params);
        }

        if (stale.signal.aborted) return;

        // The result set can shrink while auto-refreshing (for example the
        // "queued" list as jobs finish). Step back to the last page that exists.
        const lastPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
        if (idValue === null && page > lastPage) {
          setPageState({ key: queryKey, page: lastPage });
          return;
        }

        setData(result);
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        if (!stale.signal.aborted) setError(describeError(err));
      } finally {
        if (!stale.signal.aborted) {
          setRefreshing(false);
          setBusy(false);
        }
      }
    }

    load(false);

    const timer = live ? setInterval(() => load(true), REFRESH_MS) : null;
    const onVisible = () => {
      if (!document.hidden) load(true);
    };
    if (live) document.addEventListener("visibilitychange", onVisible);

    return () => {
      stale.abort();
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queryKey, idValue, taskQuery, statusFilter, pageSize, page, live, refreshTick]);

  const closeDrawer = useCallback(() => setSelected(null), []);

  const changeMode = (mode) => {
    setSearchMode(mode);
    setSearchInput("");
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setSearchInput("");
  };

  const jobs = data?.jobs ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = statusFilter !== "all" || searchInput.trim() !== "";
  const firstShown = total === 0 ? 0 : page * pageSize + 1;
  const lastShown = page * pageSize + jobs.length;

  return (
    <main className="min-w-0 flex-1 px-5 py-7 md:px-10 md:py-10 xl:px-12">
      <header className="mb-9">
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          <span>HoshiQueue</span>
          <span>/</span>
          <span className="text-violet-400">Job explorer</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          Job explorer
        </h2>
        <p className="mt-2 text-sm text-slate-400 md:text-base">
          Search, filter and inspect every background job.
        </p>
      </header>

      <Panel>
        {/* Search and filters */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div
              role="group"
              aria-label="Search by"
              className="inline-flex shrink-0 gap-1 self-start rounded-xl border border-slate-800 bg-slate-900 p-1 text-sm"
            >
              {SEARCH_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  aria-pressed={searchMode === mode.value}
                  onClick={() => changeMode(mode.value)}
                  className={`rounded-lg px-3 py-1.5 ${
                    searchMode === mode.value
                      ? "bg-violet-500/15 text-violet-300"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 focus-within:border-violet-500/50">
              <Search size={17} className="shrink-0 text-slate-500" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={idMode ? "Job ID, e.g. 42" : "Task name, e.g. send_email"}
                aria-label={idMode ? "Job ID" : "Task name"}
                inputMode={idMode ? "numeric" : "text"}
                maxLength={idMode ? 10 : 100}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
              />
              {searchInput && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchInput("")}
                  className="shrink-0 text-slate-500 hover:text-white"
                >
                  <X size={16} />
                </button>
              )}
            </label>
          </div>

          {idInvalid && (
            <p role="status" className="text-xs text-amber-400">
              Job IDs are whole numbers between 1 and {MAX_JOB_ID.toLocaleString()}.
            </p>
          )}

          <div
            role="group"
            aria-label="Filter by status"
            className="flex flex-wrap items-center gap-2"
          >
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={statusFilter === filter.value}
                disabled={lookingUpId}
                onClick={() => setStatusFilter(filter.value)}
                className={`rounded-full border px-4 py-1.5 text-sm disabled:pointer-events-none disabled:opacity-40 ${
                  statusFilter === filter.value
                    ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                    : "border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white"
                }`}
              >
                {filter.label}
              </button>
            ))}
            {lookingUpId && (
              <span className="text-xs text-slate-500">
                Status filters don't apply to an ID lookup.
              </span>
            )}
          </div>
        </div>

        {/* Toolbar */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-5">
          <p aria-live="polite" className="text-sm text-slate-400">
            {data === null
              ? "Loading jobs…"
              : lookingUpId
                ? total === 1
                  ? `Job #${idValue}`
                  : `No job with ID #${idValue}`
                : total === 0
                  ? "0 jobs"
                  : `Showing ${firstShown}–${lastShown} of ${total.toLocaleString()} jobs`}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Rows
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                disabled={lookingUpId}
                className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 outline-none disabled:opacity-40"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              aria-pressed={live}
              onClick={() => setLive((current) => !current)}
              className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-700"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  live ? "animate-pulse bg-emerald-400" : "bg-slate-600"
                }`}
              />
              {live ? "Live" : "Paused"}
            </button>

            <UpdatedAgo at={lastUpdated} />

            <button
              type="button"
              aria-label="Refresh now"
              onClick={() => setRefreshTick((tick) => tick + 1)}
              className="rounded-lg border border-slate-800 p-2 text-slate-400 hover:text-white"
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300"
          >
            <TriangleAlert size={18} className="shrink-0" />
            <span className="min-w-0 flex-1">
              {error}
              {live && " Retrying automatically."}
            </span>
            <button
              type="button"
              onClick={() => setRefreshTick((tick) => tick + 1)}
              className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-rose-200"
            >
              Try again
            </button>
          </div>
        )}

        {/* Results */}
        <div className={`mt-5 ${busy ? "opacity-60" : ""}`}>
          {data === null && !error && (
            <div className="flex flex-col gap-3" aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-xl bg-slate-800/40" />
              ))}
            </div>
          )}

          {data !== null && jobs.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <SearchX size={32} className="text-slate-600" />
              <p className="font-medium text-slate-300">
                {lookingUpId
                  ? `No job with ID #${idValue}`
                  : hasFilters
                    ? "No jobs match your filters"
                    : "No jobs yet"}
              </p>
              <p className="max-w-sm text-sm text-slate-500">
                {hasFilters
                  ? "Try a different search or status, or clear the filters."
                  : "Jobs you create from the overview will show up here."}
              </p>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-violet-500/40"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {jobs.length > 0 && (
            <>
              {/* Table: tablets and up */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <caption className="sr-only">Background jobs</caption>
                  <thead>
                    <tr className="border-b border-slate-800 text-xs tracking-wide text-slate-500">
                      <th scope="col" className="pb-4 font-medium">JOB ID</th>
                      <th scope="col" className="pb-4 font-medium">TASK</th>
                      <th scope="col" className="pb-4 font-medium">STATUS</th>
                      <th scope="col" className="pb-4 font-medium">ATTEMPTS</th>
                      <th scope="col" className="pb-4 font-medium">FAILURE REASON</th>
                      <th scope="col" className="pb-4 font-medium">CREATED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr
                        key={job.id}
                        onClick={() => setSelected(job)}
                        className={`cursor-pointer border-b border-slate-800/70 hover:bg-slate-800/30 ${
                          selected?.id === job.id ? "bg-violet-500/5" : ""
                        }`}
                      >
                        <td className="py-4">
                          <button
                            type="button"
                            aria-label={`Open details for job ${job.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelected(job);
                            }}
                            className="font-semibold text-violet-300 hover:underline"
                          >
                            #{job.id}
                          </button>
                        </td>
                        <td className="py-4 font-medium text-slate-200">
                          <span className="block max-w-[260px] wrap-anywhere">{job.task_name}</span>
                        </td>
                        <td className="py-4">
                          <Status value={capitalize(job.status)} />
                        </td>
                        <td className="py-4">
                          <AttemptsBar
                            attempts={job.attempts}
                            maxAttempts={job.max_attempts}
                            status={job.status}
                          />
                        </td>
                        <td className="py-4">
                          <FailureReason value={job.failure_reason} />
                        </td>
                        <td
                          className="whitespace-nowrap py-4 text-slate-400"
                          title={formatDateTime(job.created_at)}
                        >
                          {formatRelative(job.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cards: phones */}
              <ul className="flex flex-col gap-3 md:hidden">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(job)}
                      className="flex w-full flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left hover:border-slate-700"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-violet-300">#{job.id}</span>
                        <Status value={capitalize(job.status)} />
                      </span>
                      <span className="font-medium text-slate-200 wrap-anywhere">{job.task_name}</span>
                      <span className="text-sm">
                        <AttemptsBar
                          attempts={job.attempts}
                          maxAttempts={job.max_attempts}
                          status={job.status}
                        />
                      </span>
                      {job.failure_reason && (
                        <span className="line-clamp-2 text-sm text-slate-400 wrap-anywhere">
                          {job.failure_reason}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">
                        {formatRelative(job.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {!lookingUpId && pageCount > 1 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-5">
            <span className="text-sm text-slate-500">
              Page {page + 1} of {pageCount}
            </span>
            <Pagination page={page} pageCount={pageCount} onChange={goToPage} />
          </div>
        )}
      </Panel>

      {selected && (
        <JobDetailsDrawer
          key={selected.id}
          jobId={selected.id}
          initialJob={selected}
          live={live}
          onClose={closeDrawer}
        />
      )}
    </main>
  );
}

export default JobExplorer;
