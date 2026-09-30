import assert from "node:assert/strict";
import test from "node:test";

import { handleBarcodeLookup } from "./barcodeLookup.mjs";

const env = { SUPABASE_URL: "https://db.example", SUPABASE_SECRET_KEY: "server-secret" };
const code = "00036000291452";
const request = (gtin14 = code) => new Request("https://app.example/api/barcodes/lookup", {
  method: "POST",
  headers: { origin: "https://app.example", authorization: `Bearer ${"a".repeat(24)}`, "content-type": "application/json" },
  body: JSON.stringify({ gtin14 }),
});

test("looks up only a checked GTIN after verifying the signed-in user", async () => {
  const calls = [];
  const response = await handleBarcodeLookup(request(), env, { fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "signed-in" });
    return Response.json({ product: { code: "0036000291452", product_name: "Wine", brands: "Estate", quantity: "75 cl" } });
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { product: {
    name: "Wine", brand: "Estate", quantity: "75 cl",
    sourceUrl: "https://world.openfoodfacts.org/product/0036000291452",
  } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.authorization, undefined);
  assert.equal(calls[1].options.redirect, "error");
});

test("rejects invalid codes and unauthorized callers without querying the provider", async () => {
  let calls = 0;
  const invalid = await handleBarcodeLookup(request("00036000291453"), env, { fetch: async () => { calls++; return Response.json({}); } });
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
  const unauthenticated = await handleBarcodeLookup(request(), env, { fetch: async () => {
    calls++;
    return new Response(null, { status: 401 });
  } });
  assert.equal(unauthenticated.status, 401);
  assert.equal(calls, 1);
});

test("unknown and mismatched products do not become wine facts", async () => {
  const auth = async (url, product) => url.endsWith("/auth/v1/user")
    ? Response.json({ id: "signed-in" }) : Response.json({ product });
  const missing = await handleBarcodeLookup(request(), env, { fetch: (url) => auth(url, null) });
  assert.deepEqual(await missing.json(), { product: null });
  const missingHttp = await handleBarcodeLookup(request(), env, { fetch: (url) => url.endsWith("/auth/v1/user")
    ? Response.json({ id: "signed-in" }) : Response.json({ status: "failure" }, { status: 404 }) });
  assert.deepEqual(await missingHttp.json(), { product: null });
  const mismatch = await handleBarcodeLookup(request(), env, { fetch: (url) => auth(url, { code: "1234567890123" }) });
  assert.equal(mismatch.status, 503);
});

test("distinguishes authentication and provider failures", async () => {
  const authUnavailable = await handleBarcodeLookup(request(), env, { fetch: async () => {
    throw new Error("auth network failure");
  } });
  assert.deepEqual(await authUnavailable.json(), { error: "authentication_unavailable" });

  for (const [status, error] of [[403, "provider_denied"], [429, "provider_rate_limited"]]) {
    const response = await handleBarcodeLookup(request(), env, { fetch: async (url) => url.endsWith("/auth/v1/user")
      ? Response.json({ id: "signed-in" }) : new Response(null, { status }) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error });
  }
});
