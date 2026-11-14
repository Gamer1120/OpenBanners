import { beforeEach, expect, test } from "vitest";
import {
  createMemoryEfficiencyCacheBackend,
  deleteEfficiencyCache,
  EFFICIENCY_CACHE_MAX_AGE_MS,
  EFFICIENCY_CACHE_MAX_ENTRIES,
  getEfficiencyCacheKey,
  readEfficiencyCache,
  setEfficiencyCacheBackend,
  writeEfficiencyCache,
} from "./efficiencyCache";

let backend;
const NOW = 1_800_000_000_000;
const banners = [{ id: "a", numberOfMissions: 6, lengthMeters: 1000 }];

beforeEach(() => {
  backend = createMemoryEfficiencyCacheBackend();
  setEfficiencyCacheBackend(backend);
});

test("the key covers what Bannergress returns, not the sort direction or browser-side filters", () => {
  const base = { placeId: "nl", showOfflineBanners: false, showHiddenBanners: false, accountId: "iss:1" };
  const key = getEfficiencyCacheKey(base);

  expect(getEfficiencyCacheKey({ ...base })).toBe(key);
  expect(getEfficiencyCacheKey({ ...base, placeId: "be" })).not.toBe(key);
  expect(getEfficiencyCacheKey({ ...base, query: "amsterdam" })).not.toBe(key);
  expect(getEfficiencyCacheKey({ ...base, showOfflineBanners: true })).not.toBe(key);
  expect(getEfficiencyCacheKey({ ...base, showHiddenBanners: true })).not.toBe(key);
  expect(getEfficiencyCacheKey({ ...base, accountId: "iss:2" })).not.toBe(key);
  // With hidden banners shown the request isn't per account.
  expect(getEfficiencyCacheKey({ ...base, showHiddenBanners: true, accountId: "iss:2" })).toBe(
    getEfficiencyCacheKey({ ...base, showHiddenBanners: true })
  );
});

test("miss, hit, expiry and delete", async () => {
  expect(await readEfficiencyCache("k", NOW)).toBeNull();

  expect(await writeEfficiencyCache("k", banners, NOW)).toBe(NOW);
  expect(await readEfficiencyCache("k", NOW + 59 * 60 * 1000)).toEqual({ banners, savedAt: NOW });

  expect(await readEfficiencyCache("k", NOW + EFFICIENCY_CACHE_MAX_AGE_MS)).toBeNull();
  await Promise.resolve();
  expect(backend.entries.has("k")).toBe(false);

  await writeEfficiencyCache("k", banners, NOW);
  await deleteEfficiencyCache("k");
  expect(await readEfficiencyCache("k", NOW)).toBeNull();
});

test("writing removes expired entries and keeps only the newest few", async () => {
  await writeEfficiencyCache("old", banners, NOW - EFFICIENCY_CACHE_MAX_AGE_MS - 1);
  for (let index = 0; index < EFFICIENCY_CACHE_MAX_ENTRIES + 2; index += 1) {
    await writeEfficiencyCache(`k${index}`, banners, NOW + index);
  }

  expect(backend.entries.size).toBe(EFFICIENCY_CACHE_MAX_ENTRIES);
  expect(backend.entries.has("old")).toBe(false);
  expect(backend.entries.has("k0")).toBe(false);
  expect(backend.entries.has(`k${EFFICIENCY_CACHE_MAX_ENTRIES + 1}`)).toBe(true);
});

test("storage errors mean no cache, never an error", async () => {
  const failing = {
    get: () => Promise.reject(new Error("no storage")),
    put: () => Promise.reject(new DOMException("full", "QuotaExceededError")),
    delete: () => Promise.reject(new Error("no storage")),
    list: () => Promise.reject(new Error("no storage")),
  };
  setEfficiencyCacheBackend(failing);

  expect(await writeEfficiencyCache("k", banners, NOW)).toBeNull();
  expect(await readEfficiencyCache("k", NOW)).toBeNull();
  await expect(deleteEfficiencyCache("k")).resolves.toBeUndefined();
});

test("without IndexedDB (jsdom) the default store just misses", async () => {
  setEfficiencyCacheBackend(null);
  expect(await writeEfficiencyCache("k", banners, NOW)).toBeNull();
  expect(await readEfficiencyCache("k", NOW)).toBeNull();
});
