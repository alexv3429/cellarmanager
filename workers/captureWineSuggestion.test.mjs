import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPTURE_WINE_SUGGESTION_MODEL_VERSION,
  handleCaptureWineSuggestion,
  validateCaptureWineSuggestion,
} from "./captureWineSuggestion.mjs";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const recognizedPages = [
  "JEAN-MARC BURGAUD\nMORGON CÔTE DU PY\nAPPELLATION MORGON PROTÉGÉE\n2011",
];
const sourceLines = recognizedPages[0].split("\n");
const env = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_SECRET_KEY: "service-secret",
};

function candidate() {
  return {
    producer: { value: "JEAN-MARC BURGAUD", evidence: [sourceLines[0]], confidence: "high" },
    cuvee: { value: "MORGON CÔTE DU PY", evidence: [sourceLines[1]], confidence: "medium" },
    appellation: { value: "MORGON", evidence: [sourceLines[2]], confidence: "high" },
    area: { value: null, evidence: [], confidence: "low" },
    color: { value: null, evidence: [], confidence: "low" },
    format_ml: { value: null, evidence: [], confidence: "low" },
    vintage: { value: 2011, status: "year", evidence: [sourceLines[3]], confidence: "high" },
  };
}

function request({ origin = "https://cellar.example.test", token = "user-access-token", body = { sessionId } } = {}) {
  return new Request("https://cellar.example.test/api/capture/suggest-wine", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function jsonResponse(value, status = 200) {
  return Response.json(value, { status });
}

function rpcFetcher({ saved = null, transcript = recognizedPages, completed = null } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options = {}) => {
      const call = { url: String(url), body: JSON.parse(options.body ?? "{}"), headers: options.headers };
      calls.push(call);
      if (call.url.endsWith("/list_capture_wine_suggestion")) return jsonResponse(saved);
      if (call.url.endsWith("/list_capture_ocr_result")) {
        return jsonResponse({ recognized_pages: transcript.map((text) => ({ text })) });
      }
      if (call.url.endsWith("/complete_capture_wine_suggestion")) {
        return jsonResponse(completed ?? {
          model_version: CAPTURE_WINE_SUGGESTION_MODEL_VERSION,
          suggestion: call.body.p_suggestion,
        });
      }
      assert.fail(`Unexpected request ${call.url}`);
    },
  };
}

test("classifies winery, cuvée, appellation and vintage from the saved transcript with exact evidence", async () => {
  const rpc = rpcFetcher();
  const modelCalls = [];
  const response = await handleCaptureWineSuggestion(request(), env, {
    fetch: rpc.fetch,
    runModel: async (model, input) => {
      modelCalls.push({ model, input });
      return { result: { response: JSON.stringify(candidate()) } };
    },
  });

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.suggestion.producer.value, "JEAN-MARC BURGAUD");
  assert.equal(result.suggestion.cuvee.value, "MORGON CÔTE DU PY");
  assert.equal(result.suggestion.appellation.value, "MORGON");
  assert.equal(result.suggestion.vintage.value, 2011);
  assert.equal(result.model_version, CAPTURE_WINE_SUGGESTION_MODEL_VERSION);
  assert.equal(modelCalls.length, 1);
  assert.match(modelCalls[0].model, /llama-3\.3/u);
  assert.equal(modelCalls[0].input.temperature, 0);
  assert.equal(modelCalls[0].input.max_tokens, 512);
  assert.equal(modelCalls[0].input.response_format.type, "json_schema");
  assert.match(modelCalls[0].input.messages[0].content, /Pouilly-Fuissé.*En France/u);
  assert.deepEqual(modelCalls[0].input.messages[1], {
    role: "user",
    content: JSON.stringify({ label_ocr_lines_by_photo: recognizedPages }),
  });
  assert.equal(JSON.stringify(modelCalls[0].input).includes("service-secret"), false);
  assert.equal(rpc.calls.length, 3);
  assert.ok(rpc.calls.every((call) => call.headers.authorization === "Bearer user-access-token"));
  assert.deepEqual(rpc.calls[2].body.p_suggestion, result.suggestion);
});

test("drops unsupported values and rejects a result with no grounded wine identity", () => {
  const unsupported = candidate();
  unsupported.producer.evidence = ["A winery name invented by the model"];
  unsupported.producer.value = "Invented Winery";
  const validated = validateCaptureWineSuggestion(unsupported, recognizedPages);
  assert.equal(validated?.producer.value, null);
  assert.deepEqual(validated?.producer.evidence, []);
  assert.equal(validated?.producer.confidence, "low");
  assert.equal(validated?.cuvee.value, "MORGON CÔTE DU PY");

  const ungrounded = candidate();
  ungrounded.producer.value = null;
  ungrounded.producer.evidence = [];
  ungrounded.cuvee.value = null;
  ungrounded.cuvee.evidence = [];
  assert.equal(validateCaptureWineSuggestion(ungrounded, recognizedPages), null);
});

test("does not infer color or bottle format from unrelated evidence", () => {
  const unsupportedFields = candidate();
  unsupportedFields.color = { value: "red", evidence: [sourceLines[3]], confidence: "high" };
  unsupportedFields.format_ml = { value: 750, evidence: [sourceLines[3]], confidence: "high" };
  const validated = validateCaptureWineSuggestion(unsupportedFields, recognizedPages);
  assert.equal(validated?.color.value, null);
  assert.equal(validated?.format_ml.value, null);
  assert.deepEqual(validated?.color.evidence, []);
  assert.deepEqual(validated?.format_ml.evidence, []);
});

test("returns the persisted suggestion without paying for another model call", async () => {
  const stored = { model_version: CAPTURE_WINE_SUGGESTION_MODEL_VERSION, suggestion: candidate() };
  const rpc = rpcFetcher({ saved: stored });
  let modelCalled = false;
  const response = await handleCaptureWineSuggestion(request(), env, {
    fetch: rpc.fetch,
    runModel: async () => { modelCalled = true; return {}; },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).suggestion.producer.value, "JEAN-MARC BURGAUD");
  assert.equal(modelCalled, false);
  assert.equal(rpc.calls.length, 1);
});

test("rejects unauthenticated, cross-origin and invalid-session requests before any RPC or model call", async () => {
  const rpc = rpcFetcher();
  const options = { fetch: rpc.fetch, runModel: async () => assert.fail("Model must not run") };
  assert.equal((await handleCaptureWineSuggestion(request({ token: "" }), env, options)).status, 401);
  assert.equal((await handleCaptureWineSuggestion(request({ origin: "https://evil.example.test" }), env, options)).status, 403);
  assert.equal((await handleCaptureWineSuggestion(request({ body: { sessionId: "not-a-uuid" } }), env, options)).status, 400);
  assert.equal(rpc.calls.length, 0);
});

test("downgrades a non-vintage guess without evidence to unknown before persistence", async () => {
  const invalid = candidate();
  invalid.vintage = { value: null, status: "non_vintage", evidence: [], confidence: "high" };
  const rpc = rpcFetcher();
  const response = await handleCaptureWineSuggestion(request(), env, {
    fetch: rpc.fetch,
    runModel: async () => ({ response: invalid }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.suggestion.vintage.status, "not_visible");
  assert.equal(result.suggestion.vintage.value, null);
  assert.equal(rpc.calls.some((call) => call.url.endsWith("/complete_capture_wine_suggestion")), true);
});

test("does not retain a year that conflicts with the exact label evidence", () => {
  const incorrectYear = candidate();
  incorrectYear.vintage.value = 2012;
  const validated = validateCaptureWineSuggestion(incorrectYear, recognizedPages);
  assert.equal(validated?.vintage.status, "not_visible");
  assert.equal(validated?.vintage.value, null);
  assert.deepEqual(validated?.vintage.evidence, []);
});

test("fails closed when transcript or model service is unavailable", async () => {
  const rpc = rpcFetcher({ transcript: [""] });
  const noText = await handleCaptureWineSuggestion(request(), env, {
    fetch: rpc.fetch,
    runModel: async () => assert.fail("Model must not run without source text"),
  });
  assert.equal(noText.status, 422);

  const unavailable = await handleCaptureWineSuggestion(request(), env, {
    fetch: async () => { throw new Error("offline"); },
    runModel: async () => assert.fail("Model must not run without authorized transcript"),
  });
  assert.equal(unavailable.status, 503);
});
