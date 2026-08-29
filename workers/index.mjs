import { researchConfiguration, runResearchCycle } from "./researchWorker.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/research/status") {
      const configuration = researchConfiguration(env);
      return Response.json({
        status: configuration.ai && configuration.supabase
          ? "ready"
          : "not-configured",
        configuration,
      }, {
        headers: { "cache-control": "no-store" },
      });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, context) {
    context.waitUntil(runResearchCycle(env).then((result) => {
      console.log("Research cycle completed", {
        status: result.status,
        claimed: result.count ?? 0,
        outcomes: Array.isArray(result.results)
          ? result.results.map((item) => item?.status ?? "unknown")
          : [],
        caseStatusCounts: result.caseStatusCounts ?? {},
        publicationCount: Array.isArray(result.publications)
          ? result.publications.length
          : 0,
        publicationOutcomes: Array.isArray(result.publications)
          ? result.publications.map((item) => ({
            status: item?.status ?? "published",
            sqlstate: item?.sqlstate ?? null,
            error: item?.error ?? null,
            type: item?.publication_type ?? null,
          }))
          : [],
      });
    }));
  },
};
