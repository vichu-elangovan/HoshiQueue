import assert from "node:assert/strict";
import { test } from "node:test";

import { formatSuccessRate, metricNote, throughputCaption } from "./overview.js";

const stats = (overrides = {}) => ({
  total_jobs: 78,
  queued: 6,
  processing: 4,
  completed: 47,
  failed: 14,
  success_rate: 60.26,
  ...overrides,
});

test("the Successful note shows the rate the API reports, not a fixed number", () => {
  assert.equal(metricNote("Successful", stats()), "60.26% success rate");
  assert.equal(metricNote("Successful", stats({ success_rate: 100 })), "100% success rate");
  assert.equal(metricNote("Successful", stats({ success_rate: 0 })), "0% success rate");
});

test("the Successful note says N/A when no job has finished", () => {
  const expected = "N/A · no finished jobs yet";
  assert.equal(metricNote("Successful", stats({ success_rate: null })), expected);
  assert.equal(metricNote("Successful", stats({ success_rate: undefined })), expected);
});

test("a rate of 0 is a real result, not N/A", () => {
  assert.equal(metricNote("Successful", stats({ success_rate: 0 })), "0% success rate");
  assert.equal(formatSuccessRate(0), "0%");
});

test("the success rate is formatted as a percentage, or N/A when nothing finished", () => {
  assert.equal(formatSuccessRate(77.05), "77.05%");
  assert.equal(formatSuccessRate(100), "100%");
  assert.equal(formatSuccessRate(null), "N/A");
  assert.equal(formatSuccessRate(undefined), "N/A");
  assert.equal(formatSuccessRate(Number.NaN), "N/A");
});

test("the throughput caption says jobs are counted when created, not completed", () => {
  const caption = throughputCaption("Last 24 hours");
  assert.equal(caption, "Jobs created (not completed) · Last 24 hours");
  assert.match(caption, /created/i);
  assert.match(caption, /not completed/i);
});

test("queue depth and failure notes follow the real counts", () => {
  assert.equal(metricNote("Queue depth", stats({ queued: 3 })), "Waiting for workers");
  assert.equal(metricNote("Queue depth", stats({ queued: 0 })), "No jobs waiting");
  assert.equal(metricNote("Failed executions", stats({ failed: 1 })), "Require investigation");
  assert.equal(metricNote("Failed executions", stats({ failed: 0 })), "No failed jobs");
});

test("the total card keeps its label", () => {
  assert.equal(metricNote("Total executions", stats()), "Recorded jobs");
});

test("every note is unavailable while stats are loading or failed", () => {
  for (const name of ["Total executions", "Successful", "Queue depth", "Failed executions"]) {
    assert.equal(metricNote(name, null), "—");
  }
});

test("an unknown card name never invents a value", () => {
  assert.equal(metricNote("Something else", stats()), "—");
});
