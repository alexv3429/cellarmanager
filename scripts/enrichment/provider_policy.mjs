const UNKNOWN_RIGHT = "unknown";

export const REQUIRED_RIGHTS = Object.freeze([
  "productionUse",
  "display",
  "cache",
  "retention",
  "offline",
  "attribution",
  "rawPayload",
  "crossHouseholdReuse",
]);

export const PROVIDER_POLICIES = Object.freeze({
  grapeminds: Object.freeze({
    id: "grapeminds",
    name: "Grapeminds Public API",
    trialAdapter: true,
    capabilities: Object.freeze([
      "identity",
      "product-drinking-window",
      "food-pairing",
    ]),
    environmentKey: "GRAPEMINDS_API_KEY",
    documentationUrl: "https://grapeminds.eu/api-specs/openapi.yaml",
    termsUrl: "https://www.grapeminds.eu/terms-publicapi",
    decision: "product-fallback-candidate",
    concerns: Object.freeze([
      "Public terms prohibit storage without prior written consent.",
      "Drinking periods and localized enrichment may be AI-generated.",
      "The 20-wine trial returned all drinking periods only after asynchronous generation, no pairing objects, and no claim-level provenance fields.",
      "Drinking-period numeric units and anchors are not defined by the published OpenAPI schema.",
      "The published wine and drinking-period schemas contain no vintage field, so trial windows are product-level rather than release-specific.",
      "Persistent dataset licence terms are available only after account acceptance.",
    ]),
    rights: Object.freeze({
      productionUse: "contract-required",
      display: UNKNOWN_RIGHT,
      cache: "contract-required",
      retention: "contract-required",
      offline: UNKNOWN_RIGHT,
      attribution: UNKNOWN_RIGHT,
      rawPayload: "contract-required",
      crossHouseholdReuse: "contract-required",
    }),
    writtenEvidence: Object.freeze([]),
  }),
  wineapi: Object.freeze({
    id: "wineapi",
    name: "WineAPI.io",
    trialAdapter: true,
    capabilities: Object.freeze(["identity", "food-pairing"]),
    environmentKey: "WINEAPI_API_KEY",
    documentationUrl: "https://api.wineapi.io/spec",
    termsUrl: "https://wineapi.io/terms",
    decision: "trial-candidate",
    concerns: Object.freeze([
      "No drinking-window endpoint is published.",
      "Public terms do not explicitly define caching, offline display, retention, or attribution.",
      "Pairing provenance and editorial methodology are not exposed in the response schema.",
      "The 20-wine trial returned pairings for 9 rows and failed all six expected-LWIN exact checks.",
      "Six difficult search spot checks did not contain the known wine in the top five results.",
      "Production matching must hard-reject colour and vintage contradictions before pairing claims are considered.",
    ]),
    rights: Object.freeze({
      productionUse: "paid-plan",
      display: UNKNOWN_RIGHT,
      cache: UNKNOWN_RIGHT,
      retention: UNKNOWN_RIGHT,
      offline: UNKNOWN_RIGHT,
      attribution: UNKNOWN_RIGHT,
      rawPayload: UNKNOWN_RIGHT,
      crossHouseholdReuse: UNKNOWN_RIGHT,
    }),
    writtenEvidence: Object.freeze([]),
  }),
  jancis: Object.freeze({
    id: "jancis",
    name: "Jancis Robinson API via Liv-ex",
    trialAdapter: false,
    capabilities: Object.freeze(["identity", "drinking-window"]),
    environmentKey: null,
    documentationUrl: "https://www.jancisrobinson.com/jancis-api",
    termsUrl: "https://www.jancisrobinson.com/jancis-api",
    decision: "access-blocked",
    concerns: Object.freeze([
      "API access requires a company and Liv-ex membership; private individuals are ineligible.",
      "Pricing and downstream display/storage rights require a negotiated agreement.",
    ]),
    rights: Object.freeze(
      Object.fromEntries(REQUIRED_RIGHTS.map((right) => [right, "contract-required"])),
    ),
    writtenEvidence: Object.freeze([]),
  }),
  etoh: Object.freeze({
    id: "etoh",
    name: "EtOH API",
    trialAdapter: false,
    capabilities: Object.freeze(["food-pairing", "appellation"]),
    environmentKey: null,
    documentationUrl: "https://etoh.digital/en/api-etoh-cloud/",
    termsUrl: "https://etoh.digital/en/api-etoh-cloud/",
    decision: "contact-required",
    concerns: Object.freeze([
      "A paid subscription and provider-issued access are required before a coverage trial.",
      "Published material does not define caching, offline use, retention, or cross-household reuse.",
    ]),
    rights: Object.freeze(
      Object.fromEntries(REQUIRED_RIGHTS.map((right) => [right, "contract-required"])),
    ),
    writtenEvidence: Object.freeze([]),
  }),
});

export function unresolvedRights(policy) {
  return REQUIRED_RIGHTS.filter((right) => {
    const value = policy.rights[right];
    return value === undefined || value === UNKNOWN_RIGHT || value === "contract-required";
  });
}

export function productionEligibility(policy) {
  const unresolved = unresolvedRights(policy);
  const hasWrittenEvidence = policy.writtenEvidence.some(
    (evidence) =>
      ["contract", "provider-email", "provider-terms"].includes(evidence.type) &&
      typeof evidence.url === "string" &&
      evidence.url.startsWith("https://") &&
      /^\d{4}-\d{2}-\d{2}$/.test(evidence.capturedAt),
  );

  return {
    eligible:
      policy.decision === "selected" &&
      unresolved.length === 0 &&
      hasWrittenEvidence,
    unresolved,
    hasWrittenEvidence,
  };
}

export function selectedProductionProviders(
  policies = Object.values(PROVIDER_POLICIES),
) {
  return policies.filter((policy) => productionEligibility(policy).eligible);
}
