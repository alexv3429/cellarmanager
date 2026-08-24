import assert from "node:assert/strict";
import test from "node:test";

import knowledge from "./maturity_knowledge_v2.json" with { type: "json" };
import {
  buildMaturityV2Preview,
  inferMaturityV2,
  renderMaturityV2Preview,
} from "./maturity_v2_preview.mjs";

test("previews an exact place and inherited vintage without area fallback", () => {
  const result = inferMaturityV2(knowledge, {
    appellation: "Saint-Véran",
    area: "Bourgogne",
    color: "white",
    cuvee: "Test",
    producer: "Producer",
    quantity: 2,
    vintage: 2020,
  });

  assert.equal(result.status, "projected");
  assert.equal(result.place.id, "saint-veran");
  assert.deepEqual(result.years, {
    bestEnd: 2027,
    bestStart: 2023,
    firstTrial: 2021,
    outer: 2032,
  });

  assert.deepEqual(
    inferMaturityV2(knowledge, {
      appellation: "Imaginary 1C",
      area: "Bourgogne",
      color: "white",
      vintage: 2020,
    }),
    {
      reason: "unsupported-place-profile",
      status: "needs-review",
      wine: {
        appellation: "Imaginary 1C",
        area: "Bourgogne",
        color: "white",
        vintage: 2020,
      },
    },
  );
});

test("renders escaped private examples and unresolved reasons", () => {
  const report = buildMaturityV2Preview(knowledge, [
    {
      appellation: "Morgon",
      area: "Beaujolais",
      color: "red",
      cuvee: "Côte & <script>",
      producer: "Safe producer",
      quantity: 3,
      vintage: 2019,
    },
    {
      appellation: "Terrasses du Larzac",
      area: "Languedoc",
      color: "rose",
      cuvee: "Rosé",
      producer: "Producer",
      quantity: 1,
      vintage: 2024,
    },
  ]);
  const html = renderMaturityV2Preview(report);

  assert.equal(report.summary.projected, 1);
  assert.equal(report.summary.unresolved, 1);
  assert.match(html, /Côte &amp; &lt;script&gt;/);
  assert.match(html, /Check appellation or colour/);
  assert.match(html, /JSON\.stringify\(review,null,2\)\+"\\n"/);
  assert.match(html, /sample-1\.notes/);
  assert.match(html, /const samples=/);
  assert.doesNotMatch(html, /Côte & <script>/);
});
