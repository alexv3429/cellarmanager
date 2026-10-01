import { researchConfiguration, runResearchCycle } from "./researchWorker.mjs";
import { handleInvitationEmail } from "./invitationEmail.mjs";
import { cleanupExpiredCaptureSessions } from "./captureCleanup.mjs";
import { handleCapturePreprocessing, handleCapturePreview } from "./capturePreprocessing.mjs";
import { handleCaptureRecognition } from "./captureRecognition.mjs";
import { handleCaptureWineSuggestion } from "./captureWineSuggestion.mjs";
import { validatePreparedCaptureImage } from "./captureImageValidate.mjs";
import { handleBarcodeLookup } from "./barcodeLookup.mjs";

const WORKER_VERSION = "0.6.0";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/household-invitations/email") {
      return handleInvitationEmail(request, env);
    }
    if (url.pathname === "/api/capture/process") {
      return handleCapturePreprocessing(request, env, {
        processImage: validatePreparedCaptureImage,
      });
    }
    if (url.pathname === "/api/capture/ocr") {
      return handleCaptureRecognition(request, env);
    }
    if (url.pathname === "/api/capture/suggest-wine") {
      return handleCaptureWineSuggestion(request, env);
    }
    if (url.pathname === "/api/capture/preview") {
      return handleCapturePreview(request, env);
    }
    if (url.pathname === "/api/barcodes/lookup") {
      return handleBarcodeLookup(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/research/status") {
      const configuration = researchConfiguration(env);
      return Response.json({
        version: WORKER_VERSION,
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
        profileRevisionCount: result.profileRevisions?.count ?? 0,
        profileRevisionOutcomes: Array.isArray(result.profileRevisions?.results)
          ? result.profileRevisions.results.map((item) => ({
            status: item?.status ?? "published",
            sqlstate: item?.sqlstate ?? null,
            error: item?.error ?? null,
            revisionId: item?.revision_id ?? null,
          }))
          : [],
      });
    }));
    context.waitUntil(cleanupExpiredCaptureSessions(env).then((result) => {
      console.log("Temporary photo cleanup completed", {
        status: result.status,
        claimed: result.claimed,
        deleted: result.deleted,
        failed: result.failed,
      });
    }).catch(() => {
      console.log("Temporary photo cleanup failed");
    }));
  },
};
