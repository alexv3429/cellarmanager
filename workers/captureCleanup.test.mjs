import test from "node:test";
import assert from "node:assert/strict";

import { cleanupExpiredCaptureSessions } from "./captureCleanup.mjs";

const env = {
  SUPABASE_URL: "https://cellar.example.test",
  SUPABASE_SECRET_KEY: "test-secret",
};
const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const objectOne = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const objectTwo = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test("removes only claimed exact objects through Storage API before finalizing", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/claim_capture_cleanup")) {
      return jsonResponse([{ session_id: sessionId, object_names: [objectOne, objectTwo] }]);
    }
    if (url.endsWith("/storage/v1/object/capture-labels")) return jsonResponse([]);
    if (url.endsWith("/complete_capture_cleanup")) return jsonResponse(true);
    return jsonResponse({}, 404);
  };

  const result = await cleanupExpiredCaptureSessions(env, { fetch });

  assert.deepEqual(result, { status: "completed", claimed: 1, deleted: 1, failed: 0 });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.method, "DELETE");
  assert.deepEqual(JSON.parse(calls[1].options.body), { prefixes: [objectOne, objectTwo] });
  assert.equal(calls[2].url.endsWith("/complete_capture_cleanup"), true);
  assert.equal(calls.some(({ url }) => url.includes("/rest/v1/storage.objects")), false);
});

test("does not finalize a session when Storage deletion fails", async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    if (url.endsWith("/claim_capture_cleanup")) {
      return jsonResponse([{ session_id: sessionId, object_names: [objectOne] }]);
    }
    return jsonResponse({ message: "storage unavailable" }, 503);
  };

  const result = await cleanupExpiredCaptureSessions(env, { fetch });

  assert.deepEqual(result, { status: "partial", claimed: 1, deleted: 0, failed: 1 });
  assert.equal(urls.some((url) => url.endsWith("/complete_capture_cleanup")), false);
});

test("rejects a malformed path without calling the Storage API", async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return jsonResponse([{ session_id: sessionId, object_names: ["../other-bucket/photo"] }]);
  };

  const result = await cleanupExpiredCaptureSessions(env, { fetch });

  assert.deepEqual(result, { status: "partial", claimed: 1, deleted: 0, failed: 1 });
  assert.equal(urls.some((url) => url.includes("/storage/v1/")), false);
});

test("reports missing configuration without making a request", async () => {
  let called = false;
  const result = await cleanupExpiredCaptureSessions({}, { fetch: async () => { called = true; } });
  assert.deepEqual(result, { status: "not_configured", claimed: 0, deleted: 0, failed: 0 });
  assert.equal(called, false);
});
