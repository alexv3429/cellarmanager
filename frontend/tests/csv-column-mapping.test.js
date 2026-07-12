import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMappingPayload,
  mappingProfileKey,
  validateMappingSelection,
} from "../js/pages/importPage.js";

const requiredSelections = {
  producer: { primary: "column_7" },
  cuvee: { primary: "column_3" },
  appellation: { primary: "column_4" },
  vintage: { primary: "column_2" },
  color: { primary: "column_6" },
  area: { primary: "column_5" },
  format: { primary: "column_12" },
};

test("buildMappingPayload preserves ordered fallback columns", () => {
  const payload = buildMappingPayload({
    ...requiredSelections,
    drink_after: { primary: "column_13", fallback: "column_9" },
  });
  assert.deepEqual(payload.drink_after.columns, ["column_13", "column_9"]);
});

test("required fields must all be mapped", () => {
  const payload = buildMappingPayload({ producer: { primary: "column_1" } });
  const validation = validateMappingSelection(payload);
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("vintage"));
  assert.ok(validation.missing.includes("format"));
});

test("one CSV source cannot silently feed two target fields", () => {
  const payload = buildMappingPayload({
    ...requiredSelections,
    area: { primary: "column_7" },
  });
  const validation = validateMappingSelection(payload);
  assert.equal(validation.ok, false);
  assert.equal(validation.duplicates.length, 1);
});

test("profile key is stable for the same header layout", () => {
  const headers = [
    { position: 1, label: "Place" },
    { position: 2, label: "Année Prod" },
  ];
  assert.equal(mappingProfileKey(headers), "1:place|2:année prod");
});
