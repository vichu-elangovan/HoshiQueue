import {
  Activity, BriefcaseBusiness, Cpu, Database, LayoutDashboard,
  Settings, ShieldCheck, Terminal, Workflow
} from "lucide-react";

import NavItem from "./components/NavItem";
import useHashRoute, { getRoutePath } from "./hooks/useHashRoute";
import JobExplorer from "./pages/JobExplorer";
import Overview from "./pages/Overview";

// Pages that exist. A nav item whose path is not listed here shows as "Soon".
const PAGES = {
  "/": Overview,
  "/jobs": JobExplorer,
};

const WORKSPACE_NAV = [
  { icon: LayoutDashboard, label: "Overview", path: "/" },
  { icon: BriefcaseBusiness, label: "Job Explorer", path: "/jobs" },
  { icon: Activity, label: "Observability" },
  { icon: Workflow, label: "Queue Management", path: "/queue" },
];

// Nothing in the backend exposes these yet.
const INFRASTRUCTURE_NAV = [
  { icon: Cpu, label: "Workers" },
  { icon: Database, label: "Redis & Database" },
  { icon: ShieldCheck, label: "Dead Letter Queue" },
  { icon: Settings, label: "Configuration" },
];

function App() {
  const requestedRoute = getRoutePath(useHashRoute());
  // Unknown hashes fall back to the overview.
  const route = PAGES[requestedRoute] ? requestedRoute : "/";
  const Page = PAGES[route];

  const renderNav = (items) =>
    items.map((item) => (
      <NavItem
        key={item.label}
        icon={item.icon}
        label={item.label}
        href={PAGES[item.path] ? `#${item.path}` : undefined}
        active={item.path === route}
        soon={!PAGES[item.path]}
      />
    ));

  return (
    <div className="min-h-screen bg-[#080d19] text-slate-100 md:flex">
      {/* Phones: compact top bar. Only pages that exist are listed. */}
      <nav
        aria-label="Primary"
        className="sticky top-0 z-40 flex items-center gap-2 border-b border-slate-800 bg-[#0b1120]/95 px-4 py-2.5 backdrop-blur md:hidden"
      >
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600">
            <Workflow size={19} />
          </div>
          <span className="hidden text-lg font-bold min-[380px]:inline">
            Hoshi<span className="text-violet-400">Queue</span>
          </span>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
          {WORKSPACE_NAV.filter((item) => PAGES[item.path]).map((item) => (
            <a
              key={item.label}
              href={`#${item.path}`}
              aria-current={item.path === route ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium ${
                item.path === route
                  ? "bg-violet-500/15 text-violet-300"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
              }`}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>


      {/* Navigation */}
      <aside className="hidden w-full shrink-0 flex-col border-b border-slate-800 bg-[#0b1120] p-6 md:sticky md:top-0 md:h-screen md:flex md:w-[260px] md:border-r md:border-b-0">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600">
            <Workflow size={23} />
          </div>
          <div>
            <h1 className="text-xl font-bold">Hoshi<span className="text-violet-400">Queue</span></h1>
            <p className="mt-1 text-[10px] tracking-[0.2em] text-slate-500">ENGINEERING PLATFORM</p>
          </div>
        </div>

        <div className="mt-12">
          <p className="mb-4 px-3 text-[10px] font-bold tracking-[0.2em] text-slate-600">WORKSPACE</p>
          <nav className="space-y-2">
            {renderNav(WORKSPACE_NAV)}
          </nav>
        </div>

        <div className="mt-10">
          <p className="mb-4 px-3 text-[10px] font-bold tracking-[0.2em] text-slate-600">INFRASTRUCTURE</p>
          <nav className="space-y-2">
            {renderNav(INFRASTRUCTURE_NAV)}
          </nav>
        </div>

        <div className="mt-auto hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-5 md:block">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Terminal size={17} className="text-violet-400" />
            Developer workspace
          </div>
          <p className="mt-3 text-xs leading-6 text-slate-500">
            Built for reliable asynchronous execution and distributed job processing.
          </p>
          <div className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">
            HoshiQueue · v1.0
          </div>
        </div>
      </aside>

      <Page />
    </div>
  );
}

export default App;
