import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("CSV wizard exposes a real reset that clears the selected file", async () => {
  const source = await read("frontend/js/pages/importPage.js");
  assert.match(source, /function resetWizard/);
  assert.match(source, /fileInput\.value = ""/);
  assert.match(source, /import\.import_another/);
  assert.match(source, /importButton\.disabled = completed/);
});

test("cellar form explains location rules and exposes reconciliation", async () => {
  const source = await read("frontend/js/pages/cellars.js");
  assert.match(source, /cellars\.location_naming/);
  assert.match(source, /cellars\.location_rule_help/);
  assert.match(source, /\/cellars\/unassigned-summary/);
  assert.match(source, /\/cellars\/reconcile-unassigned/);
  assert.match(source, /reconciled_bottles/);
});

test("backend automatically reconciles after cellar create and update", async () => {
  const source = await read("backend/app/api/routers/cellars.py");
  const calls = source.match(/assignment_service\.reconcile_unassigned/g) || [];
  assert.ok(calls.length >= 3);
  assert.match(source, /only_cellar_id=cellar\.id/);
  assert.match(source, /only_cellar_id=existing\.id/);
});

test("service-worker cache is advanced for the new UI", async () => {
  const source = await read("frontend/service-worker.js");
  assert.match(source, /winecellar-shell-v7/);
});
