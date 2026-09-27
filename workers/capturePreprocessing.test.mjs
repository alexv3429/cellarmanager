import test from "node:test";
import assert from "node:assert/strict";

import { CaptureImageError } from "./captureImageNormalize.mjs";
import { handleCapturePreprocessing, handleCapturePreview } from "./capturePreprocessing.mjs";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const sourceName = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const normalizedName = "0f8fad5b-d9cb-469f-a165-70867728950e";
const sourceBytes = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
const normalizedBytes = new Uint8Array([0xff, 0xd8, 3, 4, 0xff, 0xd9]);
const env = { SUPABASE_URL: "https://db.example.test", SUPABASE_SECRET_KEY: "service-secret" };

function request({ origin = "https://cellar.example.test", token = "user-access-token", body = { sessionId } } = {}) {
  return new Request("https://cellar.example.test/api/capture/process", {
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

function claim(state = "claimed") {
  return {
    session_id: sessionId,
    state,
    assets: state === "claimed" ? [{
      source_object_name: sourceName,
      normalized_object_name: normalizedName,
      content_type: "image/jpeg",
      uploaded_bytes: sourceBytes.length,
    }] : [],
  };
}

test("requires an authenticated same-origin owner request before calling Supabase", async () => {
  const calls = [];
  const fetcher = async (...args) => { calls.push(args); return jsonResponse(claim()); };
  const wrongOrigin = await handleCapturePreprocessing(request({ origin: "https://elsewhere.example.test" }), env, {
    fetch: fetcher,
    processImage: async () => ({ bytes: normalizedBytes, contentType: "image/jpeg" }),
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(calls.length, 0);

  const noBearer = new Request("https://cellar.example.test/api/capture/process", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://cellar.example.test" },
    body: JSON.stringify({ sessionId }),
  });
  const unauthenticated = await handleCapturePreprocessing(noBearer, env, { fetch: fetcher });
  assert.equal(unauthenticated.status, 401);
  assert.equal(calls.length, 0);
});

test("processes, verifies, and immediately deletes the exact source before publishing the derivative", async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const entry = { url: String(url), method: options.method ?? "GET", headers: options.headers, body: options.body };
    calls.push(entry);
    if (entry.url.endsWith("/claim_capture_preprocessing")) return jsonResponse(claim());
    if (entry.url.endsWith(`/object/authenticated/capture-labels/${sourceName}`)) {
      return new Response(sourceBytes, { headers: { "content-length": String(sourceBytes.length) } });
    }
    if (entry.url.endsWith(`/object/capture-labels/${normalizedName}`) && entry.method === "POST") {
      return jsonResponse({ Key: normalizedName });
    }
    if (entry.url.endsWith(`/object/authenticated/capture-labels/${normalizedName}`)) {
      return new Response(normalizedBytes, { headers: { "content-length": String(normalizedBytes.length) } });
    }
    if (entry.url.endsWith("/object/capture-labels") && entry.method === "DELETE") return jsonResponse([]);
    if (entry.url.endsWith("/complete_capture_preprocessing")) return jsonResponse(true);
    assert.fail(`Unexpected request ${entry.method} ${entry.url}`);
  };
  const processImage = async (bytes, contentType) => {
    assert.deepEqual(bytes, sourceBytes);
    assert.equal(contentType, "image/jpeg");
    return { bytes: normalizedBytes, contentType: "image/jpeg" };
  };

  const response = await handleCapturePreprocessing(request(), env, { fetch: fetcher, processImage });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "processed", count: 1 });
  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "POST", "GET", "DELETE", "POST"]);
  assert.equal(calls[0].url.endsWith("/claim_capture_preprocessing"), true);
  assert.equal(calls[0].headers.authorization, "Bearer user-access-token");
  assert.equal(calls[2].url.endsWith(`/object/capture-labels/${normalizedName}`), true);
  assert.equal(calls[4].url.endsWith("/object/capture-labels"), true);
  assert.deepEqual(JSON.parse(calls[4].body), { prefixes: [sourceName] });
  assert.equal(calls[5].url.endsWith("/complete_capture_preprocessing"), true);
  assert.equal(JSON.stringify(calls).includes("service-secret"), true);
  assert.equal(JSON.stringify(calls).includes("user-access-token"), true);
  assert.equal(calls.some((call) => String(call.body ?? "").includes("\"user-access-token\"")), false);
});

test("terminal invalid images close the session, remove both objects, and return a safe error", async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const entry = { url: String(url), method: options.method ?? "GET", body: options.body };
    calls.push(entry);
    if (entry.url.endsWith("/claim_capture_preprocessing")) return jsonResponse(claim());
    if (entry.url.endsWith(`/object/authenticated/capture-labels/${sourceName}`)) {
      return new Response(sourceBytes, { headers: { "content-length": String(sourceBytes.length) } });
    }
    if (entry.url.endsWith("/fail_capture_preprocessing")) {
      return jsonResponse({ state: "deletion_pending", object_names: [sourceName, normalizedName] });
    }
    if (entry.url.endsWith("/object/capture-labels") && entry.method === "DELETE") return jsonResponse([]);
    if (entry.url.endsWith("/complete_capture_cleanup")) return jsonResponse(true);
    assert.fail(`Unexpected request ${entry.method} ${entry.url}`);
  };
  const response = await handleCapturePreprocessing(request(), env, {
    fetch: fetcher,
    processImage: async () => { throw new CaptureImageError("invalid"); },
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "invalid_photo", cleanup: "complete" });
  const deletion = calls.find((call) => call.method === "DELETE");
  assert.deepEqual(JSON.parse(deletion.body), { prefixes: [sourceName, normalizedName] });
  assert.equal(calls.at(-1).url.endsWith("/complete_capture_cleanup"), true);
});

test("returns processing for a concurrent request without reading any image", async () => {
  let calls = 0;
  const response = await handleCapturePreprocessing(request(), env, {
    fetch: async (url) => {
      calls += 1;
      assert.equal(String(url).endsWith("/claim_capture_preprocessing"), true);
      return jsonResponse(claim("processing"));
    },
    processImage: async () => assert.fail("Already claimed assets must not be decoded again"),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: "processing" });
  assert.equal(calls, 1);
});

test("serves only an authorized prepared preview with explicit no-store response headers", async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const entry = { url: String(url), method: options.method ?? "GET", headers: options.headers };
    calls.push(entry);
    if (entry.url.endsWith("/list_capture_processed_assets")) {
      return jsonResponse([{ object_name: normalizedName, content_type: "image/jpeg", size_bytes: normalizedBytes.length }]);
    }
    if (entry.url.endsWith(`/object/authenticated/capture-labels/${normalizedName}`)) {
      return new Response(normalizedBytes, { headers: { "content-length": String(normalizedBytes.length) } });
    }
    assert.fail(`Unexpected request ${entry.method} ${entry.url}`);
  };
  const response = await handleCapturePreview(request({ body: { sessionId, objectName: normalizedName } }), env, { fetch: fetcher });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), normalizedBytes);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.authorization, "Bearer user-access-token");
  assert.equal(calls[1].headers.authorization, "Bearer service-secret");
});

test("does not read storage when the requested key is not in the owner's processed session", async () => {
  const calls = [];
  const response = await handleCapturePreview(request({ body: { sessionId, objectName: sourceName } }), env, {
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET" });
      assert.equal(String(url).endsWith("/list_capture_processed_assets"), true);
      return jsonResponse([{ object_name: normalizedName, content_type: "image/jpeg", size_bytes: normalizedBytes.length }]);
    },
  });

  assert.equal(response.status, 403);
  assert.equal(calls.length, 1);
});
