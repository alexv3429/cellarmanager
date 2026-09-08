import assert from "node:assert/strict"
import test from "node:test"

import worker from "../../workers/index.mjs"

test("public research readiness exposes release metadata without secrets", async () => {
  const response = await worker.fetch(
    new Request("https://cellarmanager.example/api/research/status"),
    {
      AI: {},
      SUPABASE_SECRET_KEY: "server-secret",
      SUPABASE_URL: "https://database.example",
      TAVILY_API_KEY: "search-secret",
      ASSETS: {
        fetch() {
          throw new Error("static assets should not handle the status route")
        },
      },
    },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json()
  assert.match(body.version, /^\d+\.\d+\.\d+$/)
  assert.deepEqual(body, {
    version: body.version,
    status: "ready",
    configuration: {
      ai: true,
      braveSearch: false,
      tavilySearch: true,
      supabase: true,
    },
  })
})

test("non-status requests continue to the static application", async () => {
  const expected = new Response("application")
  const response = await worker.fetch(
    new Request("https://cellarmanager.example/catalog"),
    {
      ASSETS: {
        fetch(request) {
          assert.equal(request.url, "https://cellarmanager.example/catalog")
          return expected
        },
      },
    },
  )

  assert.equal(response, expected)
})
