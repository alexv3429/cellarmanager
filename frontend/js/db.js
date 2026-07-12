/**
 * Thin promisified wrapper around IndexedDB, used for two things:
 *  1. Caching server data (wines/cellars/holdings) so the app has something
 *     to show when opened offline.
 *  2. Queuing mutations (add/move/remove/create) made while offline, so they
 *     can be replayed once the connection comes back (see api.js `syncOutbox`).
 *
 * IndexedDB (not localStorage) is used deliberately: it handles structured,
 * larger data properly and works well for an offline-first PWA.
 */
const DB_NAME = "winecellar";
const DB_VERSION = 1;
const STORES = ["meta", "wines", "cellars", "holdings", "outbox"];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("wines")) db.createObjectStore("wines", { keyPath: "id" });
      if (!db.objectStoreNames.contains("cellars")) db.createObjectStore("cellars", { keyPath: "id" });
      if (!db.objectStoreNames.contains("holdings")) db.createObjectStore("holdings", { keyPath: "id" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "clientOpId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getMeta(key) {
  const store = await tx("meta", "readonly");
  const result = await wrapRequest(store.get(key));
  return result ? result.value : null;
}

export async function setMeta(key, value) {
  const store = await tx("meta", "readwrite");
  await wrapRequest(store.put({ key, value }));
}

export async function putAll(storeName, records) {
  const store = await tx(storeName, "readwrite");
  for (const record of records) store.put(record);
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function getAll(storeName) {
  const store = await tx(storeName, "readonly");
  return wrapRequest(store.getAll());
}

export async function get(storeName, id) {
  const store = await tx(storeName, "readonly");
  return wrapRequest(store.get(id));
}

export async function remove(storeName, id) {
  const store = await tx(storeName, "readwrite");
  return wrapRequest(store.delete(id));
}

export async function enqueueOutboxEntry(entry) {
  const store = await tx("outbox", "readwrite");
  await wrapRequest(store.put(entry));
}

export async function listOutbox() {
  const all = await getAll("outbox");
  all.sort((a, b) => a.createdAt - b.createdAt);
  return all;
}

export async function removeFromOutbox(clientOpId) {
  await remove("outbox", clientOpId);
}
