import assert from "node:assert/strict";
import test from "node:test";

import {
  groupHoldingsByWine,
  holdingsForLocation,
  locationKeys,
  normalizedLocationKey,
} from "../js/pages/cellarLocationBottles.js";

test("normalizes regular and unspecified locations", () => {
  assert.equal(normalizedLocationKey(" a-1 "), "A-1");
  assert.equal(normalizedLocationKey(null), "__UNSPECIFIED__");
  assert.equal(normalizedLocationKey(""), "__UNSPECIFIED__");
});

test("matches both internal and import location aliases", () => {
  const holdings = [
    { id: "h1", wine_id: "w1", location: "M-A1", quantity: 2 },
    { id: "h2", wine_id: "w2", location: "A1", quantity: 1 },
    { id: "h3", wine_id: "w3", location: "A2", quantity: 4 },
  ];
  const item = { internal: "M-A1", import: "A1" };

  assert.deepEqual([...locationKeys(item)].sort(), ["A1", "M-A1"]);
  assert.deepEqual(
    holdingsForLocation(holdings, item).map((holding) => holding.id),
    ["h1", "h2"],
  );
});

test("matches the unspecified location separately", () => {
  const holdings = [
    { id: "h1", wine_id: "w1", location: null, quantity: 2 },
    { id: "h2", wine_id: "w2", location: "", quantity: 1 },
    { id: "h3", wine_id: "w3", location: "A1", quantity: 4 },
  ];

  assert.deepEqual(
    holdingsForLocation(holdings, { unspecified: true }).map(
      (holding) => holding.id,
    ),
    ["h1", "h2"],
  );
});

test("groups multiple holdings of the same wine and sums quantities", () => {
  const result = groupHoldingsByWine([
    { id: "h1", wine_id: "w1", quantity: 2 },
    { id: "h2", wine_id: "w1", quantity: 3 },
    { id: "h3", wine_id: "w2", quantity: 1 },
  ]);

  assert.deepEqual(
    result.map(({ wine_id, quantity }) => ({ wine_id, quantity })),
    [
      { wine_id: "w1", quantity: 5 },
      { wine_id: "w2", quantity: 1 },
    ],
  );
});

