import { Clock3 } from "lucide-react";

function NavItem({ icon: Icon, label, href, active = false, soon = false }) {
  const base = "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm";

  // Pages without a backend or a view yet are visible but not clickable.
  if (soon || !href) {
    return (
      <div
        aria-disabled="true"
        title="Coming soon"
        className={`${base} cursor-not-allowed text-slate-600`}
      >
        <Icon size={18} />
        <span className="whitespace-nowrap">{label}</span>
        <Clock3 size={14} aria-hidden="true" className="ml-auto shrink-0" />
        <span className="sr-only">(coming soon)</span>
      </div>
    );
  }

  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${base} ${
        active
          ? "bg-violet-500/15 text-violet-300"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
      }`}
    >
      <Icon size={18} />
      {label}
    </a>
  );
}

export default NavItem;
