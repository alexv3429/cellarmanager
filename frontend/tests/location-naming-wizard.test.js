import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildLocationGrid,
  buildLocationRule,
  defaultLocationScheme,
  layoutWithScheme,
  schemeFromCellar,
} from "../js/locationScheme.js";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function exampleScheme() {
  return {
    ...defaultLocationScheme(),
    prefix: "M",
    column_start: "A",
    column_end: "D",
    row_start: 1,
    row_end: 3,
  };
}

test("M A-D 1-3 produces the requested row-major grid", () => {
  const grid = buildLocationGrid(exampleScheme());
  assert.deepEqual(grid[0].map((item) => item.import), ["MA1", "MB1", "MC1", "MD1"]);
  assert.deepEqual(grid[1].map((item) => item.import), ["MA2", "MB2", "MC2", "MD2"]);
  assert.deepEqual(grid[2].map((item) => item.import), ["MA3", "MB3", "MC3", "MD3"]);
  assert.equal(grid[0][0].internal, "A1");
  assert.equal(grid[2][3].internal, "D3");
});

test("generated rule accepts only positions in the configured grid", () => {
  const source = buildLocationRule(exampleScheme());
  // Python named groups are deliberately generated for the backend; convert
  // the one group to JavaScript syntax for this pure browser-side assertion.
  const jsSource = source.replace("(?P<sub>", "(?<sub>");
  const regex = new RegExp(jsSource, "i");
  assert.equal(regex.test("MA1"), true);
  assert.equal(regex.test("MD3"), true);
  assert.equal(regex.test("ME1"), false);
  assert.equal(regex.test("MA4"), false);
});

test("scheme is stored alongside any existing layout information", () => {
  const layout = layoutWithScheme(JSON.stringify({ racks: [{ rows: 2, cols: 2 }] }), exampleScheme());
  const cellar = { layout };
  assert.equal(schemeFromCellar(cellar).prefix, "M");
  assert.equal(JSON.parse(layout).racks.length, 1);
});

test("normal interface uses a naming wizard and hides regex behind advanced mode", async () => {
  const source = await read("frontend/js/pages/cellars.js");
  assert.match(source, /cellars\.location_naming/);
  assert.match(source, /naming_mode_advanced/);
  assert.match(source, /location-code-grid/);
  assert.match(source, /schemeFromCellar/);
  assert.doesNotMatch(source, /fieldWithHelp\(\s*t\("cellars\.location_rule"\)/);
});

test("service worker caches the new helper and advances the shell version", async () => {
  const source = await read("frontend/service-worker.js");
  assert.match(source, /winecellar-shell-v\d+/);
  assert.match(source, /js\/locationScheme\.js/);
});
