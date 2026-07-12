/** IndexedDB storage for offline reads, ordered mutations and conflicts. */
const DB_NAME = "winecellar";
const DB_VERSION = 3;
const STORES = [
  "meta",
  "wines",
  "cellars",
  "holdings",
  "outbox",
  "responses",
  "conflicts",
  "deadletter",
];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of STORES) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, {
            keyPath:
              name === "meta"
                ? "key"
                : name === "outbox"
                  ? "clientOpId"
                  : name === "responses"
                    ? "path"
                    : name === "conflicts" || name === "deadletter"
                      ? "clientOpId"
                      : "id",
          });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, callback) {
  const database = await openDb();
  const transaction = database.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const result = callback(store);
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
  return result;
}

export async function getMeta(key) {
  const database = await openDb();
  const transaction = database.transaction("meta", "readonly");
  const result = await wrapRequest(transaction.objectStore("meta").get(key));
  return result ? result.value : null;
}

export async function setMeta(key, value) {
  return withStore("meta", "readwrite", (store) => store.put({ key, value }));
}

export async function put(storeName, record) {
  return withStore(storeName, "readwrite", (store) => store.put(record));
}

export async function putAll(storeName, records) {
  return withStore(storeName, "readwrite", (store) => {
    for (const record of records) store.put(record);
  });
}

export async function replaceAll(storeName, records) {
  return withStore(storeName, "readwrite", (store) => {
    store.clear();
    for (const record of records) store.put(record);
  });
}

export async function getAll(storeName) {
  const database = await openDb();
  const transaction = database.transaction(storeName, "readonly");
  return wrapRequest(transaction.objectStore(storeName).getAll());
}

export async function get(storeName, id) {
  const database = await openDb();
  const transaction = database.transaction(storeName, "readonly");
  return wrapRequest(transaction.objectStore(storeName).get(id));
}

export async function remove(storeName, id) {
  return withStore(storeName, "readwrite", (store) => store.delete(id));
}

export async function cacheResponse(path, value) {
  await put("responses", { path, value, cachedAt: Date.now() });
}

export async function getCachedResponse(path) {
  const record = await get("responses", path);
  return record ? record.value : null;
}

export async function enqueueOutboxEntry(entry) {
  await put("outbox", entry);
}

export async function listOutbox() {
  const all = await getAll("outbox");
  all.sort((left, right) => left.createdAt - right.createdAt);
  return all;
}

export async function removeFromOutbox(clientOpId) {
  await remove("outbox", clientOpId);
}

/**
 * Replace references to an optimistic temporary holding with the real server ID.
 * Later queued operations may depend on a holding created by an earlier offline
 * add or move, so this remapping must happen before replay continues.
 */
export async function remapOutboxHoldingId(temporaryId, serverId) {
  if (!temporaryId || !serverId || temporaryId === serverId) return;
  const entries = await listOutbox();
  await withStore("outbox", "readwrite", (store) => {
    for (const entry of entries) {
      if (entry.payload?.holding_id !== temporaryId) continue;
      store.put({
        ...entry,
        payload: { ...entry.payload, holding_id: serverId },
      });
    }
  });
}

export async function saveConflict(entry, detail) {
  await put("conflicts", {
    ...entry,
    conflictDetail: detail,
    conflictedAt: Date.now(),
  });
}

export async function listConflicts() {
  const all = await getAll("conflicts");
  all.sort((left, right) => left.createdAt - right.createdAt);
  return all;
}

export async function removeConflict(clientOpId) {
  await remove("conflicts", clientOpId);
}

export async function saveDeadLetter(entry, detail) {
  await put("deadletter", {
    ...entry,
    failureDetail: detail,
    failedAt: Date.now(),
  });
}

export async function listDeadLetters() {
  const all = await getAll("deadletter");
  all.sort((left, right) => left.createdAt - right.createdAt);
  return all;
}

export async function removeDeadLetter(clientOpId) {
  await remove("deadletter", clientOpId);
}
