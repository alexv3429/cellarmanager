import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("backend i18n endpoint no longer shadows static dictionaries", async () => {
  const source = await read("backend/app/api/main.py");
  assert.match(source, /@app\.get\(["']\/api\/i18n\/\{locale\}["']\)/);
  assert.doesNotMatch(source, /@app\.get\(["']\/i18n\/\{locale\}["']\)/);
});

test("service worker caches only explicit app-shell paths", async () => {
  const source = await read("frontend/service-worker.js");
  assert.match(source, /winecellar-shell-v\d+/);
  assert.match(source, /function isAppShellRequest/);
  assert.match(source, /APP_SHELL_PATHS\.has\(url\.pathname\)/);
  assert.doesNotMatch(source, /endsWith\(path\.replace\(["']\.\/["']/);
});

test("English and French dashboards contain onboarding and sync translations", async () => {
  for (const locale of ["en", "fr"]) {
    const dictionary = JSON.parse(await read(`frontend/i18n/${locale}.json`));
    assert.ok(dictionary["app.name"]);
    assert.ok(dictionary["dashboard.title"]);
    assert.ok(dictionary["dashboard.no_bottles_hint"]);
    assert.ok(dictionary["dashboard.no_cellars"]);
    assert.ok(dictionary["dashboard.add_cellar"]);
    assert.ok(dictionary["nav.sync"]);
    assert.ok(dictionary["offline.problems_title"]);
  }
});

test("footer is dynamically localizable", async () => {
  const html = await read("frontend/index.html");
  const app = await read("frontend/js/app.js");
  assert.match(html, /id=["']footer-app-name["']/);
  assert.match(app, /footerAppName\.textContent = t\(["']app\.name["']\)/);
});
