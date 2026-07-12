/**
 * Talks to the backend API. When the network is unavailable, mutating
 * requests for add/move/remove are queued in IndexedDB (see offlineQueue.js
 * and db.js) instead of failing outright, and read requests fall back to
 * the local cache. Call `syncOutbox()` after reconnecting (app.js does this
 * automatically on the browser's `online` event).
 */
import * as db from "./db.js";
import { createOutboxEntry, classifyReplayResult, orderForReplay } from "./offlineQueue.js";

const MAX_REPLAY_ATTEMPTS = 5;

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.status = status;
    this.detail = detail;
  }
}

async function authHeaders() {
  const token = await db.getMeta("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, { json, isForm, silent404 } = {}) {
  const headers = await authHeaders();
  let body;
  if (isForm) {
    body = json; // already a FormData
  } else if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  let response;
  try {
    response = await fetch(path, { method, headers, body });
  } catch (networkErr) {
    throw new ApiError(0, "network");
  }
  if (response.status === 401) {
    await db.setMeta("token", null);
    window.dispatchEvent(new CustomEvent("auth:expired"));
    throw new ApiError(401, "auth.session_expired");
  }
  if (silent404 && response.status === 404) return null;
  if (!response.ok) {
    let detail;
    try {
      detail = (await response.json()).detail;
    } catch {
      detail = response.statusText;
    }
    throw new ApiError(response.status, detail);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

export async function get(path) {
  return request("GET", path);
}

export async function post(path, jsonBody) {
  return request("POST", path, { json: jsonBody });
}

export async function postForm(path, formData) {
  return request("POST", path, { json: formData, isForm: true });
}

export async function put(path, jsonBody) {
  return request("PUT", path, { json: jsonBody });
}

/**
 * A mutation that should be queued for offline replay if the network is
 * down. `action` is one of offlineQueue.QUEUEABLE_ACTIONS (e.g.
 * "holdings/add"); `path` is the real endpoint path.
 */
export async function mutateOrQueue(action, path, payload) {
  try {
    return { queued: false, result: await post(path, payload) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      const entry = createOutboxEntry(action, payload);
      await db.enqueueOutboxEntry(entry);
      return { queued: true, entry };
    }
    throw err;
  }
}

const ACTION_PATHS = {
  "holdings/add": "/holdings/add",
  "holdings/move": "/holdings/move",
  "holdings/remove": "/holdings/remove",
};

/** Replays queued offline mutations in the order they were created. Call
 * after the browser reports it's back online. Returns a small summary so
 * the UI can show "N changes synced" / "N still pending". */
export async function syncOutbox() {
  const pending = orderForReplay(await db.listOutbox());
  let synced = 0;
  let stillPending = 0;
  for (const entry of pending) {
    let statusCode;
    try {
      await post(ACTION_PATHS[entry.action], entry.payload);
      statusCode = 200;
    } catch (err) {
      statusCode = err instanceof ApiError ? err.status : 0;
    }
    const outcome = classifyReplayResult(statusCode, MAX_REPLAY_ATTEMPTS, entry.attempts);
    if (outcome === "done") {
      await db.removeFromOutbox(entry.clientOpId);
      synced += 1;
    } else if (outcome === "give_up") {
      await db.removeFromOutbox(entry.clientOpId);
      stillPending += 1;
      console.error("Giving up on offline change after repeated failures:", entry);
    } else {
      entry.attempts += 1;
      await db.enqueueOutboxEntry(entry);
      stillPending += 1;
    }
  }
  return { synced, stillPending };
}

export async function pendingOutboxCount() {
  return (await db.listOutbox()).length;
}
