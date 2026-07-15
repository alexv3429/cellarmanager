import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("status screen exposes version, update, sync and refresh controls", async () => {
  const source = await read("frontend/js/pages/syncProblems.js");
  assert.match(source, /openapi\.json/);
  assert.match(source, /GET_STATUS/);
  assert.match(source, /registration\.update\(\)/);
  assert.match(source, /api\.syncOutbox\(\)/);
  assert.match(source, /REFRESH_APP_SHELL/);
  assert.match(source, /last_sync_at/);
  assert.match(source, /last_refresh_at/);
});

test("service worker reports its version and can rebuild the app shell", async () => {
  const source = await read("frontend/service-worker.js");
  assert.match(source, /self\.addEventListener\(["']message["']/);
  assert.match(source, /GET_STATUS/);
  assert.match(source, /REFRESH_APP_SHELL/);
  assert.match(source, /SKIP_WAITING/);
  assert.match(source, /winecellar-shell-v\d+/);
});

test("automatic synchronization records status timestamps", async () => {
  const source = await read("frontend/js/app.js");
  assert.match(source, /last_sync_attempt_at/);
  assert.match(source, /last_sync_at/);
  assert.match(source, /sync:completed/);
});

test("status screen has English and French translations", async () => {
  for (const locale of ["en", "fr"]) {
    const dictionary = JSON.parse(await read(`frontend/i18n/${locale}.json`));
    assert.ok(dictionary["system.title"]);
    assert.ok(dictionary["system.api_version"]);
    assert.ok(dictionary["system.check_update"]);
    assert.ok(dictionary["system.sync_now"]);
    assert.ok(dictionary["system.force_refresh"]);
  }
});
