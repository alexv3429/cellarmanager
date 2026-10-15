import test from "node:test";
import assert from "node:assert/strict";

import { supabaseServiceHeaders } from "./supabaseServiceHeaders.mjs";

test("modern secret keys use only the apikey header", () => {
  assert.deepEqual(supabaseServiceHeaders("sb_secret_test", "image/jpeg"), {
    apikey: "sb_secret_test",
    "content-type": "image/jpeg",
  });
});

test("legacy service-role JWTs retain their Bearer header during migration", () => {
  assert.deepEqual(supabaseServiceHeaders("header.payload.signature"), {
    apikey: "header.payload.signature",
    authorization: "Bearer header.payload.signature",
    "content-type": "application/json",
  });
});
