import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const detailsPath = new URL("../js/pages/bottleDetails.js", import.meta.url);
const bottlesPath = new URL("../js/pages/bottles.js", import.meta.url);
const serviceWorkerPath = new URL("../service-worker.js", import.meta.url);

test("bottle details uses accepted enrichment profile data", async () => {
  const source = await readFile(detailsPath, "utf8");

  assert.match(source, /\/enrichment-profile/);
  assert.match(source, /drinking_window:drinking_window/);
  assert.match(source, /composition:composition/);
  assert.match(source, /pairing:dish_pairings/);
  assert.match(source, /serving:serving_advice/);
  assert.match(source, /reviews:critical_reviews/);
  assert.match(source, /external_identifiers/);
  assert.match(source, /noopener noreferrer/);
});

test("bottles page exposes details and the PWA caches its modules", async () => {
  const bottles = await readFile(bottlesPath, "utf8");
  const serviceWorker = await readFile(serviceWorkerPath, "utf8");

  assert.match(bottles, /openBottleDetailsDialog/);
  assert.match(bottles, /bottleDetailsButtonLabel/);
  assert.match(serviceWorker, /js\/pages\/bottleDetails\.js/);
  assert.match(serviceWorker, /js\/pages\/manualChatGPTResearch\.js/);
  assert.match(serviceWorker, /js\/pages\/candidateEditor\.js/);
  assert.match(serviceWorker, /winecellar-shell-v11/);
});
