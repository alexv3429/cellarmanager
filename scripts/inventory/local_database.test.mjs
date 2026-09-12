import assert from "node:assert/strict"
import test from "node:test"
import { localDockerEndpoint, temporaryDatabaseName } from "./local_database.mjs"

test("destructive target validation refuses source databases, broad names and SQL", () => {
  for (const name of ["postgres", "template0", "cellarmanager", "cm_inventory_acceptance_", "cm_inventory_acceptance_*", "x'; DROP DATABASE postgres; --"]) {
    assert.throws(() => temporaryDatabaseName(name))
  }
  const generated = "cm_inventory_acceptance_0123456789abcdef01234567"
  assert.equal(temporaryDatabaseName(generated), generated)
  assert.throws(() => temporaryDatabaseName(`${generated}\n`))
})

test("acceptance cannot target a remote Docker daemon", () => {
  for (const endpoint of ["tcp://example.com:2376", "ssh://user@example.com", "", "unix://relative", "unix:///socket\nother", "unix:///socket\n"]) {
    assert.throws(() => localDockerEndpoint(endpoint))
  }
  assert.equal(localDockerEndpoint("unix:///var/run/docker.sock"), "unix:///var/run/docker.sock")
})
