import test from "node:test";
import assert from "node:assert/strict";

import { handleCaptureRecognition } from "./captureRecognition.mjs";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const objectName = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const imageBytes = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
const env = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_SECRET_KEY: "service-secret",
};

function request({ origin = "https://cellar.example.test", token = "user-access-token", body = { sessionId } } = {}) {
  return new Request("https://cellar.example.test/api/capture/ocr", {
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

function imageResponse(bytes = imageBytes) {
  return new Response(bytes, {
    headers: { "content-length": String(bytes.length), "content-type": "image/jpeg" },
  });
}

function asset() {
  return { object_name: objectName, content_type: "image/jpeg", size_bytes: imageBytes.length };
}

test("transcribes a verified owner photo with Cloudflare AI, saves private text, and deletes the image", async () => {
  const calls = [];
  const aiCalls = [];
  const fetcher = async (url, options = {}) => {
    const call = { url: String(url), method: options.method ?? "GET", headers: options.headers, body: options.body };
    calls.push(call);
    if (call.url.endsWith("/list_capture_processed_assets")) return jsonResponse([asset()]);
    if (call.url.endsWith(`/object/authenticated/capture-labels/${objectName}`)) return imageResponse();
    if (call.url.endsWith("/complete_capture_ocr")) return jsonResponse({ state: "ocr_deletion_pending", object_names: [objectName] });
    if (call.url.endsWith("/object/capture-labels") && call.method === "DELETE") return jsonResponse([]);
    if (call.url.endsWith("/complete_capture_cleanup")) return jsonResponse(true);
    assert.fail(`Unexpected request ${call.method} ${call.url}`);
  };
  const runModel = async (model, input) => {
    aiCalls.push({ model, input });
    return {
      result: {
        answer: "JEAN-MARC BURGAUD\nMORGON CÔTE DU PY\n2011",
        finish_reason: "stop",
      },
      usage: { completion_tokens: 58 },
    };
  };

  const response = await handleCaptureRecognition(request(), env, { fetch: fetcher, runModel });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "recognized",
    engine_version: "cloudflare-moondream3.1-9b-a2b-v1",
    pages: [{ text: "JEAN-MARC BURGAUD\nMORGON CÔTE DU PY\n2011", confidence: 0 }],
  });
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].model, "@cf/moondream/moondream3.1-9B-A2B");
  assert.equal(aiCalls[0].input.task, "query");
  assert.equal(aiCalls[0].input.reasoning, true);
  assert.equal(aiCalls[0].input.temperature, 0);
  assert.equal(aiCalls[0].input.max_tokens, 512);
  assert.equal(aiCalls[0].input.question,
    "Transcribe exactly all text visible on the front wine label. Preserve accents and numbers. Do not guess or complete unreadable text");
  assert.match(aiCalls[0].input.image, /^data:image\/jpeg;base64,/);
  assert.equal(aiCalls[0].input.image, `data:image/jpeg;base64,${Buffer.from(imageBytes).toString("base64")}`);
  assert.equal(aiCalls[0].input.question.includes(sessionId), false);
  assert.deepEqual(JSON.parse(calls[2].body), {
    p_session_id: sessionId,
    p_pages: [{ object_name: objectName, text: "JEAN-MARC BURGAUD\nMORGON CÔTE DU PY\n2011", confidence: 0 }],
    p_language_code: "und",
    p_engine_version: "cloudflare-moondream3.1-9b-a2b-v1",
  });
  assert.deepEqual(JSON.parse(calls[3].body), { prefixes: [objectName] });
  assert.equal(calls.at(-1).url.endsWith("/complete_capture_cleanup"), true);
  assert.equal(calls[0].headers.authorization, "Bearer user-access-token");
  assert.equal(calls[1].headers.authorization, "Bearer service-secret");
  assert.equal(aiCalls.some((call) => JSON.stringify(call).includes("service-secret")), false);
});

test("rejects a cross-origin request before reading a capture or invoking AI", async () => {
  let calls = 0;
  const response = await handleCaptureRecognition(request({ origin: "https://elsewhere.example.test" }), env, {
    fetch: async () => { calls += 1; return jsonResponse([asset()]); },
    runModel: async () => { calls += 1; return { answer: "text" }; },
  });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("preserves the private photo and does not save OCR when Workers AI fails", async () => {
  const calls = [];
  const response = await handleCaptureRecognition(request(), env, {
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET" });
      if (String(url).endsWith("/list_capture_processed_assets")) return jsonResponse([asset()]);
      if (String(url).endsWith(`/object/authenticated/capture-labels/${objectName}`)) return imageResponse();
      assert.fail(`Unexpected request ${String(url)}`);
    },
    runModel: async () => { throw new Error("daily free allowance exhausted"); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "recognition_unavailable" });
  assert.equal(calls.length, 2);
});

test("keeps the photo available when the model cannot read any label text", async () => {
  const calls = [];
  const response = await handleCaptureRecognition(request(), env, {
    fetch: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/list_capture_processed_assets")) return jsonResponse([asset()]);
      if (String(url).endsWith(`/object/authenticated/capture-labels/${objectName}`)) return imageResponse();
      assert.fail(`Unexpected request ${String(url)}`);
    },
    runModel: async () => ({
      result: { answer: "  ", finish_reason: "stop" },
      usage: { completion_tokens: 1 },
    }),
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "no_text" });
  assert.equal(calls.length, 2);
});

test("does not invoke AI for missing or invalid prepared photos", async () => {
  let aiCalls = 0;
  const response = await handleCaptureRecognition(request(), env, {
    fetch: async (url) => {
      assert.equal(String(url).endsWith("/list_capture_processed_assets"), true);
      return jsonResponse([{ ...asset(), object_name: "not-an-opaque-key" }]);
    },
    runModel: async () => { aiCalls += 1; return { answer: "text" }; },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "capture_unavailable" });
  assert.equal(aiCalls, 0);
});
