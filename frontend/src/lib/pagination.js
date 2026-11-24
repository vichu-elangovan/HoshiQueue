// Page numbers (0-based) to show, with "gap" markers where pages are skipped.
// Always includes the first page, the last page and the current page's neighbours.
export function pageItems(current, count) {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index);

  const start = Math.max(1, current - 1);
  const end = Math.min(count - 2, current + 1);

  const items = [0];
  if (start > 1) items.push("gap-start");
  for (let index = start; index <= end; index += 1) items.push(index);
  if (end < count - 2) items.push("gap-end");
  items.push(count - 1);

  return items;
}
