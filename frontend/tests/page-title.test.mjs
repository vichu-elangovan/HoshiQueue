import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the page title is HoshiQueue, not the Vite template default", () => {
  assert.match(html, /<title>HoshiQueue<\/title>/);
  assert.doesNotMatch(html, /<title>frontend<\/title>/);
});
