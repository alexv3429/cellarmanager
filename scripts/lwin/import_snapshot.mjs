#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import {
  mkdtemp,
  rm,
  stat,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  LWIN_SNAPSHOT_URL,
  LWIN_SOURCE_KEY,
  loadLwinSnapshot,
  lwinEntryBatches,
} from "./snapshot.mjs";

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

function usage() {
  return `Usage: npm run lwin:import -- [options]

Options:
  --file <path>              Import an already-downloaded official workbook
  --url <https-url>          Download a workbook (default: official latest URL)
  --dry-run                  Validate and profile without contacting Supabase
  --batch-size <1-2000>      Rows per Data API request (default: 1000)
  --keep-superseded <0-10>   Retain row data for this many old snapshots (default: 1)
  --help                     Show this help

Required for a real import:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`;
}

export function parseOptions(argv) {
  const options = {
    file: null,
    url: null,
    dryRun: false,
    batchSize: 1000,
    keepSuperseded: 1,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help") options.help = true;
    else if (["--file", "--url", "--batch-size", "--keep-superseded"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--file") options.file = resolve(value);
      if (argument === "--url") options.url = value;
      if (argument === "--batch-size") options.batchSize = Number(value);
      if (argument === "--keep-superseded") {
        options.keepSuperseded = Number(value);
      }
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.file && options.url) {
    throw new Error("Use either --file or --url, not both");
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 2000) {
    throw new Error("--batch-size must be an integer from 1 to 2000");
  }
  if (
    !Number.isInteger(options.keepSuperseded) ||
    options.keepSuperseded < 0 ||
    options.keepSuperseded > 10
  ) {
    throw new Error("--keep-superseded must be an integer from 0 to 10");
  }
  if (options.url !== null && !options.url.startsWith("https://")) {
    throw new Error("--url must use HTTPS");
  }
  if (!options.file && !options.url) options.url = LWIN_SNAPSHOT_URL;
  return options;
}

async function downloadWorkbook(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`LWIN download failed with HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("LWIN download exceeds the 100 MB safety limit");
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "cellarmanager-lwin-"));
  const filePath = join(temporaryDirectory, "LWINdatabase.xlsx");
  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
  const downloaded = await stat(filePath);
  if (downloaded.size > MAX_DOWNLOAD_BYTES) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error("LWIN download exceeds the 100 MB safety limit");
  }
  return { filePath, temporaryDirectory };
}

function validateSupabaseUrl(value) {
  const url = new URL(value);
  const isLocal = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("SUPABASE_URL must use HTTPS unless it targets localhost");
  }
  return value.replace(/\/$/, "");
}

export function createSupabaseClient({ supabaseUrl, serviceRoleKey, fetchImpl = fetch }) {
  const restUrl = `${validateSupabaseUrl(supabaseUrl)}/rest/v1`;
  if (!serviceRoleKey || serviceRoleKey.trim().length === 0) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  async function request(path, { method = "GET", body, prefer } = {}) {
    const response = await fetchImpl(`${restUrl}${path}`, {
      method,
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(prefer ? { prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Supabase ${method} ${path.split("?")[0]} failed (${response.status}): ${responseText.slice(0, 1000)}`,
      );
    }
    return responseText.length === 0 ? null : JSON.parse(responseText);
  }

  return {
    async findSnapshot(contentSha256) {
      const query = new URLSearchParams({
        source_key: `eq.${LWIN_SOURCE_KEY}`,
        content_sha256: `eq.${contentSha256}`,
        select: "id,import_status,completed_at",
        order: "started_at.desc",
        limit: "1",
      });
      const rows = await request(`/wine_reference_lwin_snapshots?${query}`);
      return rows[0] ?? null;
    },

    async createSnapshot(snapshot) {
      const rows = await request("/wine_reference_lwin_snapshots", {
        method: "POST",
        body: snapshot,
        prefer: "return=representation",
      });
      return rows[0];
    },

    async insertEntries(entries) {
      await request("/wine_reference_lwin_entries", {
        method: "POST",
        body: entries,
        prefer: "return=minimal",
      });
    },

    async finalizeSnapshot(snapshotId) {
      return request("/rpc/finalize_wine_reference_lwin_snapshot", {
        method: "POST",
        body: { p_snapshot_id: snapshotId },
      });
    },

    async markSnapshotFailed(snapshotId, error) {
      await request("/rpc/fail_wine_reference_lwin_snapshot", {
        method: "POST",
        body: {
          p_snapshot_id: snapshotId,
          p_failure_reason: error.message.slice(0, 1000),
        },
      });
    },

    async pruneSnapshots(keepSuperseded) {
      return request("/rpc/prune_wine_reference_lwin_snapshot_rows", {
        method: "POST",
        body: { p_keep_superseded: keepSuperseded },
      });
    },
  };
}

function printProfile(snapshot, sourceDescription) {
  const { profile } = snapshot;
  console.log(`Validated ${sourceDescription}`);
  console.log(`SHA-256: ${snapshot.contentSha256}`);
  console.log(
    `Rows: ${profile.recordCount} (${profile.liveRecordCount} live, ${profile.combinedRecordCount} combined, ${profile.deletedRecordCount} deleted)`,
  );
  console.log(`Updated through: ${profile.sourceUpdatedThrough ?? "unknown"}`);
}

export async function runImport(options, environment = process.env) {
  let temporaryDirectory = null;
  let filePath = options.file;
  const sourceRetrievedAt = new Date().toISOString();

  try {
    if (!filePath) {
      console.log(`Downloading ${options.url}`);
      const download = await downloadWorkbook(options.url);
      filePath = download.filePath;
      temporaryDirectory = download.temporaryDirectory;
    }

    const snapshot = await loadLwinSnapshot(filePath);
    printProfile(snapshot, options.file ?? options.url);
    if (options.dryRun) return { dryRun: true, profile: snapshot.profile };

    const client = createSupabaseClient({
      supabaseUrl: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    });
    const existing = await client.findSnapshot(snapshot.contentSha256);
    if (existing && existing.import_status !== "failed") {
      console.log(
        `Snapshot ${existing.id} was already imported (${existing.import_status}); nothing changed.`,
      );
      return { skipped: true, snapshotId: existing.id };
    }

    const created = await client.createSnapshot({
      source_key: LWIN_SOURCE_KEY,
      content_sha256: snapshot.contentSha256,
      source_file_name: basename(filePath),
      source_retrieved_at: sourceRetrievedAt,
      expected_record_count: snapshot.profile.recordCount,
    });

    let uploaded = 0;
    try {
      for (const batch of lwinEntryBatches(
        snapshot.worksheet,
        created.id,
        options.batchSize,
      )) {
        await client.insertEntries(batch);
        uploaded += batch.length;
        if (uploaded % 10000 === 0 || uploaded === snapshot.profile.recordCount) {
          console.log(`Uploaded ${uploaded}/${snapshot.profile.recordCount} rows`);
        }
      }

      const result = await client.finalizeSnapshot(created.id);
      const pruned = await client.pruneSnapshots(options.keepSuperseded);
      console.log(
        `Activated snapshot ${created.id}; pruned row data from ${pruned} older snapshot(s).`,
      );
      return { snapshotId: created.id, result, pruned };
    } catch (error) {
      try {
        await client.markSnapshotFailed(created.id, error);
      } catch (markError) {
        console.error(`Unable to mark snapshot failed: ${markError.message}`);
      }
      throw error;
    }
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  await runImport(options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
