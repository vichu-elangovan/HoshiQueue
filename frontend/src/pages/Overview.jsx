import { useEffect, useState } from "react";
import {
  getDashboardStats,
  getJobs,
  createJob,
  getHealth,
  getThroughput,
} from "../api";
import {
  Bell, CheckCircle2, ChevronDown, Clock3, Database,
  GitBranch, Layers3, Network, Plus, Search, Server,
  XCircle, Zap
} from "lucide-react";

import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from "recharts";

import Panel from "../components/Panel";
import Status from "../components/Status";
import { formatSuccessRate, metricNote, throughputCaption } from "../lib/overview";

const metrics = [
  { name: "Total executions", icon: Layers3, color: "text-violet-400" },
  { name: "Successful", icon: CheckCircle2, color: "text-emerald-400" },
  { name: "Queue depth", icon: Clock3, color: "text-cyan-400" },
  { name: "Failed executions", icon: XCircle, color: "text-rose-400" },
];


function Overview() {
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [newTaskName, setNewTaskName] = useState("send_email");
  const [creating, setCreating] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [throughput, setThroughput] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("last_60_minutes");


useEffect(() => {
  let isMounted = true;

  const fetchDashboardData = async () => {
    try {
      const [statsData, jobsData, healthData, throughputData] =
        await Promise.all([
          getDashboardStats(),
          getJobs(),
          getHealth(),
          getThroughput(selectedPeriod),
        ]);

      if (isMounted) {
        setStats(statsData);
        setJobs(jobsData.jobs);
        setHealth(healthData.components);
        setThroughput(throughputData.data);
        setError("");
      }
    } catch (err) {
      console.error("Dashboard refresh failed:", err);

      if (isMounted) {
        setError("Could not refresh dashboard data.");
      }
    } finally {
      if (isMounted) {
        setLoading(false);
      }
    }
  };

  fetchDashboardData();

  const intervalId = setInterval(fetchDashboardData, 5000);

  return () => {
    isMounted = false;
    clearInterval(intervalId);
  };
}, [selectedPeriod]);
const handleCreateJob = async (e) => {
  e.preventDefault();

  if (!newTaskName.trim()) return;

  try {
    setCreating(true);

    await createJob(newTaskName.trim());

    setShowCreateJob(false);
    setNewTaskName("send_email");

    const [statsData, jobsData] = await Promise.all([
      getDashboardStats(),
      getJobs(),
    ]);

    setStats(statsData);
    setJobs(jobsData.jobs);
    setError("");
  } catch (err) {
    console.error("Job creation failed:", err);
    setError("Could not create job. Please try again.");
  } finally {
    setCreating(false);
  }
};

  return (
    <>
      {/* Workspace */}
      <main className="min-w-0 flex-1 px-5 py-7 md:px-10 md:py-10 xl:px-12">

        {/* Header */}
        <header className="mb-9 flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
              <span>HoshiQueue</span>
              <span>/</span>
              <span className="text-violet-400">Engineering workspace</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              System overview
            </h2>
            <p className="mt-2 text-sm text-slate-400 md:text-base">
              Observe. Debug. Orchestrate.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-400">
              <Search size={19} />
            </button>
            <button className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-400">
              <Bell size={19} />
            </button>
            <button
              onClick={() => setShowCreateJob(true)}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold"
            >
              <Plus size={18} /> New job
            </button>
          </div>
        </header>

        {/* Preview notice */}
        
        {/* Metrics */}
        <section>
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-wide text-slate-300">EXECUTION METRICS</h3>
            <span className="text-xs text-slate-500">All recorded jobs</span>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-4">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.name} className="rounded-2xl border border-slate-800 bg-[#0d1425] p-6 transition hover:border-violet-500/30">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-400">{metric.name}</p>
                    <Icon size={21} className={metric.color} />
                  </div>
                  <h3 className="mt-6 text-4xl font-bold tracking-tight">
                    {loading
                      ? "..."
                      : error
                        ? "—"
                        : ({
                            "Total executions": stats.total_jobs,
                            "Successful": stats.completed,
                            "Queue depth": stats.queued,
                            "Failed executions": stats.failed,
                          }[metric.name] ?? 0)}
                  </h3>
                  <p className="mt-3 text-xs text-slate-500">
                    {metricNote(metric.name, loading || error ? null : stats)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Main analytics */}
        <section className="mt-9 grid grid-cols-1 gap-6 2xl:grid-cols-3">

          <Panel className="2xl:col-span-2">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold">
                    Execution throughput
                  </h3>

                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    LIVE
                  </span>
                </div>

                <p className="mt-2 text-sm text-slate-500">
                  {throughputCaption(
                    selectedPeriod === "last_60_minutes"
                      ? "Last 60 minutes"
                      : selectedPeriod === "last_24_hours"
                      ? "Last 24 hours"
                      : "Last 7 days"
                  )}
                </p>
              </div>
              <div className="relative">
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="appearance-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-8 text-xs text-slate-300 outline-none focus:border-violet-500"
                >
                  <option value="last_60_minutes">Last 60 minutes</option>
                  <option value="last_24_hours">Last 24 hours</option>
                  <option value="last_7_days">Last 7 days</option>
                </select>

                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
              </div>
            </div>

            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={throughput}>
                  <defs>
                    <linearGradient id="throughputFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#253047" strokeDasharray="4 5" vertical={false} />
                  <XAxis
                    dataKey="time"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    interval={2}
                    dy={12}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#10182b",
                      border: "1px solid #334155",
                      borderRadius: "12px",
                      color: "#f8fafc",
                    }}
                    labelFormatter={(label) => `Time: ${label}`}
                    formatter={(value) => [`${value} jobs`, "Created"]}
                  />
                  <Area type="monotone" dataKey="jobs" stroke="#a78bfa" strokeWidth={3} fill="url(#throughputFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Execution pipeline</h3>
                <p className="mt-2 text-sm text-slate-500">Current job distribution</p>
              </div>
              <GitBranch size={20} className="text-violet-400" />
            </div>

            <div className="mt-8 space-y-7">
              {[
                { label: "Queued", count: stats?.queued ?? 0, color: "bg-cyan-400" },
                { label: "Processing", count: stats?.processing ?? 0, color: "bg-violet-400" },
                { label: "Completed", count: stats?.completed ?? 0, color: "bg-emerald-400" },
                { label: "Failed", count: stats?.failed ?? 0, color: "bg-rose-400" },
              ].map((item) => (
                <div key={item.label}>
                  <div className="mb-3 flex justify-between text-sm">
                    <span className="text-slate-400">{item.label}</span>
                    <span className="font-semibold">{item.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${item.color}`}
                      style={{
                        width: `${stats?.total_jobs ? (item.count / stats.total_jobs) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-9 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Zap size={16} className="text-cyan-400" />
                Reliability score
              </div>
              <p className="mt-3 text-3xl font-bold">
                {loading ? "..." : error ? "—" : formatSuccessRate(stats?.success_rate)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Completed ÷ (completed + failed)</p>
            </div>
          </Panel>
        </section>

        {/* Infrastructure */}
        <section className="mt-9">
          <div className="mb-5">
            <h3 className="text-sm font-semibold tracking-wide text-slate-300">INFRASTRUCTURE</h3>
            <p className="mt-2 text-sm text-slate-500">Application components and connectivity</p>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {[
              { name: "FastAPI", detail: "HTTP API service", icon: Network },
              { name: "Redis", detail: "Job stream and delivery", icon: Database },
              { name: "PostgreSQL", detail: "Persistent job storage", icon: Server },
            ].map((service) => {
              const Icon = service.icon;
              return (
                <div key={service.name} className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-[#0d1425] p-5">
                  <div className="rounded-xl bg-slate-800 p-3">
                    <Icon size={22} className="text-violet-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold">{service.name}</h4>
                    <p className="mt-1 text-xs text-slate-500">{service.detail}</p>
                  </div>
                  <span
                    className={`text-[10px] font-semibold tracking-wider ${
                      health?.[
                        service.name === "FastAPI"
                          ? "fastapi"
                          : service.name === "Redis"
                            ? "redis"
                            : "postgresql"
                      ] === "healthy"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {health?.[
                      service.name === "FastAPI"
                        ? "fastapi"
                        : service.name === "Redis"
                          ? "redis"
                          : "postgresql"
                    ]?.toUpperCase() ?? "CHECKING..."}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Job explorer */}
        <Panel className="mt-9">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Recent executions</h3>
              <p className="mt-2 text-sm text-slate-500">Inspect the latest background tasks</p>
            </div>
            <button
              onClick={() => {
                window.location.hash = "#/jobs";
              }}
              className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-violet-500/40"
            >
              View job explorer →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs tracking-wide text-slate-500">
                  <th className="pb-4 font-medium">JOB ID</th>
                  <th className="pb-4 font-medium">TASK</th>
                  <th className="pb-4 font-medium">EXECUTION STATUS</th>
                  <th className="pb-4 font-medium">ATTEMPTS</th>
                  <th className="pb-4 font-medium">DETAILS</th>
                </tr>
              </thead>
              
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-slate-800/70 hover:bg-slate-800/20"
                  >
                    <td className="py-5 font-semibold text-violet-300">
                      #{job.id}
                    </td>

                    <td className="py-5 font-medium text-slate-200">
                      {job.task_name}
                    </td>

                    <td className="py-5">
                      <Status
                        value={
                          job.status.charAt(0).toUpperCase() +
                          job.status.slice(1)
                        }
                      />
                    </td>

                    <td className="py-5 text-slate-400">
                      {job.attempts} / {job.max_attempts}
                    </td>

                    <td className="py-5 text-slate-400">
                      {job.failure_reason || "—"}
                    </td>
                  </tr>
                ))}

                {jobs.length === 0 && (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-slate-500">
                      No jobs found.
                    </td>
                  </tr>
                )}
              </tbody>

            </table>
          </div>
          <p className="mt-5 text-xs text-slate-500">Showing {jobs.length} of {stats?.total_jobs ?? 0} job records</p>
        </Panel>

        <footer className="mt-10 border-t border-slate-800 pt-6 text-xs text-slate-600">
          HoshiQueue · Engineering Workspace · Built with purpose.
        </footer>
      </main>
      {showCreateJob && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151525] p-6 shadow-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">
          Create New Job
        </h2>

        <button
          type="button"
          onClick={() => setShowCreateJob(false)}
          className="text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>

      <form onSubmit={handleCreateJob}>
        <label className="mb-2 block text-sm text-gray-300">
          Select task
        </label>

        <select
          value={newTaskName}
          onChange={(e) => setNewTaskName(e.target.value)}
          className="mb-6 w-full rounded-xl border border-white/10 bg-[#202035] p-3 text-white outline-none"
        >
          <option value="send_email">Send Email</option>
          <option value="slow_test">Slow Test</option>
        </select>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setShowCreateJob(false)}
            className="rounded-xl px-4 py-2 text-sm text-gray-300 hover:bg-white/10"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Job"}
          </button>
        </div>
      </form>
    </div>
  </div>
)}
    </>
  );
}

export default Overview;
