import { useSyncExternalStore } from "react";

// "#/jobs/42?status=failed" -> "/jobs/42?status=failed"; "" or "#" -> "/"
export function parseHash(hash) {
  const path = hash.replace(/^#/, "");
  return path.startsWith("/") ? path : `/${path}`;
}

// "/jobs/42?status=failed" -> "/jobs"; "/" -> "/"
export function getRoutePath(path) {
  const [first] = path.split("?")[0].split("/").filter(Boolean);
  return first ? `/${first}` : "/";
}

function subscribe(callback) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

const getSnapshot = () => parseHash(window.location.hash);
const getServerSnapshot = () => "/";

// Current hash path, re-rendering whenever the hash changes.
export default function useHashRoute() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
