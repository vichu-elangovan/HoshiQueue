// Optional browser check: very long task names must wrap instead of widening the
// Job Explorer (table and phone cards) or the Job Details drawer.
//
// It builds the app, serves it with Vite and mocks the API inside the browser,
// so no backend, database or Redis is needed. It does need puppeteer-core and a
// local Chrome/Chromium. It is not part of `npm test` and adds no dependency to
// package.json:
//
//   npm install --no-save puppeteer-core
//   CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" npm run test:e2e
//
// Optional environment variables:
//   CHROME_ARGS=--no-sandbox      extra Chrome flags, space separated
//   CHROME_HEADLESS=shell         use the old headless mode
//   E2E_SCREENSHOT_DIR=./shots    save screenshots of the phone views

import { mkdirSync } from "node:fs";
import { build, preview } from "vite";

const chromePath = process.env.CHROME_PATH;
if (!chromePath) {
  console.error("Set CHROME_PATH to your Chrome/Chromium executable.");
  process.exit(2);
}

let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.error("puppeteer-core is missing. Run: npm install --no-save puppeteer-core");
  process.exit(2);
}

const API_ORIGIN = "http://127.0.0.1:8000"; // hard-coded in src/api.js

const LONG_SNAKE = "send_quarterly_financial_report_to_every_regional_subscriber_in_all_markets_v2";
const LONG_UNBROKEN = "long_" + "a".repeat(95); // 100 characters, the API's maximum

const job = (id, task_name, status, attempts, failure_reason = null) => ({
  id,
  task_name,
  status,
  attempts,
  max_attempts: 3,
  failure_reason,
  created_at: new Date(Date.now() - id * 60_000).toISOString(),
});

const JOBS = [
  job(5, "send_email", "queued", 0),
  job(4, LONG_UNBROKEN, "failed", 3, `Unknown task: ${LONG_UNBROKEN}`),
  job(3, LONG_SNAKE, "failed", 3, `Unknown task: ${LONG_SNAKE}`),
  job(2, "slow_test", "processing", 1),
  job(1, "send_email", "completed", 1),
];

function respond(path) {
  if (path === "/jobs") return { total: JOBS.length, limit: 25, offset: 0, jobs: JOBS };
  if (/^\/jobs\/\d+$/.test(path)) return JOBS.find((j) => j.id === Number(path.split("/")[2]));
  if (path === "/dashboard/stats") {
    return { total_jobs: 5, queued: 1, processing: 1, completed: 1, failed: 2, success_rate: 33.33 };
  }
  if (path === "/health") {
    return {
      status: "healthy",
      service: "hoshi-queue",
      components: { fastapi: "healthy", postgresql: "healthy", redis: "healthy" },
    };
  }
  if (path === "/analytics/throughput") return { period: "last_60_minutes", total: 0, data: [] };
  return null;
}

async function mockApi(page) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== API_ORIGIN) return request.continue();
    if (request.method() === "OPTIONS") return request.respond({ status: 204, headers: cors });

    const body = respond(url.pathname);
    return request.respond({
      status: body ? 200 : 404,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify(body ?? { detail: "Not found" }),
    });
  });
}

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`);
}

await build({ root: process.cwd(), logLevel: "silent" });
const server = await preview({
  root: process.cwd(),
  logLevel: "silent",
  preview: { host: "127.0.0.1", port: 4173, strictPort: false },
});
const appUrl = server.resolvedUrls.local[0];

const browser = await puppeteer.launch({
  executablePath: chromePath,
  args: (process.env.CHROME_ARGS ?? "").split(" ").filter(Boolean),
  headless: process.env.CHROME_HEADLESS === "shell" ? "shell" : true,
});

const shots = process.env.E2E_SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });

async function open(viewport, route) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await mockApi(page);
  await page.goto(`${appUrl}${route}`, { waitUntil: "networkidle0" });
  return page;
}

const pageWidths = (page) =>
  page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));

const dialogWidths = (page) =>
  page.$eval('[role="dialog"]', (d) => ({ visible: d.clientWidth, content: d.scrollWidth }));

const openJobCard = (page, taskName) =>
  page.evaluate((name) => {
    const card = [...document.querySelectorAll("main ul li button")].find((b) => b.textContent.includes(name));
    card.click();
  }, taskName);

// ---- phone: cards and drawer ----
{
  const phone = { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 };
  const page = await open(phone, "#/jobs");
  await page.waitForSelector("main ul li");

  let w = await pageWidths(page);
  check("phone: Explorer cards do not widen the page", w.content <= w.viewport && w.viewport === 390, JSON.stringify(w));
  if (shots) await page.screenshot({ path: `${shots}/phone-cards.png`, fullPage: true });

  for (const [label, name] of [["unbroken 100-char", LONG_UNBROKEN], ["long snake_case", LONG_SNAKE]]) {
    await openJobCard(page, name);
    await page.waitForSelector('[role="dialog"]');
    const d = await dialogWidths(page);
    w = await pageWidths(page);
    check(`phone: drawer fits a ${label} task name`, d.content <= d.visible + 1 && w.viewport === 390, JSON.stringify({ ...d, page: w }));
    if (shots && name === LONG_UNBROKEN) await page.screenshot({ path: `${shots}/phone-drawer.png` });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  }
  await page.close();
}

// ---- phone: the dashboard's recent-jobs table must stay inside its own scroll area ----
{
  const page = await open({ width: 390, height: 844, isMobile: true }, "#/");
  await page.waitForSelector("table");
  const w = await pageWidths(page);
  check("phone: Overview page is not widened by long task names", w.viewport === 390 && w.content <= w.viewport, JSON.stringify(w));
  await page.close();
}

// ---- desktop: table and drawer ----
{
  const page = await open({ width: 1440, height: 900 }, "#/jobs");
  await page.waitForSelector("tbody tr");

  const t = await page.evaluate(() => {
    const scroller = document.querySelector("table").parentElement;
    const cells = [...document.querySelectorAll("tbody tr td:nth-child(2)")];
    return {
      scrollerVisible: scroller.clientWidth,
      scrollerContent: scroller.scrollWidth,
      cellCount: cells.length,
      // width of the rendered text itself (the cell may be wider than its text)
      widestTaskText: Math.max(
        ...cells.map((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          return Math.round(range.getBoundingClientRect().width);
        })
      ),
    };
  });
  check("desktop: the table does not scroll sideways because of a long name", t.scrollerContent <= t.scrollerVisible + 1, JSON.stringify(t));
  check("desktop: task names wrap within 260px", t.cellCount === JOBS.length && t.widestTaskText <= 262, `${t.widestTaskText}px`);

  await page.click('button[aria-label="Open details for job 4"]');
  await page.waitForSelector('[role="dialog"]');
  const d = await dialogWidths(page);
  check("desktop: drawer fits a 100-char task name", d.content <= d.visible + 1, JSON.stringify(d));
  await page.close();
}

await browser.close();
await server.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
