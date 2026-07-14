import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const researchPath = new URL(
  "../js/pages/enrichmentResearch.js",
  import.meta.url
);
const picksPath = new URL("../js/pages/dailyPicks.js", import.meta.url);
const serviceWorkerPath = new URL("../service-worker.js", import.meta.url);

test("research UI keeps evidence links clickable and safe", async () => {
  const source = await readFile(researchPath, "utf8");
  assert.match(source, /target:\s*"_blank"/);
  assert.match(source, /rel:\s*"noopener noreferrer"/);
  assert.match(source, /\["http:",\s*"https:"\]/);
  assert.match(source, /sources_count/);
  assert.match(source, /host === "localhost"/);
  assert.match(source, /192\\\.168/);
});

test("research UI requires explicit review before applying candidates", async () => {
  const source = await readFile(researchPath, "utf8");
  assert.match(source, /research\.accept/);
  assert.match(source, /research\.reject/);
  assert.match(source, /decision === "accepted"/);
  assert.match(source, /force:\s*decision === "accepted"/);
  assert.match(source, /research\.replace_confirm/);
  assert.match(source, /research\.existing_value/);
});

test("occasion affects ranking without silently enabling strict matching", async () => {
  const source = await readFile(picksPath, "utf8");
  assert.match(source, /OCCASIONS/);
  assert.match(source, /strict_text_match:\s*strictDishInput\.checked/);
  assert.doesNotMatch(
    source,
    /Boolean\(dishInput\.value\.trim\(\) \|\| moodInput\.value\.trim\(\)\)/
  );
  assert.match(source, /recommendations\?explain=true/);
  assert.match(source, /diagnosticsView/);
});

test("service worker includes research UI in a versioned shell", async () => {
  const source = await readFile(serviceWorkerPath, "utf8");
  assert.match(source, /js\/pages\/enrichmentResearch\.js/);
  assert.match(source, /winecellar-shell-v\d+/);
});
