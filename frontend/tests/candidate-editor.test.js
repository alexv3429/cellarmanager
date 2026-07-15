import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseCandidateEditJson } from "../js/pages/candidateEditor.js";

const researchPath = new URL("../js/pages/enrichmentResearch.js", import.meta.url);
const serviceWorkerPath = new URL("../service-worker.js", import.meta.url);

test("candidate edit parser accepts objects and arrays", () => {
  assert.deepEqual(parseCandidateEditJson('{"amount": 42}'), { amount: 42 });
  assert.deepEqual(parseCandidateEditJson('[{"dish": "fish"}]'), [{ dish: "fish" }]);
});

test("candidate edit parser rejects malformed JSON and primitives", () => {
  assert.throws(() => parseCandidateEditJson("not json"), /valid JSON/i);
  assert.throws(() => parseCandidateEditJson('"text"'), /valid JSON/i);
  assert.throws(() => parseCandidateEditJson("null"), /valid JSON/i);
});

test("research review saves edits through the candidate endpoint", async () => {
  const research = await readFile(researchPath, "utf8");
  const serviceWorker = await readFile(serviceWorkerPath, "utf8");

  assert.match(research, /createCandidateEditor/);
  assert.match(research, /api\.put\(`\/enrichment\/candidates\/\$\{candidate\.id\}`/);
  assert.match(serviceWorker, /js\/pages\/candidateEditor\.js/);
  assert.match(serviceWorker, /winecellar-shell-v12/);
});
