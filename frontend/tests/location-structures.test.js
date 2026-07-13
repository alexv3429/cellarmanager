import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildLocationGrid,
  buildLocationRule,
  defaultLocationScheme,
  generateLocations,
  layoutWithScheme,
  normalizeLocationScheme,
} from "../js/locationScheme.js";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("loose storage supports STC and named boxes", () => {
  const scheme = normalizeLocationScheme({
    ...defaultLocationScheme("loose"),
    containers: "Box 1\nBox 2",
  });
  assert.deepEqual(generateLocations(scheme).map((item) => item.import), ["STC", "STC Box 1", "STC Box 2"]);
  assert.match(buildLocationRule(scheme), /STC/);
});

test("simple grid keeps A1 row-column layout", () => {
  const scheme = { ...defaultLocationScheme("grid"), prefix: "M" };
  const matrix = buildLocationGrid(scheme);
  assert.deepEqual(matrix[0].map((item) => item.import), ["MA1", "MB1", "MC1", "MD1"]);
  assert.equal(matrix[2][3].internal, "D3");
});

test("sub-position grid groups A1.1 and A1.2 inside A1", () => {
  const scheme = defaultLocationScheme("grid_sub");
  const matrix = buildLocationGrid(scheme);
  assert.equal(matrix[0][0].group, true);
  assert.deepEqual(matrix[0][0].children.map((item) => item.import), ["A1.1", "A1.2"]);
});

test("sequential 7 by 4 grid can contain exactly A through Z", () => {
  const scheme = defaultLocationScheme("sequential");
  const locations = generateLocations(scheme);
  assert.equal(locations.length, 26);
  assert.equal(locations[0].import, "A");
  assert.equal(locations.at(-1).import, "Z");
  const matrix = buildLocationGrid(scheme);
  assert.equal(matrix.length, 7);
  assert.equal(matrix[6][0].import, "Y");
  assert.equal(matrix[6][1].import, "Z");
  assert.equal(matrix[6][2], null);
});

test("depth rows generate G1F and G1B", () => {
  const locations = generateLocations(defaultLocationScheme("depth"));
  assert.deepEqual(locations.slice(0, 2).map((item) => item.import), ["G1F", "G1B"]);
  assert.deepEqual(locations.slice(0, 2).map((item) => item.internal), ["1F", "1B"]);
});

test("layout stores an explicit generated location catalog", () => {
  const layout = JSON.parse(layoutWithScheme(null, defaultLocationScheme("depth")));
  assert.equal(layout.location_catalog.version, 1);
  assert.equal(layout.location_catalog.positions.length, 18);
});

test("cellar UI offers all five user-friendly structure presets", async () => {
  const source = await read("frontend/js/pages/cellars.js");
  for (const key of ["naming_mode_loose", "naming_mode_grid", "naming_mode_grid_sub", "naming_mode_sequential", "naming_mode_depth"]) {
    assert.match(source, new RegExp(key));
  }
  assert.match(source, /location-subpositions/);
  assert.match(source, /depth_positions/);
});

test("service worker uses a versioned cache name", async () => {
  const source = await read("frontend/service-worker.js");
  assert.match(source, /winecellar-shell-v\d+/);
});
