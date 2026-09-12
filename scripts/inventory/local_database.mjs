import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readdir } from "node:fs/promises"

const container = "supabase_db_cellarmanager"

export function temporaryDatabaseName(name) {
  assert.equal(name.trim(), name, "Database names cannot contain surrounding whitespace")
  assert.match(name, /^cm_inventory_acceptance_[a-f0-9]{24}$/,
    "Only a generated inventory acceptance database may be modified or dropped")
  return name
}

export function localDockerEndpoint(endpoint) {
  assert.equal(endpoint.trim(), endpoint, "Docker endpoints cannot contain surrounding whitespace")
  assert.match(endpoint, /^unix:\/\/\/[^\r\n]+$/,
    "Inventory acceptance requires a local Docker Unix socket; remote engines are refused")
  return endpoint
}

function processCommand(args, input, timeout = 60_000) {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] })
  let output = ""
  let errors = ""
  let finished = false
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout)
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { output += chunk })
    child.stderr.on("data", (chunk) => { errors += chunk })
    child.stdin.on("error", () => { /* A failed psql process may close stdin first. */ })
    child.on("error", reject)
    child.on("close", (code, signal) => {
      finished = true
      clearTimeout(timer)
      if (code === 0) resolve(output.trim())
      else reject(new Error(`Local database command failed (${signal ?? code}): ${errors.trim()}`))
    })
  })
  // Concurrent failures are collected after the barrier is released.
  void done.catch(() => {})
  if (input !== undefined) child.stdin.end(input)
  return { child, done, get finished() { return finished } }
}

export async function createLocalDatabase() {
  const endpoint = localDockerEndpoint(process.env.DOCKER_HOST || await processCommand(
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], "",
  ).done)
  const docker = ["--host", endpoint]
  const name = temporaryDatabaseName(`cm_inventory_acceptance_${randomBytes(12).toString("hex")}`)
  let created = false
  let closing
  const psql = (database, sql, appName = "cm_inventory_acceptance", user = "postgres") => processCommand([
    ...docker, "exec", "-i", "-e", `PGAPPNAME=${appName}`,
    "-e", "PGOPTIONS=-c statement_timeout=20000 -c lock_timeout=15000 -c idle_in_transaction_session_timeout=20000",
    container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
    "-U", user, "-d", database, "-f", "-",
  ], sql)
  const query = (sql) => psql(temporaryDatabaseName(name), sql).done
  const close = () => {
    if (closing) return closing
    if (!created) return Promise.resolve()
    closing = psql("postgres", `DROP DATABASE "${temporaryDatabaseName(name)}" WITH (FORCE);`).done.then(() => {
      created = false
      console.log(`Removed temporary database ${name} (synthetic data only).`)
    }).finally(() => { closing = undefined })
    return closing
  }

  try {
    // Reading migration versions and schema is the only access to the source DB.
    const versions = new Set((await psql("postgres",
      "SELECT version FROM supabase_migrations.schema_migrations;").done).split("\n"))
    const migrations = await readdir(new URL("../../supabase/migrations/", import.meta.url))
    const missing = migrations.filter((file) => file.endsWith(".sql") && !versions.has(file.split("_")[0]))
    assert.equal(missing.length, 0,
      `Apply pending migrations to LOCAL Supabase first: ${missing.join(", ")}`)
    const schema = await processCommand([
      ...docker, "exec", container, "pg_dump", "-U", "postgres", "-d", "postgres",
      "--schema-only", "--schema=public", "--schema=private", "--schema=auth",
    ], "").done
    await psql("postgres", `CREATE DATABASE "${name}" TEMPLATE template0;`).done
    created = true
    await query(`
      DROP SCHEMA public;
      CREATE SCHEMA extensions;
      CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
      CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
      CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
      CREATE EXTENSION unaccent WITH SCHEMA extensions;
    `)
    // Restore original owners and ACLs, including auth's default privileges.
    // The cluster administrator is used only to restore into our empty database;
    // stock RPCs below use SET LOCAL ROLE authenticated.
    await psql(name, schema, "cm_inventory_restore", "supabase_admin").done
    assert.equal(await query("SELECT count(*) FROM auth.users;"), "0", "No accounts are copied")
    assert.equal(await query("SELECT count(*) FROM public.holdings;"), "0", "No holdings are copied")
    console.log(`Prepared ${name} from local schema only; no source data copied.`)
  } catch (error) {
    await close()
    throw error
  }

  async function concurrently(householdId, statements) {
    assert.match(householdId, /^[a-f0-9-]{36}$/)
    const prefix = `cm_race_${randomBytes(8).toString("hex")}`
    const barrier = psql(name, undefined, `${prefix}_barrier`)
    const sessions = []
    const waitUntil = async (sql, expected, processes) => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (await query(sql) === String(expected)) return
        assert.ok(processes.every((session) => !session.finished),
          "A contender exited without waiting at the concurrency barrier")
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error("Timed out proving simultaneous database sessions at the barrier")
    }
    try {
      barrier.child.stdin.write(`BEGIN;
        SELECT pg_advisory_xact_lock(hashtextextended('${householdId}', 0));\n`)
      await waitUntil(`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = '${prefix}_barrier'
        AND state = 'idle in transaction';`, 1, [barrier])
      // Establish queue order while proving every contender is genuinely in flight.
      for (const [index, statement] of statements.entries()) {
        sessions.push(psql(name, statement, `${prefix}_${index}`))
        await waitUntil(`SELECT count(DISTINCT a.pid) FROM pg_stat_activity a
          JOIN pg_locks l ON l.pid = a.pid
          WHERE a.datname = current_database() AND a.application_name LIKE '${prefix}_%'
          AND l.locktype = 'advisory' AND NOT l.granted;`, sessions.length, sessions)
      }
      barrier.child.stdin.end("COMMIT;\n")
      await barrier.done
      return await Promise.allSettled(sessions.map((session) => session.done))
    } finally {
      if (!barrier.finished && !barrier.child.stdin.writableEnded) barrier.child.stdin.end("ROLLBACK;\n")
      await Promise.allSettled([barrier.done, ...sessions.map((session) => session.done)])
    }
  }

  return { name, query, concurrently, close }
}
