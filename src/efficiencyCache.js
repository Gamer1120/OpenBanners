// Efficiency sort fetches every banner of a place (or up to 1,000 search
// results) before it can sort them. That set is kept in IndexedDB for an hour,
// so a reload, the other sort direction or a filter that is applied in the
// browser doesn't fetch it all again. A place like the Netherlands is ~1.7 MB
// of banners, too much for localStorage. Any storage problem just means no
// cache.

export const EFFICIENCY_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
// At most this many lists are kept; older ones are removed on every write.
export const EFFICIENCY_CACHE_MAX_ENTRIES = 8;
const EFFICIENCY_CACHE_VERSION = 1;
const DB_NAME = "openbanners-efficiency-cache";
const STORE_NAME = "lists";
// A blocked or very slow IndexedDB must not keep Efficiency waiting.
const READ_TIMEOUT_MS = 3000;

// Everything that changes which banners Bannergress returns: the list
// (place, agent, search), offline banners and, when hidden banners are left
// out, the signed-in account (its hidden banners). Sort direction, done and
// mission-count filters are applied in the browser and share the same set.
export function getEfficiencyCacheKey({
  placeId,
  authorName,
  query,
  showOfflineBanners,
  showHiddenBanners,
  accountId,
}) {
  return JSON.stringify([
    EFFICIENCY_CACHE_VERSION,
    placeId ?? "",
    authorName ?? "",
    typeof query === "string" ? query.trim() : "",
    showOfflineBanners ? "offline" : "online-only",
    showHiddenBanners ? "show-hidden" : `hide-hidden:${accountId ?? ""}`,
  ]);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createIndexedDbBackend() {
  let dbPromise = null;

  const openDb = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined" || !indexedDB) {
          reject(new Error("IndexedDB is not available"));
          return;
        }

        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("savedAt", "savedAt");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB open blocked"));
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }

    return dbPromise;
  };

  const withStore = async (mode, run) => {
    const db = await openDb();
    const transaction = db.transaction(STORE_NAME, mode);
    const done = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const result = await run(transaction.objectStore(STORE_NAME));
    await done;
    return result;
  };

  return {
    get: (key) => withStore("readonly", (store) => requestToPromise(store.get(key))),
    put: (entry) => withStore("readwrite", (store) => requestToPromise(store.put(entry))),
    delete: (key) => withStore("readwrite", (store) => requestToPromise(store.delete(key))),
    // Keys and ages only, without loading the banners.
    list: () =>
      withStore(
        "readonly",
        (store) =>
          new Promise((resolve, reject) => {
            const entries = [];
            const request = store.index("savedAt").openKeyCursor();
            request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) {
                resolve(entries);
                return;
              }
              entries.push({ key: cursor.primaryKey, savedAt: cursor.key });
              cursor.continue();
            };
            request.onerror = () => reject(request.error);
          })
      ),
  };
}

// For tests: the same interface, kept in memory.
export function createMemoryEfficiencyCacheBackend() {
  const entries = new Map();

  return {
    entries,
    get: async (key) => entries.get(key),
    put: async (entry) => {
      entries.set(entry.key, entry);
    },
    delete: async (key) => {
      entries.delete(key);
    },
    list: async () =>
      [...entries.values()].map(({ key, savedAt }) => ({ key, savedAt })),
  };
}

let backend = null;

function getBackend() {
  if (!backend) {
    backend = createIndexedDbBackend();
  }

  return backend;
}

export function setEfficiencyCacheBackend(nextBackend) {
  backend = nextBackend;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function isFresh(savedAt, now) {
  return (
    Number.isFinite(savedAt) &&
    savedAt <= now + 60 * 1000 &&
    now - savedAt < EFFICIENCY_CACHE_MAX_AGE_MS
  );
}

// { banners, savedAt } when there is a fresh set for this key, else null.
export async function readEfficiencyCache(key, now = Date.now()) {
  try {
    const entry = await withTimeout(getBackend().get(key), READ_TIMEOUT_MS);

    if (!entry || !Array.isArray(entry.banners)) {
      return null;
    }

    if (!isFresh(entry.savedAt, now)) {
      getBackend().delete(key).catch(() => {});
      return null;
    }

    return { banners: entry.banners, savedAt: entry.savedAt };
  } catch {
    return null;
  }
}

async function evictEfficiencyCache(now) {
  const entries = (await getBackend().list()).sort((a, b) => b.savedAt - a.savedAt);
  const stale = entries.filter(
    (entry, index) =>
      index >= EFFICIENCY_CACHE_MAX_ENTRIES || !isFresh(entry.savedAt, now)
  );

  await Promise.all(stale.map((entry) => getBackend().delete(entry.key)));
}

// Stores the set; returns its time, or null when it couldn't be stored.
export async function writeEfficiencyCache(key, banners, now = Date.now()) {
  try {
    await getBackend().put({ key, savedAt: now, banners });
  } catch {
    return null;
  }

  try {
    await evictEfficiencyCache(now);
  } catch {
    // Cleaning up can wait for the next write.
  }

  return now;
}

export async function deleteEfficiencyCache(key) {
  try {
    await getBackend().delete(key);
  } catch {
    // Nothing cached, or no storage.
  }
}
