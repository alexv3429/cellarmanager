import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  PROVIDER_POLICIES,
  REQUIRED_RIGHTS,
  productionEligibility,
  selectedProductionProviders,
} from "./provider_policy.mjs";
import {
  assessIdentityEvidence,
  parseOptions,
  retryWineApiWine,
  runTrial,
  trialGrapemindsWine,
  trialWineApiWine,
  validateSample,
} from "./provider_trial.mjs";

const SAMPLE_WINE = Object.freeze({
  sampleId: "sample-1",
  producer: "Example Domaine",
  cuvee: "Example Parcel",
  vintage: 2020,
  appellation: "Example Premier Cru",
  color: "red",
  lwin7: "1234567",
});

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

test("parses bounded options and protects repository-local reports", () => {
  const options = parseOptions(
    [
      "--sample",
      "/private/tmp/sample.json",
      "--provider",
      "grapeminds",
      "--max-wines",
      "10",
      "--timeout-ms",
      "5000",
    ],
    new Date("2026-08-21T12:00:00Z"),
  );
  assert.deepEqual(options.providers, ["grapeminds"]);
  assert.equal(options.maxWines, 10);
  assert.equal(options.timeoutMs, 5_000);
  assert.match(options.output, /\.provider-trials/);

  assert.throws(() => parseOptions([]), /--sample is required/);
  assert.throws(
    () =>
      parseOptions([
        "--sample",
        "/private/tmp/sample.json",
        "--provider",
        "jancis",
      ]),
    /Unsupported trial provider/,
  );
  assert.throws(
    () =>
      parseOptions([
        "--sample",
        "/private/tmp/sample.json",
        "--output",
        resolve("provider-report.json"),
      ]),
    /must be written under \.provider-trials/,
  );
});

test("validates a private sample without accepting ambiguous rows", () => {
  const result = validateSample({ version: 1, wines: [SAMPLE_WINE] });
  assert.deepEqual(result.wines, [SAMPLE_WINE]);

  const textVintage = validateSample({
    version: 1,
    wines: [{ ...SAMPLE_WINE, vintage: "2020" }],
  });
  assert.equal(textVintage.wines[0].vintage, 2020);

  for (const nonVintage of ["NV", "N.V.", "NM"]) {
    const result = validateSample({
      version: 1,
      wines: [{ ...SAMPLE_WINE, vintage: nonVintage }],
    });
    assert.equal(result.wines[0].vintage, null);
  }

  assert.throws(
    () =>
      validateSample({
        version: 1,
        wines: [SAMPLE_WINE, SAMPLE_WINE],
      }),
    /Duplicate sampleId/,
  );
  assert.throws(
    () =>
      validateSample({
        version: 1,
        wines: [{ ...SAMPLE_WINE, lwin7: "123" }],
      }),
    /seven digits/,
  );
  assert.throws(
    () =>
      validateSample({
        version: 1,
        wines: [{ ...SAMPLE_WINE, vintage: "unknown" }],
      }),
    /must be a year or null/,
  );
});

test("blocks colour and vintage conflicts and limits missing vintages to product scope", () => {
  const conflicts = assessIdentityEvidence(SAMPLE_WINE, {
    colour: "white",
    vintage: 2019,
  });
  assert.equal(conflicts.eligibleScope, "rejected");
  assert.deepEqual(conflicts.hardBlockers, [
    "colour-conflict",
    "vintage-conflict",
  ]);

  const productOnly = assessIdentityEvidence(SAMPLE_WINE, {
    colour: "rouge",
    vintage: null,
  });
  assert.equal(productOnly.colourStatus, "exact");
  assert.equal(productOnly.vintageStatus, "provider-omitted");
  assert.equal(productOnly.eligibleScope, "product-only");
  assert.equal(productOnly.exactReleaseEvidence, false);

  const release = assessIdentityEvidence(SAMPLE_WINE, {
    colour: "red",
    vintage: "2020",
  });
  assert.equal(release.eligibleScope, "release-candidate");
  assert.equal(release.exactReleaseEvidence, true);
});

test("no researched provider can be selected before every right is explicit", () => {
  assert.deepEqual(selectedProductionProviders(), []);
  for (const policy of Object.values(PROVIDER_POLICIES)) {
    assert.equal(productionEligibility(policy).eligible, false);
  }

  const explicitPolicy = {
    ...PROVIDER_POLICIES.wineapi,
    decision: "selected",
    rights: Object.fromEntries(
      REQUIRED_RIGHTS.map((right) => [
        right,
        right === "offline" ? "online-only" : "granted",
      ]),
    ),
    writtenEvidence: [
      {
        type: "provider-email",
        url: "https://evidence.example/provider-email",
        capturedAt: "2026-08-21",
      },
    ],
  };
  assert.deepEqual(productionEligibility(explicitPolicy), {
    eligible: true,
    unresolved: [],
    hasWrittenEvidence: true,
  });
});

test("Grapeminds trial prefers the expected LWIN and keeps advice reviewable", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    const path = new URL(url).pathname;
    if (path.endsWith("/wines/search")) {
      return jsonResponse({
        data: [
          { id: 11, display_name: "Wrong", lwin: "7654321" },
          {
            id: 42,
            display_name: "Example Domaine, Example Parcel",
            producer_display_name: "Example Domaine",
            color: "red",
            lwin: "1234567",
          },
        ],
      });
    }
    if (path.endsWith("/wines/42")) {
      return jsonResponse({
        data: {
          lwin: "1234567",
          pairing: {
            text: "Roast poultry",
            text_long: "Pairs with roast poultry and mushrooms.",
            language: "en",
          },
        },
      });
    }
    if (path.endsWith("/drinking-periods/42")) {
      return jsonResponse({
        from: 2027,
        to: 2040,
        statement: "Best after some bottle age.",
        source: "provider-method",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await trialGrapemindsWine(SAMPLE_WINE, {
    apiKey: "grapeminds-test-secret",
    timeoutMs: 5_000,
    fetchImpl,
  });

  assert.equal(result.candidate.providerId, "42");
  assert.equal(result.candidate.selectionMethod, "exact-lwin7");
  assert.equal(result.candidate.exactLwin7, true);
  assert.equal(result.identityEvidence.colourStatus, "exact");
  assert.equal(result.identityEvidence.vintageStatus, "provider-omitted");
  assert.equal(result.identityEvidence.eligibleScope, "product-only");
  assert.equal(result.drinkingWindow.present, true);
  assert.equal(result.pairing.present, true);
  assert.equal(result.pairing.structured, false);
  assert.equal(result.provenance.sourcePresent, true);
  assert.equal(requests.length, 3);
  assert.equal(
    requests[0].options.headers.authorization,
    "Bearer grapeminds-test-secret",
  );
  assert.ok(requests.every((request) => !request.url.includes("test-secret")));
});

test("Grapeminds trial records asynchronous drinking-window generation", async () => {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/wines/search")) {
      return jsonResponse({
        data: [{ id: 42, display_name: "Example", lwin: "1234567" }],
      });
    }
    if (path.endsWith("/wines/42")) {
      return jsonResponse({ data: { lwin: "1234567", pairing: null } });
    }
    if (path.endsWith("/drinking-periods/42")) {
      return jsonResponse({ generating: true }, { status: 404 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await trialGrapemindsWine(SAMPLE_WINE, {
    apiKey: "grapeminds-test-secret",
    timeoutMs: 5_000,
    fetchImpl,
  });

  assert.equal(result.drinkingWindow.present, false);
  assert.equal(result.drinkingWindow.generating, true);
  assert.equal(result.updateStatus, "pending");
});

test("WineAPI trial records structured pairings and pending enrichment", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(String(url));
    assert.equal(options.headers["x-api-key"], "wineapi-test-secret");
    const path = new URL(url).pathname;
    if (path.endsWith("/wines/search")) {
      return jsonResponse({
        results: [
          {
            id: "00000000-0000-4000-8000-000000000042",
            name: "Example Parcel 2020",
            winery: "Example Domaine",
            confidence: 0.91,
          },
        ],
      });
    }
    if (path.endsWith("/pairings")) {
      return jsonResponse({
        pairings: [
          { food: "Mushrooms", confidence: "high", notes: "Earthy match" },
        ],
      });
    }
    return jsonResponse(
      {
        name: "Example Parcel 2020",
        vintage: 2020,
        type: "red",
        lwinCode: "12345672020",
        winery: { name: "Example Domaine" },
      },
      { headers: { "x-update-status": "pending", "retry-after": "30" } },
    );
  };

  const result = await trialWineApiWine(SAMPLE_WINE, {
    apiKey: "wineapi-test-secret",
    timeoutMs: 5_000,
    fetchImpl,
  });

  assert.equal(result.candidate.exactLwin7, true);
  assert.equal(result.identityEvidence.eligibleScope, "release-candidate");
  assert.equal(result.drinkingWindow.supported, false);
  assert.equal(result.pairing.present, true);
  assert.equal(result.pairing.structured, true);
  assert.equal(result.pairing.items[0].food, "Mushrooms");
  assert.equal(result.updateStatus, "pending");
  assert.equal(result.retryAfter, "30");

  requests.length = 0;
  const retried = await retryWineApiWine(SAMPLE_WINE, result, {
    apiKey: "wineapi-test-secret",
    timeoutMs: 5_000,
    fetchImpl,
  });
  assert.equal(retried.candidate.selectionMethod, "provider-id-retry");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => !url.endsWith("/wines/search")));
});

test("WineAPI trial does not report a conflict when the provider omits LWIN", async () => {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/wines/search")) {
      return jsonResponse({
        results: [{ id: "00000000-0000-4000-8000-000000000042" }],
      });
    }
    if (path.endsWith("/pairings")) return jsonResponse({ pairings: [] });
    return jsonResponse({ name: "Example Parcel 2020", lwinCode: null });
  };

  const result = await trialWineApiWine(SAMPLE_WINE, {
    apiKey: "wineapi-test-secret",
    timeoutMs: 5_000,
    fetchImpl,
  });

  assert.equal(result.candidate.lwin7, null);
  assert.equal(result.candidate.exactLwin7, null);
});

test("trial reports are private, aggregate coverage, and never contain API keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cellarmanager-provider-trial-"));
  const samplePath = join(directory, "private-sample.json");
  const outputPath = join(directory, "private-report.json");
  try {
    await writeFile(
      samplePath,
      JSON.stringify({ version: 1, wines: [SAMPLE_WINE] }),
      "utf8",
    );
    const fetchImpl = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/wines/search")) {
        return jsonResponse({
          data: [
            {
              id: 42,
              display_name: "Example Domaine, Example Parcel",
              lwin: "1234567",
            },
          ],
        });
      }
      if (path.endsWith("/wines/42")) {
        return jsonResponse({ data: { pairing: { text: "Mushrooms" } } });
      }
      return jsonResponse({ from: 2027, to: 2040 });
    };

    const report = await runTrial(
      {
        sample: samplePath,
        providers: ["grapeminds"],
        output: outputPath,
        maxWines: 20,
        timeoutMs: 5_000,
      },
      { GRAPEMINDS_API_KEY: "never-write-this-key" },
      fetchImpl,
    );
    assert.deepEqual(report.providers[0].summary, {
      total: 1,
      candidates: 1,
      notFound: 0,
      errors: 0,
      exactLwin7: 1,
      conflictingLwin7: 0,
      colourConflicts: 0,
      vintageConflicts: 0,
      productOnly: 1,
      releaseCandidates: 0,
      drinkingWindows: 1,
      pairings: 1,
      pendingUpdates: 0,
    });

    const reportText = await readFile(outputPath, "utf8");
    assert.doesNotMatch(reportText, /never-write-this-key/);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
