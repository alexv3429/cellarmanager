import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseClient, parseOptions } from "./import_snapshot.mjs";

test("parses safe importer defaults and bounds", () => {
  const defaults = parseOptions(["--dry-run", "--file", "./source.xlsx"]);
  assert.equal(defaults.dryRun, true);
  assert.equal(defaults.batchSize, 1000);
  assert.equal(defaults.keepSuperseded, 1);
  assert.match(defaults.file, /source\.xlsx$/);

  assert.throws(
    () => parseOptions(["--file", "one.xlsx", "--url", "https://example.test/two.xlsx"]),
    /either --file or --url/,
  );
  assert.throws(() => parseOptions(["--batch-size", "0"]), /1 to 2000/);
  assert.throws(() => parseOptions(["--url", "http://example.test/file"]), /HTTPS/);
});

test("uses service credentials only in headers and encodes snapshot lookup", async () => {
  const requests = [];
  const client = createSupabaseClient({
    supabaseUrl: "http://127.0.0.1:54321",
    serviceRoleKey: "test-service-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify([
          {
            id: "snapshot-id",
            import_status: "active",
            completed_at: "2026-08-20T12:00:00Z",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await client.findSnapshot("a".repeat(64));
  assert.equal(result.id, "snapshot-id");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /content_sha256=eq\.a{64}/);
  assert.doesNotMatch(requests[0].url, /test-service-key/);
  assert.equal(requests[0].options.headers.apikey, "test-service-key");
  assert.equal(
    requests[0].options.headers.authorization,
    "Bearer test-service-key",
  );
});

test("rejects insecure non-local Supabase URLs", () => {
  assert.throws(
    () =>
      createSupabaseClient({
        supabaseUrl: "http://example.test",
        serviceRoleKey: "secret",
      }),
    /must use HTTPS/,
  );
});
