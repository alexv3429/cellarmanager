import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  inferWine,
  rankPairings,
  runInferencePoc,
  validateKnowledge,
  validatePocSample,
} from "./inference_model.mjs";
import { parseOptions, renderInferencePocHtml } from "./inference_poc.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const knowledge = validateKnowledge(
  JSON.parse(
    await readFile(resolve(scriptDirectory, "inference_poc_knowledge.json"), "utf8"),
  ),
);

function wine(overrides = {}) {
  return {
    sampleId: "sample-1",
    producer: "Boillot",
    cuvee: "Caillerets",
    vintage: 2018,
    appellation: "Volnay 1C",
    region: "Bourgogne",
    color: "Rouge",
    quantity: 1,
    ...overrides,
  };
}

test("validates the private sample boundary and knowledge provenance", () => {
  const sample = validatePocSample({
    version: 1,
    asOfYear: 2026,
    wines: [wine()],
  });
  assert.equal(sample.wines[0].vintage, 2018);
  assert.throws(
    () =>
      validatePocSample({
        version: 1,
        asOfYear: 2026,
        wines: [wine(), wine()],
      }),
    /Duplicate sampleId/,
  );
  assert.throws(
    () =>
      validateKnowledge({
        ...knowledge,
        placeProfiles: [
          { ...knowledge.placeProfiles[0], evidence: ["invented-source"] },
        ],
      }),
    /unknown evidence/,
  );
});

test("same product changes across vintages instead of repeating a product window", () => {
  const elegant2017 = inferWine(wine({ vintage: 2017 }), 2026, knowledge);
  const structured2020 = inferWine(
    wine({ sampleId: "sample-2", vintage: 2020 }),
    2026,
    knowledge,
  );
  assert.equal(elegant2017.matchedProfiles.vintage, "bourgogne-red-2017");
  assert.equal(structured2020.matchedProfiles.vintage, "bourgogne-red-2020");
  assert.ok(structured2020.maturity.firstTry[0] - elegant2017.maturity.firstTry[0] >= 5);
  assert.ok(structured2020.maturity.drinkBy[1] > elegant2017.maturity.drinkBy[1]);
});

test("Piemonte is independent from Burgundy and cru profiles remain distinct", () => {
  const barolo = inferWine(
    wine({
      producer: "Vajra",
      cuvee: "Bricco delle Viole",
      appellation: "Barolo",
      region: "Piemont",
      vintage: 2018,
    }),
    2026,
    knowledge,
  );
  const volnay = inferWine(wine(), 2026, knowledge);
  assert.equal(barolo.matchedProfiles.place, "barolo-red");
  assert.ok(barolo.maturity.likelyBest[1] >= volnay.maturity.likelyBest[1] + 8);
  assert.ok(barolo.maturity.drinkBy[1] >= volnay.maturity.drinkBy[1] + 8);

  const delGris = inferWine(
    wine({
      sampleId: "gris",
      producer: "Conterno Fantino",
      cuvee: "Vigna del Gris",
      appellation: "Barolo",
      region: "Piemont",
    }),
    2026,
    knowledge,
  );
  const sori = inferWine(
    wine({
      sampleId: "sori",
      producer: "Conterno Fantino",
      cuvee: "Vigna Sori Ginestra",
      appellation: "Barolo",
      region: "Piemont",
    }),
    2026,
    knowledge,
  );
  assert.equal(delGris.matchedProfiles.cuvee, "conterno-vigna-del-gris");
  assert.equal(sori.matchedProfiles.cuvee, "conterno-sori-ginestra");
  assert.ok(sori.maturity.drinkBy[1] > delGris.maturity.drinkBy[1]);
});

test("colour/appellation contradictions are never hidden by a score", () => {
  const result = inferWine(
    wine({
      producer: "Cazeneuve",
      cuvee: "Le Causse",
      vintage: 2020,
      appellation: "Pic Saint-Loup",
      region: "Languedoc",
      color: "Blanc",
    }),
    2026,
    knowledge,
  );
  assert.equal(result.matchedProfiles.place, "languedoc-white");
  assert.ok(result.warnings.some((warning) => /does not include white/.test(warning)));
  assert.equal(result.confidenceLabel, "low");
});

test("maturity produces actionable storage-purpose and moving hints", () => {
  const youngBarolo = inferWine(
    wine({
      producer: "Vajra",
      cuvee: "Bricco delle Viole",
      vintage: 2018,
      appellation: "Barolo",
      region: "Piemont",
    }),
    2026,
    knowledge,
  );
  const matureBarolo = inferWine(
    wine({
      sampleId: "older",
      producer: "Vajra",
      cuvee: "Bricco delle Viole",
      vintage: 2006,
      appellation: "Barolo",
      region: "Piemont",
    }),
    2026,
    knowledge,
  );
  assert.equal(youngBarolo.location.purpose, "aging");
  assert.match(youngBarolo.location.message, /move one bottle to service around/);
  assert.notEqual(matureBarolo.location.purpose, "aging");
  assert.match(matureBarolo.location.message, /service/);
});

test("pairing ranks drinkability with structure and admits when none fit", () => {
  const wines = [
    inferWine(
      wine({
        sampleId: "white",
        producer: "Dureuil-Janthial",
        cuvee: "Les Champs Gains",
        vintage: 2017,
        appellation: "Puligny-Montrachet 1C",
        color: "Blanc",
      }),
      2026,
      knowledge,
    ),
    inferWine(
      wine({
        sampleId: "pic",
        producer: "Clos Marie",
        cuvee: "Les Glorieuses",
        vintage: 2017,
        appellation: "Pic Saint-Loup",
        region: "Languedoc",
      }),
      2026,
      knowledge,
    ),
    inferWine(
      wine({
        sampleId: "young-barolo",
        producer: "Vajra",
        cuvee: "Bricco delle Viole",
        vintage: 2018,
        appellation: "Barolo",
        region: "Piemont",
      }),
      2026,
      knowledge,
    ),
  ];
  const dishes = knowledge.dishProfiles.filter((dish) =>
    ["salad-vinaigrette", "grilled-beef", "fruit-tart"].includes(dish.id),
  );
  const pairings = rankPairings(wines, dishes);
  const salad = pairings.find((pairing) => pairing.dishId === "salad-vinaigrette");
  const beef = pairings.find((pairing) => pairing.dishId === "grilled-beef");
  const tart = pairings.find((pairing) => pairing.dishId === "fruit-tart");
  assert.equal(salad.suggestions[0].sampleId, "white");
  assert.equal(beef.suggestions[0].sampleId, "pic");
  assert.equal(tart.status, "no-suitable-wine");
});

test("renders a responsive private review without injecting sample content", () => {
  const report = runInferencePoc(
    {
      version: 1,
      asOfYear: 2026,
      wines: [
        wine({
          producer: "Domaine <script>alert(1)</script>",
          cuvee: "Unknown & Wine",
        }),
      ],
    },
    knowledge,
  );
  const html = renderInferencePocHtml(report);
  assert.match(html, /Domaine &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Unknown &amp; Wine/);
  assert.doesNotMatch(html, /Domaine <script>/);
  assert.match(html, /Export my validation/);
  assert.match(html, /cellarmanager-inference-poc-validation\.json/);
  assert.match(html, /@media\(max-width:800px\)/);
});

test("requires private outputs under the ignored trial directory", () => {
  const options = parseOptions([
    "--sample",
    "/private/tmp/poc.json",
    "--output",
    resolve(".provider-trials/inference-poc.html"),
  ]);
  assert.match(options.output, /\.provider-trials\/inference-poc\.html$/);
  assert.throws(
    () =>
      parseOptions([
        "--sample",
        "/private/tmp/poc.json",
        "--output",
        resolve("inference-poc.html"),
      ]),
    /must be written under \.provider-trials/,
  );
});
