import test from "node:test";
import assert from "node:assert/strict";

import { formatCurrencyTotals } from "../js/pages/statsFormatting.js";

test("formats each currency separately", () => {
  assert.equal(formatCurrencyTotals({ EUR: 125, GBP: 90.5 }), "125.00 EUR · 90.50 GBP");
});

test("labels unknown currency and supports old scalar responses", () => {
  assert.equal(
    formatCurrencyTotals({}, { fallbackValue: 30, unknownLabel: "currency unknown" }),
    "30.00 currency unknown",
  );
});

test("uses the caller's empty label", () => {
  assert.equal(formatCurrencyTotals({}, { emptyLabel: "None" }), "None");
});
