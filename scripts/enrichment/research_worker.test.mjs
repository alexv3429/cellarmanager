import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResearchPrompt,
  buildResearchQuery,
  fetchAllowedPage,
  htmlResearchTitle,
  htmlToResearchText,
  isPublicResearchUrl,
  isRobotsAllowed,
  processResearchCase,
  runResearchCycle,
  selectAllowedSearchResults,
  selectResearchSourceDiscoveries,
  sourceEntryCandidate,
  validateResearchProposal,
} from "../../workers/researchWorker.mjs";

test("the scheduled cycle publishes approved profile revisions without AI", async () => {
  const calls = [];
  const result = await runResearchCycle({
    SUPABASE_SECRET_KEY: "service-key",
    SUPABASE_URL: "https://example.supabase.co",
  }, {
    rpc: async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return functionName === "publish_approved_enrichment_profile_revisions"
        ? {
          status: "processed",
          count: 1,
          results: [{ revision_id: "revision-1", status: "published" }],
        }
        : [];
    },
  });

  assert.deepEqual(calls, [
    {
      functionName: "publish_approved_enrichment_profile_revisions",
      parameters: { p_limit: 2 },
    },
    {
      functionName: "publish_reviewed_enrichment_research_drafts",
      parameters: { p_limit: 2 },
    },
  ]);
  assert.equal(result.status, "research-not-configured");
  assert.equal(result.profileRevisions.results[0].revision_id, "revision-1");
});

const rule = {
  rule_id: "rule-1",
  source_id: "source-1",
  source_policy_id: "policy-1",
  source_name: "Official producer",
  hostname: "producer.example",
  path_prefix: "/wines",
  query_template: "site:producer.example {subject} style",
  max_pages: 2,
};

const researchCase = {
  case_id: "case-1",
  lease_token: "lease-1",
  subject_type: "producer-profile",
  field_name: null,
  vintage_year: 2020,
  wine_color: "red",
  subject: {
    title: "Producer profile: Test",
    search_subject: "Test producer Morgon",
  },
  allowed_sources: [rule],
};

test("research queries remain bounded to the reviewed source template", () => {
  assert.equal(
    buildResearchQuery(rule, researchCase),
    "site:producer.example Test producer Morgon style",
  );
});

test("producer research stays producer-wide and conservative", () => {
  const prompt = buildResearchPrompt(researchCase, [{
    url: "https://producer.example/wines",
    text: "One named cuvee is powerful; another is light.",
  }]);
  assert.match(prompt, /one named cuvee cannot become a producer-wide adjustment/);
  assert.match(prompt, /keep age adjustments between -2 and 3/);
  assert.match(prompt, /use 0 for unsupported axes/i);
  assert.match(prompt, /at most two concise sentences/);
  assert.match(prompt, /Prefer claims supported by more than one independent source/);
});

test("every reviewed rule has one deterministic HTTPS entry page", () => {
  assert.equal(
    sourceEntryCandidate(rule).url,
    "https://producer.example/wines",
  );
});

test("search selection rejects protocols, hosts, and paths outside the allowlist", () => {
  const selected = selectAllowedSearchResults({
    web: {
      results: [
        { url: "http://producer.example/wines/a", title: "HTTP" },
        { url: "https://evil.example/wines/a", title: "Wrong host" },
        { url: "https://producer.example/about", title: "Wrong path" },
        { url: "https://producer.example/wines-extra", title: "Prefix collision" },
        { url: "https://producer.example/wines/a", title: "Allowed A" },
        { url: "https://producer.example/wines/a", title: "Duplicate" },
        { url: "https://producer.example/wines/b", title: "Allowed B" },
        { url: "https://producer.example/wines/c", title: "Over limit" },
      ],
    },
  }, rule);
  assert.deepEqual(selected.map((item) => item.url), [
    "https://producer.example/wines/a",
    "https://producer.example/wines/b",
  ]);
});

test("source redirects cannot escape the approved host or path", async () => {
  const candidate = {
    ruleId: rule.rule_id,
    sourceId: rule.source_id,
    sourcePolicyId: rule.source_policy_id,
    sourceName: rule.source_name,
    title: "Allowed wine",
    url: "https://producer.example/wines/a",
  };
  const fetchImpl = async (url) => {
    if (url === "https://producer.example/robots.txt") {
      return new Response("User-agent: *\nAllow: /", {
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/collector" },
    });
  };

  await assert.rejects(
    fetchAllowedPage(candidate, rule, fetchImpl),
    /left its approved boundary/,
  );
});

test("robots rules honor the most specific allow or disallow path", () => {
  const robots = `User-agent: *\nDisallow: /wines/private\nAllow: /wines/private/press\n`;
  assert.equal(isRobotsAllowed(robots, "/wines/public"), true);
  assert.equal(isRobotsAllowed(robots, "/wines/private/list"), false);
  assert.equal(isRobotsAllowed(robots, "/wines/private/press/file"), true);
});

test("HTML extraction drops executable and decorative content", () => {
  const text = htmlToResearchText(`
    <style>.secret{display:none}</style><script>ignore()</script>
    <h1>Power &amp; finesse</h1>
    <div style="position:absolute; left:-99999px">Injected casino links</div>
    <p>Noble tannins&nbsp;and freshness.</p>
  `);
  assert.equal(text, "Power & finesse Noble tannins and freshness.");
  assert.equal(
    htmlResearchTitle("<title>Domaine &amp; wines</title><p>Body</p>"),
    "Domaine & wines",
  );
});

test("discovery keeps reviewed, plausible official, and relevant unclassified sources", () => {
  const langoureauCase = {
    ...researchCase,
    subject: {
      ...researchCase.subject,
      producer: "Sylvain Langoureau",
    },
  };
  const selected = selectResearchSourceDiscoveries([
    {
      title: "Domaine Langoureau Sylvain",
      url: "https://www.ds-collection.com/en_US/domain/28/domaine-langoureau-sylvain",
      content: "Technical producer profile for Sylvain Langoureau.",
    },
    {
      title: "Domaine Sylvain Langoureau",
      url: "https://www.hachette-vins.com/guide-vins/producteurs/9682/dom-sylvain-langoureau/",
      content: "Editorial guide profile for Sylvain Langoureau.",
    },
    {
      title: "Sylvain Langoureau official estate",
      url: "https://langoureau.example/estate",
      content: "Sylvain Langoureau wine estate.",
    },
    {
      title: "Domaine Sylvain Langoureau",
      url: "https://www.finevines.com/portfolio/producer/domaine-sylvain-langoureau",
      content: "Producer profile for Sylvain Langoureau and his Burgundy wines.",
    },
    {
      title: "Cheap bottle shop",
      url: "https://shop.example/langoureau",
      content: "Buy Sylvain Langoureau now.",
    },
  ], langoureauCase);

  assert.deepEqual(selected, [
    {
      kind: "technical",
      url: "https://www.ds-collection.com/en_US/domain/28/domaine-langoureau-sylvain",
    },
    {
      kind: "editorial",
      url: "https://www.hachette-vins.com/guide-vins/producteurs/9682/dom-sylvain-langoureau/",
    },
    {
      kind: "official",
      url: "https://langoureau.example/estate",
    },
    {
      kind: "other",
      url: "https://www.finevines.com/portfolio/producer/domaine-sylvain-langoureau",
    },
  ]);
  assert.equal(isPublicResearchUrl("https://producer.example/profile"), true);
  assert.equal(isPublicResearchUrl("http://producer.example/profile"), false);
  assert.equal(isPublicResearchUrl("https://localhost/profile"), false);
  assert.equal(isPublicResearchUrl("https://127.0.0.1/profile"), false);
  assert.equal(isPublicResearchUrl("https://user@producer.example/profile"), false);
});

test("producer drafts require conservative bounded structured adjustments", () => {
  const proposal = validateResearchProposal(researchCase, {
    profile_type: "producer-era",
    first_vintage_year: 1989,
    final_vintage_year: 2200,
    rationale: "Structured Morgon with ripe tannins and explicit ageing potential.",
    confidence: 0.7,
    age_adjustments: {
      first_trial: 1,
      best_start: 1,
      best_end: 2,
      outer_horizon: 3,
    },
    trait_adjustments: {
      body: 0.4,
      acidity: 0,
      tannin: 0.6,
      sweetness: 0,
      alcohol: 0,
      freshness: 0.1,
      savory: 0.2,
      concentration: 0.6,
    },
  });
  assert.equal(proposal.profile_type, "producer-era");
  assert.throws(
    () => validateResearchProposal(researchCase, { ...proposal, confidence: 0.71 }),
    /confidence must be between 0 and 0.7/,
  );
  assert.throws(
    () => validateResearchProposal(researchCase, {
      ...proposal,
      trait_adjustments: { ...proposal.trait_adjustments, tannin: 4 },
    }),
    /trait adjustment tannin must be between -2 and 2/,
  );
});

test("a case without an approved source pauses for source review", async () => {
  const completions = [];
  await processResearchCase({}, { ...researchCase, allowed_sources: [] }, {
    complete: async (...args) => {
      completions.push(args);
      return { status: args[0] };
    },
  });
  assert.deepEqual(completions, [[
    "needs-source-review",
    { error_code: "no-reviewed-source-rule" },
  ]]);
});

test("an approved entry page can produce a draft without a search provider", async () => {
  const completions = [];
  await processResearchCase({
    AI: {
      run: async () => ({
        response: `${JSON.stringify({
          profile_type: "producer-era",
          first_vintage_year: "2000",
          final_vintage_year: "present",
          rationale: "Official producer material describes a structured and cellar-worthy red wine.",
          confidence: "0.8",
          age_adjustments: {
            first_trial: 1,
            best_start: 1,
            best_end: 2,
            outer_horizon: "10",
          },
          trait_adjustments: {
            body: 0.4,
            acidity: 0,
            tannin: 0.5,
            sweetness: 0,
            alcohol: 0,
            freshness: 0.1,
            savory: 0.2,
            concentration: 0.5,
          },
        })}\nDraft prepared from the reviewed source.`,
      }),
    },
  }, researchCase, {
    complete: async (...args) => {
      completions.push(args);
      return { status: args[0] };
    },
    fetch: async (url) => {
      if (url === "https://producer.example/robots.txt") {
        return new Response("User-agent: *\nAllow: /wines", {
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(
        "Official estate history and detailed wine style. This structured red wine has noble tannins and ageing potential.",
        { headers: { "content-type": "text/html" } },
      );
    },
  });

  assert.equal(completions[0][0], "draft");
  assert.equal(completions[0][1].proposal.first_vintage_year, 2000);
  assert.equal(completions[0][1].proposal.final_vintage_year, 2200);
  assert.equal(completions[0][1].proposal.confidence, 0.7);
  assert.equal(completions[0][1].proposal.age_adjustments.outer_horizon, 3);
  assert.equal(
    completions[0][1].sources[0].url,
    "https://producer.example/wines",
  );
});

test("manual or discovered pages are verified and combined before owner review", async () => {
  const completions = [];
  const accepted = [];
  let prompt = "";
  const langoureauCase = {
    ...researchCase,
    allowed_sources: [],
    subject: {
      title: "Producer profile: Langoureau · white",
      search_subject: "Sylvain Langoureau white Burgundy",
      producer: "Sylvain Langoureau",
    },
    suggested_sources: [
      {
        suggestion_id: "suggestion-1",
        kind: "technical",
        origin: "automatic",
        url: "https://www.ds-collection.com/en_US/domain/28/domaine-langoureau-sylvain",
      },
      {
        suggestion_id: "suggestion-2",
        kind: "editorial",
        origin: "automatic",
        url: "https://www.hachette-vins.com/guide-vins/producteurs/9682/dom-sylvain-langoureau/",
      },
    ],
  };

  await processResearchCase({
    AI: {
      run: async (_model, options) => {
        prompt = options.messages[1].content;
        return {
          response: JSON.stringify({
            profile_type: "producer-era",
            first_vintage_year: 1988,
            final_vintage_year: 2200,
            rationale: "Two attributed sources support a fresh and precise producer style.",
            confidence: 0.65,
            age_adjustments: {
              first_trial: 0,
              best_start: 0,
              best_end: 1,
              outer_horizon: 1,
            },
            trait_adjustments: {
              body: 0,
              acidity: 0.4,
              tannin: 0,
              sweetness: 0,
              alcohol: 0,
              freshness: 0.5,
              savory: 0,
              concentration: 0.1,
            },
          }),
        };
      },
    },
  }, langoureauCase, {
    acceptSuggestion: async (suggestion, page) => {
      accepted.push({ suggestion, page });
      return {
        rule_id: `rule-${suggestion.suggestion_id}`,
        source_id: `source-${suggestion.suggestion_id}`,
        source_policy_id: `policy-${suggestion.suggestion_id}`,
        source_name: page.title,
      };
    },
    complete: async (...args) => {
      completions.push(args);
      return { status: args[0] };
    },
    fetch: async (url) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /", {
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(
        `<title>Sylvain Langoureau producer profile</title><p>Sylvain Langoureau makes precise Burgundy wine with finesse, freshness, vineyards and restrained oak.</p>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });

  assert.equal(accepted.length, 2);
  assert.match(prompt, /SOURCE 1 \(technical\)/);
  assert.match(prompt, /SOURCE 2 \(editorial\)/);
  assert.equal(completions[0][0], "draft");
  assert.equal(completions[0][1].sources.length, 2);
});

test("an unrelated advanced source is rejected without poisoning shared knowledge", async () => {
  const completions = [];
  const rejected = [];
  await processResearchCase({}, {
    ...researchCase,
    allowed_sources: [],
    subject: {
      title: "Producer profile: Langoureau · white",
      search_subject: "Sylvain Langoureau white Burgundy",
      producer: "Sylvain Langoureau",
    },
    suggested_sources: [{
      suggestion_id: "suggestion-bad",
      kind: "other",
      origin: "owner",
      url: "https://unrelated.example/article",
    }],
  }, {
    complete: async (...args) => {
      completions.push(args);
      return { status: args[0] };
    },
    fetch: async (url) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /", {
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(
        "A long unrelated article about software architecture, deployment pipelines, automated tests, application observability, and cloud infrastructure.",
        { headers: { "content-type": "text/html" } },
      );
    },
    rejectSuggestion: async (suggestion, code) => rejected.push({ suggestion, code }),
  });

  assert.deepEqual(rejected.map((item) => item.code), [
    "source-does-not-match-subject",
  ]);
  assert.deepEqual(completions, [[
    "needs-source-review",
    { error_code: "suggested-sources-unusable" },
  ]]);
});
