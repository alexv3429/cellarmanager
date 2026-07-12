// Run with: node --test frontend/tests/logic.test.js
// Only pure logic (no DOM/IndexedDB/fetch) is tested here, using Node's
// built-in test runner - deliberately zero npm dependencies. Page modules
// that touch `document`/`indexedDB`/`fetch` are exercised manually in a
// real browser instead (see docs/testing.md).
import test from "node:test";
import assert from "node:assert/strict";

import { interpolate } from "../js/i18n.js";
import {
  isQueueable,
  createOutboxEntry,
  orderForReplay,
  classifyReplayResult,
  generateClientOpId,
} from "../js/offlineQueue.js";
import { barChartSvg, donutChartSvg } from "../js/charts.js";

test("i18n interpolate: no params returns template unchanged", () => {
  assert.equal(interpolate("Hello world", undefined), "Hello world");
});

test("i18n interpolate: substitutes named params", () => {
  assert.equal(interpolate("{count} bottle(s)", { count: 5 }), "5 bottle(s)");
});

test("i18n interpolate: leaves unknown placeholders untouched", () => {
  assert.equal(interpolate("{fill} / {capacity}", { fill: 10 }), "10 / {capacity}");
});

test("offlineQueue: only add/move/remove are queueable", () => {
  assert.equal(isQueueable("holdings/add"), true);
  assert.equal(isQueueable("holdings/move"), true);
  assert.equal(isQueueable("holdings/remove"), true);
  assert.equal(isQueueable("wines/create"), false);
});

test("offlineQueue: createOutboxEntry rejects non-queueable actions", () => {
  assert.throws(() => createOutboxEntry("wines/create", {}));
});

test("offlineQueue: createOutboxEntry generates a client_op_id when missing", () => {
  const entry = createOutboxEntry("holdings/add", { wine_id: "w1", quantity: 2 }, 1000);
  assert.ok(entry.clientOpId.startsWith("op-"));
  assert.equal(entry.payload.client_op_id, entry.clientOpId);
  assert.equal(entry.createdAt, 1000);
  assert.equal(entry.attempts, 0);
});

test("offlineQueue: createOutboxEntry reuses a provided client_op_id (idempotent re-queue)", () => {
  const entry = createOutboxEntry("holdings/add", { wine_id: "w1", quantity: 2, client_op_id: "fixed-id" }, 1000);
  assert.equal(entry.clientOpId, "fixed-id");
});

test("offlineQueue: generateClientOpId produces unique ids", () => {
  const ids = new Set(Array.from({ length: 50 }, () => generateClientOpId()));
  assert.equal(ids.size, 50);
});

test("offlineQueue: orderForReplay sorts oldest first without mutating input", () => {
  const entries = [
    { createdAt: 300, clientOpId: "c" },
    { createdAt: 100, clientOpId: "a" },
    { createdAt: 200, clientOpId: "b" },
  ];
  const ordered = orderForReplay(entries);
  assert.deepEqual(ordered.map((e) => e.clientOpId), ["a", "b", "c"]);
  assert.deepEqual(entries.map((e) => e.clientOpId), ["c", "a", "b"], "must not mutate the original array");
});

test("offlineQueue: classifyReplayResult - 2xx is done", () => {
  assert.equal(classifyReplayResult(200, 5, 0), "done");
});

test("offlineQueue: classifyReplayResult - 409 is done (idempotent dedup or real conflict, either way no auto-retry)", () => {
  assert.equal(classifyReplayResult(409, 5, 0), "done");
});

test("offlineQueue: classifyReplayResult - other errors retry until the attempt cap", () => {
  assert.equal(classifyReplayResult(500, 5, 0), "retry");
  assert.equal(classifyReplayResult(500, 5, 3), "retry");
  assert.equal(classifyReplayResult(500, 5, 4), "give_up");
});

test("charts: barChartSvg handles an empty series without throwing", () => {
  const svg = barChartSvg([]);
  assert.match(svg, /<svg/);
});

test("charts: barChartSvg renders one bar per entry", () => {
  const svg = barChartSvg([{ label: "Red", value: 10 }, { label: "White", value: 5 }]);
  const rectCount = (svg.match(/<rect/g) || []).length;
  assert.equal(rectCount, 2);
});

test("charts: barChartSvg escapes label text to avoid markup injection", () => {
  const svg = barChartSvg([{ label: "<script>alert(1)</script>", value: 1 }]);
  assert.ok(!svg.includes("<script>alert"));
  assert.ok(svg.includes("&lt;script&gt;"));
});

test("charts: donutChartSvg with zero total does not divide by zero", () => {
  const svg = donutChartSvg([{ label: "Empty", value: 0 }]);
  assert.match(svg, /<svg/);
  assert.ok(!svg.includes("NaN"));
});

test("charts: donutChartSvg renders one segment per non-empty entry", () => {
  const svg = donutChartSvg([{ label: "Red", value: 6 }, { label: "White", value: 4 }]);
  const circleCount = (svg.match(/<circle/g) || []).length;
  assert.equal(circleCount, 2);
});
