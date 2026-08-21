import assert from "node:assert/strict";
import test from "node:test";

import { renderReviewHtml } from "./provider_review.mjs";

const sample = {
  version: 1,
  wines: [
    {
      sampleId: "sample-1",
      producer: "Domaine <script>alert(1)</script>",
      cuvee: "Example",
      vintage: "2020",
      appellation: "Example Cru",
      color: "red",
      lwin7: "1234567",
    },
  ],
};

function report(id, result, summary) {
  return { providers: [{ id, results: [result], summary }] };
}

test("renders a private provider review without injecting provider HTML", () => {
  const grapeminds = report(
    "grapeminds",
    {
      sampleId: "sample-1",
      candidate: {
        name: "Example & Wine",
        producer: "Example",
        lwin7: "1234567",
        exactLwin7: true,
      },
      drinkingWindow: { from: 5, to: 12, statement: "Drink <later>" },
      identityEvidence: {
        sourceColour: "red",
        providerColour: "red",
        colourStatus: "exact",
        sourceVintage: 2020,
        providerVintage: null,
        vintageStatus: "provider-omitted",
        eligibleScope: "product-only",
        hardBlockers: [],
      },
    },
    { drinkingWindows: 1, pairings: 0 },
  );
  const wineapi = report(
    "wineapi",
    {
      sampleId: "sample-1",
      candidate: { name: "Example", producer: "Example", exactLwin7: null },
      pairing: { items: [{ food: "Duck", notes: "Avoid <script>" }] },
    },
    { pairings: 1 },
  );

  const html = renderReviewHtml(sample, grapeminds, wineapi);

  assert.match(html, /Domaine &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Example &amp; Wine/);
  assert.match(html, /Drink &lt;later&gt;/);
  assert.match(html, /Maximum scope: product-only/);
  assert.doesNotMatch(html, /Domaine <script>/);
  assert.match(html, /Export my validation/);
});
