/** Network API with entity caching, optimistic offline mutations and safe replay. */
import * as db from "./db.js";
import {
  createOutboxEntry,
  classifyReplayResult,
  orderForReplay,
} from "./offlineQueue.js";

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
    body = json;
  } else if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }

  let response;
  try {
    response = await fetch(path, { method, headers, body });
  } catch {
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
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function parsedPath(path) {
  return new URL(path, window.location.origin);
}

async function cacheEntities(path, value) {
  const url = parsedPath(path);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "wines") {
    if (parts.length === 1 && Array.isArray(value)) {
      if (!url.search) await db.replaceAll("wines", value);
      else await db.putAll("wines", value);
    } else if (parts.length === 2 && value?.id) {
      await db.put("wines", value);
    }
  } else if (parts[0] === "cellars") {
    if (parts.length === 1 && Array.isArray(value)) {
      await db.replaceAll("cellars", value);
    } else if (parts.length === 2 && value?.id) {
      await db.put("cellars", value);
    }
  } else if (parts[0] === "holdings") {
    if (parts.length === 1 && Array.isArray(value)) {
      if (!url.search) await db.replaceAll("holdings", value);
      else await db.putAll("holdings", value);
    }
  }
  await db.cacheResponse(path, value);
}

function matchesSearch(wine, search) {
  if (!search) return true;
  const haystack = [wine.producer, wine.cuvee, wine.appellation, wine.area]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

async function localEntityFallback(path) {
  const url = parsedPath(path);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] === "wines") {
    if (parts.length === 2) return db.get("wines", parts[1]);
    const wines = await db.getAll("wines");
    const search = url.searchParams.get("search");
    return wines.filter((wine) => matchesSearch(wine, search));
  }
  if (parts[0] === "cellars") {
    if (parts.length === 2) return db.get("cellars", parts[1]);
    return db.getAll("cellars");
  }
  if (parts[0] === "holdings") {
    let holdings = await db.getAll("holdings");
    const wineId = url.searchParams.get("wine_id");
    const cellarId = url.searchParams.get("cellar_id");
    const state = url.searchParams.get("state");
    if (wineId) holdings = holdings.filter((holding) => holding.wine_id === wineId);
    if (cellarId) holdings = holdings.filter((holding) => holding.cellar_id === cellarId);
    if (state) holdings = holdings.filter((holding) => holding.state === state);
    return holdings;
  }
  if (parts[0] === "stats") return computeLocalStats(url.searchParams.get("cellar_id"));
  return db.getCachedResponse(path);
}

export async function get(path) {
  try {
    const result = await request("GET", path);
    await cacheEntities(path, result);
    return result;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 0) throw error;
    const cached = await localEntityFallback(path);
    if (cached === null || cached === undefined) throw error;
    window.dispatchEvent(new CustomEvent("offline:cache-used", { detail: { path } }));
    return cached;
  }
}

export async function post(path, jsonBody) {
  if (path === "/recommendations") {
    const key = `POST:${path}:${stableStringify(jsonBody)}`;
    try {
      const result = await request("POST", path, { json: jsonBody });
      await db.cacheResponse(key, result);
      return result;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 0) throw error;
      const local = await localRecommendations(jsonBody);
      if (local.length || (await db.getAll("holdings")).length) return local;
      const cached = await db.getCachedResponse(key);
      if (cached !== null && cached !== undefined) return cached;
      throw error;
    }
  }
  return request("POST", path, { json: jsonBody });
}

export async function postForm(path, formData) {
  return request("POST", path, { json: formData, isForm: true });
}

export async function put(path, jsonBody) {
  const result = await request("PUT", path, { json: jsonBody });
  await cacheEntities(path.split("?")[0], result);
  return result;
}

export async function del(path) {
  return request("DELETE", path);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

async function optimisticMutation(entry) {
  const payload = entry.payload;
  if (entry.action === "holdings/add") {
    const holdings = await db.getAll("holdings");
    const existing = holdings.find(
      (holding) =>
        holding.wine_id === payload.wine_id &&
        (holding.cellar_id || null) === (payload.cellar_id || null) &&
        (holding.location || "") === (payload.location || "") &&
        holding.state === "in_cellar",
    );
    if (existing) {
      existing.quantity += payload.quantity;
      existing.pending_sync = true;
      await db.put("holdings", existing);
    } else {
      await db.put("holdings", {
        id: `offline-${entry.clientOpId}`,
        wine_id: payload.wine_id,
        cellar_id: payload.cellar_id || null,
        location: payload.location || null,
        quantity: payload.quantity,
        state: "in_cellar",
        price_bought: payload.price_bought ?? null,
        acquired_date: payload.acquired_date ?? null,
        version: 0,
        pending_sync: true,
        client_op_id: entry.clientOpId,
      });
    }
    return;
  }

  const source = await db.get("holdings", payload.holding_id);
  if (!source || source.quantity < payload.quantity || source.state !== "in_cellar") {
    throw new ApiError(409, {
      code: "offline_snapshot_missing",
      message: "The cached holding is missing or no longer has enough bottles.",
    });
  }
  source.quantity -= payload.quantity;
  source.pending_sync = true;
  await db.put("holdings", source);

  if (entry.action === "holdings/move") {
    const holdings = await db.getAll("holdings");
    const destination = holdings.find(
      (holding) =>
        holding.wine_id === source.wine_id &&
        (holding.cellar_id || null) === (payload.to_cellar_id || null) &&
        (holding.location || "") === (payload.to_location || "") &&
        holding.state === "in_cellar" &&
        holding.id !== source.id,
    );
    if (destination) {
      destination.quantity += payload.quantity;
      destination.pending_sync = true;
      await db.put("holdings", destination);
    } else {
      await db.put("holdings", {
        ...source,
        id: `offline-${entry.clientOpId}`,
        cellar_id: payload.to_cellar_id || null,
        location: payload.to_location || null,
        quantity: payload.quantity,
        version: 0,
        pending_sync: true,
        client_op_id: entry.clientOpId,
      });
    }
  }
}

export async function mutateOrQueue(action, path, payload) {
  try {
    const result = await post(path, payload);
    if (result?.holding) await db.put("holdings", result.holding);
    return { queued: false, result };
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      const entry = createOutboxEntry(action, payload);
      await optimisticMutation(entry);
      await db.enqueueOutboxEntry(entry);
      return { queued: true, entry };
    }
    throw error;
  }
}

const ACTION_PATHS = {
  "holdings/add": "/holdings/add",
  "holdings/move": "/holdings/move",
  "holdings/remove": "/holdings/remove",
};

export async function syncOutbox() {
  const pending = orderForReplay(await db.listOutbox());
  let synced = 0;
  let stillPending = pending.length;
  let conflicts = 0;
  let failed = 0;

  for (const entry of pending) {
    let statusCode = 0;
    let detail = null;
    try {
      const result = await request("POST", ACTION_PATHS[entry.action], {
        json: entry.payload,
      });
      statusCode = 200;
      if (result?.holding) {
        const temporaryId = `offline-${entry.clientOpId}`;
        await db.put("holdings", result.holding);
        if (entry.action === "holdings/add" || entry.action === "holdings/move") {
          await db.remapOutboxHoldingId(temporaryId, result.holding.id);
          if (temporaryId !== result.holding.id) {
            await db.remove("holdings", temporaryId);
          }
        }
      }
    } catch (error) {
      statusCode = error instanceof ApiError ? error.status : 0;
      detail = error instanceof ApiError ? error.detail : String(error);
    }

    const outcome = classifyReplayResult(
      statusCode,
      MAX_REPLAY_ATTEMPTS,
      entry.attempts,
    );
    if (outcome === "done") {
      await db.removeFromOutbox(entry.clientOpId);
      synced += 1;
      stillPending -= 1;
      continue;
    }
    if (outcome === "conflict") {
      await db.saveConflict(entry, detail);
      await db.removeFromOutbox(entry.clientOpId);
      conflicts += 1;
      stillPending -= 1;
      break; // preserve ordering: later operations may depend on this one
    }
    if (outcome === "dead_letter") {
      await db.saveDeadLetter(entry, { statusCode, detail });
      await db.removeFromOutbox(entry.clientOpId);
      failed += 1;
      stillPending -= 1;
      break;
    }

    entry.attempts += 1;
    entry.lastError = detail;
    await db.enqueueOutboxEntry(entry);
    break;
  }

  if (synced > 0 || conflicts > 0 || failed > 0) {
    try {
      const fresh = await request("GET", "/holdings");
      await db.replaceAll("holdings", fresh);
      await db.cacheResponse("/holdings", fresh);
    } catch {
      // A later online event will refresh; never discard recorded sync status.
    }
  }
  return { synced, stillPending, conflicts, failed };
}

export async function pendingOutboxCount() {
  return (await db.listOutbox()).length;
}

export async function conflictCount() {
  return (await db.listConflicts()).length;
}

export async function failedOfflineCount() {
  return (await db.listDeadLetters()).length;
}

export async function listSyncProblems() {
  return {
    conflicts: await db.listConflicts(),
    failed: await db.listDeadLetters(),
  };
}

export async function discardSyncProblem(kind, clientOpId) {
  if (kind === "conflict") await db.removeConflict(clientOpId);
  else if (kind === "failed") await db.removeDeadLetter(clientOpId);
  else throw new Error(`Unknown sync problem kind '${kind}'`);
}

export async function retrySyncProblem(kind, clientOpId) {
  const problems = kind === "conflict" ? await db.listConflicts() : await db.listDeadLetters();
  const problem = problems.find((item) => item.clientOpId === clientOpId);
  if (!problem) throw new Error("Sync problem not found");

  let entry;
  if (kind === "conflict") {
    // A conflict retry intentionally changes the expected version, so it must
    // use a new idempotency key. The original operation remains an immutable
    // historical conflict record until this replacement is safely queued.
    const current =
      problem.conflictDetail?.current || problem.conflictDetail?.detail?.current;
    const payload = { ...problem.payload };
    delete payload.client_op_id;
    if (
      current?.version != null &&
      (problem.action === "holdings/move" || problem.action === "holdings/remove")
    ) {
      payload.expected_version = current.version;
    }
    entry = createOutboxEntry(problem.action, payload);
    await optimisticMutation(entry);
  } else {
    // A failed request may actually have reached the server while its response
    // was lost. Reuse the exact operation id so server-side idempotency makes
    // retry safe instead of applying the stock mutation a second time.
    entry = {
      clientOpId: problem.clientOpId,
      action: problem.action,
      payload: { ...problem.payload, client_op_id: problem.clientOpId },
      createdAt: Date.now(),
      attempts: 0,
    };
  }

  await db.enqueueOutboxEntry(entry);
  await discardSyncProblem(kind, clientOpId);
  return entry;
}

function tokenize(text) {
  return new Set(
    (text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [],
  );
}

function intersectionSize(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

async function localRecommendations(criteria) {
  const holdings = (await db.getAll("holdings")).filter(
    (holding) => holding.quantity > 0 && holding.state === "in_cellar",
  );
  const wines = new Map((await db.getAll("wines")).map((wine) => [wine.id, wine]));
  const dish = tokenize(criteria.dish);
  const mood = tokenize(criteria.mood);
  const strict = criteria.strict_text_match === true;
  const results = [];

  for (const holding of holdings) {
    const wine = wines.get(holding.wine_id);
    if (!wine) continue;
    if (criteria.cellar_id && holding.cellar_id !== criteria.cellar_id) continue;
    if (criteria.color && wine.color !== criteria.color) continue;
    if (criteria.vintage != null && wine.vintage !== criteria.vintage) continue;
    if (criteria.vintage_before != null && (wine.vintage == null || wine.vintage > criteria.vintage_before)) continue;
    if (criteria.vintage_after != null && (wine.vintage == null || wine.vintage < criteria.vintage_after)) continue;
    if (
      criteria.appellation &&
      !(wine.appellation || "").toLowerCase().includes(criteria.appellation.toLowerCase())
    ) continue;

    const dishMatches = intersectionSize(dish, tokenize(wine.advice_pairing));
    const moodMatches = intersectionSize(
      mood,
      tokenize(`${wine.advice_experience || ""} ${wine.notes || ""}`),
    );
    if (strict && dish.size && !dishMatches) continue;
    if (strict && mood.size && !moodMatches) continue;
    const reasons = [];
    if (dishMatches) reasons.push("matches dish advice");
    if (moodMatches) reasons.push("matches occasion advice");
    if (!reasons.length) reasons.push("matches your filters");
    results.push({
      wine,
      holding,
      quantity: holding.quantity,
      score: dishMatches * 3 + moodMatches * 2,
      reasons,
    });
  }
  results.sort((left, right) => right.score - left.score || left.wine.producer.localeCompare(right.wine.producer));
  return results.slice(0, criteria.limit || 20);
}

function emptyBreakdown() {
  return { counts: {}, percentages: {} };
}

function addCount(target, key, quantity) {
  const label = key === null || key === undefined || key === "" ? "Unknown" : String(key);
  target[label] = (target[label] || 0) + quantity;
}

function finalizeBreakdown(counts, total) {
  const percentages = {};
  for (const [key, value] of Object.entries(counts)) {
    percentages[key] = total ? (value / total) * 100 : 0;
  }
  return { counts, percentages };
}

async function computeLocalStats(cellarId) {
  let holdings = (await db.getAll("holdings")).filter(
    (holding) => holding.quantity > 0 && holding.state === "in_cellar",
  );
  if (cellarId) holdings = holdings.filter((holding) => holding.cellar_id === cellarId);
  const wines = new Map((await db.getAll("wines")).map((wine) => [wine.id, wine]));
  const today = new Date().toISOString().slice(0, 10);
  const color = {}, vintage = {}, area = {}, appellation = {};
  const drinkWindow = { overdue: 0, ready_now: 0, not_ready_yet: 0, no_date_info: 0 };
  let total = 0, bought = 0, market = 0;
  const distinct = new Set();

  for (const holding of holdings) {
    const wine = wines.get(holding.wine_id);
    if (!wine) continue;
    const quantity = holding.quantity;
    total += quantity;
    distinct.add(wine.id);
    if (holding.price_bought != null) bought += holding.price_bought * quantity;
    if (wine.market_value != null) market += wine.market_value * quantity;
    addCount(color, wine.color, quantity);
    addCount(vintage, wine.vintage ?? "NV", quantity);
    addCount(area, wine.area, quantity);
    addCount(appellation, wine.appellation, quantity);
    if (!wine.drink_after && !wine.drink_before) drinkWindow.no_date_info += quantity;
    else if (wine.drink_before && wine.drink_before < today) drinkWindow.overdue += quantity;
    else if (wine.drink_after && wine.drink_after > today) drinkWindow.not_ready_yet += quantity;
    else drinkWindow.ready_now += quantity;
  }

  const overall = {
    total_bottles: total,
    distinct_wines: distinct.size,
    total_value_bought: bought,
    total_value_market: market,
    by_color: finalizeBreakdown(color, total),
    by_vintage: finalizeBreakdown(vintage, total),
    by_area: finalizeBreakdown(area, total),
    by_appellation: finalizeBreakdown(appellation, total),
    drink_window: drinkWindow,
  };
  return cellarId ? overall : { overall, per_cellar: {} };
}
