import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageItems } from "../lib/pagination";

const BASE =
  "flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm disabled:pointer-events-none disabled:opacity-40";
const IDLE =
  "border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white";
const ACTIVE = "border-violet-500/50 bg-violet-500/15 text-violet-300";

// `page` is 0-based; labels shown to the user are 1-based.
function Pagination({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        aria-label="Previous page"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
        className={`${BASE} ${IDLE}`}
      >
        <ChevronLeft size={16} />
      </button>

      {pageItems(page, pageCount).map((item) =>
        typeof item === "number" ? (
          <button
            key={item}
            type="button"
            aria-label={`Page ${item + 1}`}
            aria-current={item === page ? "page" : undefined}
            onClick={() => onChange(item)}
            className={`${BASE} ${item === page ? ACTIVE : IDLE}`}
          >
            {item + 1}
          </button>
        ) : (
          <span key={item} aria-hidden="true" className="px-1 text-slate-600">
            …
          </span>
        )
      )}

      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pageCount - 1}
        onClick={() => onChange(page + 1)}
        className={`${BASE} ${IDLE}`}
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

export default Pagination;
