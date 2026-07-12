import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyReplayResult,
  createOutboxEntry,
  orderForReplay,
} from "../js/offlineQueue.js";

test("real HTTP 409 is preserved as a conflict", () => {
  assert.equal(classifyReplayResult(409, 5, 0), "conflict");
});

test("successful duplicate response is complete", () => {
  assert.equal(classifyReplayResult(200, 5, 0), "done");
});

test("validation failures are dead-lettered instead of discarded", () => {
  assert.equal(classifyReplayResult(422, 5, 0), "dead_letter");
});

test("transient failures stay queued until the retry cap", () => {
  assert.equal(classifyReplayResult(0, 5, 0), "retry");
  assert.equal(classifyReplayResult(503, 5, 4), "dead_letter");
});

test("outbox operations retain chronological order and stable ids", () => {
  const later = createOutboxEntry("holdings/add", { wine_id: "w", quantity: 1 }, 20);
  const earlier = createOutboxEntry("holdings/add", { wine_id: "w", quantity: 1 }, 10);
  assert.deepEqual(orderForReplay([later, earlier]), [earlier, later]);
  assert.equal(earlier.payload.client_op_id, earlier.clientOpId);
});

import { readFile } from "node:fs/promises";

const projectRoot = new URL("../../", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, projectRoot), "utf8");

test("dependent queued operations are remapped from temporary to server holding ids", async () => {
  const dbSource = await readProjectFile("frontend/js/db.js");
  const apiSource = await readProjectFile("frontend/js/api.js");
  assert.match(dbSource, /export async function remapOutboxHoldingId/);
  assert.match(apiSource, /remapOutboxHoldingId\(temporaryId, result\.holding\.id\)/);
  assert.match(apiSource, /db\.remove\("holdings", temporaryId\)/);
});

test("failed replay retries preserve idempotency while conflict retries get a new operation id", async () => {
  const source = await readProjectFile("frontend/js/api.js");
  assert.match(source, /clientOpId: problem\.clientOpId/);
  assert.match(source, /payload: \{ \.\.\.problem\.payload, client_op_id: problem\.clientOpId \}/);
  assert.match(source, /entry = createOutboxEntry\(problem\.action, payload\)/);
});
