import { beforeEach, expect, test, vi } from "vitest";
import {
  BANNER_TOGETHER_CATALOG_CACHE_STORAGE_PREFIX,
  BANNER_TOGETHER_CATALOG_CACHE_TTL_MS,
  BANNER_TOGETHER_MEMBERSHIP_CACHE_STORAGE_PREFIX,
  BANNER_TOGETHER_MEMBERSHIP_CACHE_TTL_MS,
  BANNER_TOGETHER_PAGE_CONCURRENCY,
  createBannerTogetherCatalogUrl,
  createBannerTogetherMembershipUrl,
  fetchBannerTogetherCatalog,
  fetchBannerTogetherMembership,
  loadBannerTogetherCatalogCache,
  loadBannerTogetherMembershipCache,
  saveBannerTogetherCatalogCache,
  saveBannerTogetherMembershipCache,
} from "./bannerTogetherData";
import { saveBannergressAuthData } from "./bannergressSync";

function jsonResponse(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

function authenticate() {
  saveBannergressAuthData({
    accessToken: "data-test-access-token",
    refreshToken: "data-test-refresh-token",
    accessExpiresAt: Date.now() + 5 * 60 * 1000,
    refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    updatedAt: Date.now(),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = vi.fn();
});

test("builds bounded catalog and all-list membership requests", () => {
  const catalogUrl = createBannerTogetherCatalogUrl("enschede-place", 100);
  const membershipUrl = createBannerTogetherMembershipUrl(
    "enschede-place",
    200
  );

  expect(catalogUrl.searchParams.get("placeId")).toBe("enschede-place");
  expect(catalogUrl.searchParams.get("limit")).toBe("100");
  expect(catalogUrl.searchParams.get("offset")).toBe("100");
  expect(catalogUrl.searchParams.getAll("attributes")).toContain("title");
  expect(membershipUrl.searchParams.getAll("listTypes")).toEqual([
    "todo",
    "done",
    "blacklist",
  ]);
  expect(membershipUrl.searchParams.getAll("attributes")).toEqual([
    "id",
    "listType",
  ]);
  expect(membershipUrl.searchParams.get("offset")).toBe("200");
  expect(
    createBannerTogetherMembershipUrl("enschede-place", 300, "done")
      .searchParams.getAll("listTypes")
  ).toEqual(["done"]);
});

test("loads and de-duplicates every public catalog page incrementally", async () => {
  const firstPage = Array.from({ length: 100 }, (_value, index) => ({
    id: `catalog-${index}`,
    title: `Banner ${String(index).padStart(3, "0")}`,
    listType: "todo",
  }));
  const onPage = vi.fn();
  global.fetch.mockImplementation((url, options) => {
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const offset = Number(new URL(url).searchParams.get("offset"));

    return offset === 0
      ? jsonResponse(firstPage)
      : jsonResponse([
          { id: "catalog-0", title: "Updated Banner" },
          { id: "catalog-final", title: "Final Banner" },
        ]);
  });

  const catalog = await fetchBannerTogetherCatalog("enschede-place", {
    onPage,
    signal: new AbortController().signal,
  });

  expect(global.fetch).toHaveBeenCalledTimes(5);
  expect(
    global.fetch.mock.calls.map(([url]) =>
      Number(new URL(url).searchParams.get("offset"))
    )
  ).toEqual([0, 100, 200, 300, 400]);
  expect(onPage).toHaveBeenCalledTimes(2);
  expect(catalog).toHaveLength(101);
  expect(catalog.find((banner) => banner.id === "catalog-0")).toEqual({
    id: "catalog-0",
    title: "Updated Banner",
  });
  expect(catalog.some((banner) => Object.hasOwn(banner, "listType"))).toBe(false);
});

test("loads a large place catalog with four requests at a time", async () => {
  let activeRequests = 0;
  let maximumActiveRequests = 0;

  global.fetch.mockImplementation(async (url) => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 1));
    activeRequests -= 1;
    const offset = Number(new URL(url).searchParams.get("offset"));
    const page =
      offset < 3000
        ? Array.from({ length: 100 }, (_value, index) => ({
            id: `catalog-large-${offset + index}`,
            title: `Catalog banner ${offset + index}`,
          }))
        : [];

    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(page),
    };
  });

  const catalog = await fetchBannerTogetherCatalog("enschede-place");

  expect(catalog).toHaveLength(3000);
  expect(maximumActiveRequests).toBe(BANNER_TOGETHER_PAGE_CONCURRENCY);
  expect(global.fetch).toHaveBeenCalledTimes(33);
});

test("aborts stalled speculative catalog pages after a required page fails", async () => {
  const firstPage = Array.from({ length: 100 }, (_value, index) => ({
    id: `catalog-${index}`,
    title: `Banner ${index}`,
  }));
  const abortedOffsets = [];

  global.fetch.mockImplementation((url, options) => {
    const offset = Number(new URL(url).searchParams.get("offset"));

    if (offset === 0) {
      return jsonResponse(firstPage);
    }

    if (offset === 100) {
      return jsonResponse({ error: "failed" }, 503);
    }

    return new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => {
          abortedOffsets.push(offset);
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        },
        { once: true }
      );
    });
  });

  await expect(
    Promise.race([
      fetchBannerTogetherCatalog("enschede-place"),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("Catalog failure did not abort")), 500)
      ),
    ])
  ).rejects.toThrow(/could not load the place banner catalog/i);
  expect(abortedOffsets.sort((a, b) => a - b)).toEqual([200, 300, 400]);
});

test("loads todo, done, and hidden memberships as one atomic snapshot", async () => {
  authenticate();
  const firstPage = Array.from({ length: 100 }, (_value, index) => ({
    id: `todo-${index}`,
    listType: "todo",
  }));
  const onProgress = vi.fn();
  global.fetch.mockImplementation((url, options) => {
    const parsedUrl = new URL(url);
    const listType = parsedUrl.searchParams.get("listTypes");
    const offset = Number(parsedUrl.searchParams.get("offset"));
    const authorization = new Headers(options.headers).get("Authorization");
    expect(authorization).toBe("Bearer data-test-access-token");
    expect(parsedUrl.searchParams.getAll("listTypes")).toEqual([listType]);

    if (listType === "todo") {
      return offset === 0 ? jsonResponse(firstPage) : jsonResponse([]);
    }

    if (listType === "done") {
      return jsonResponse(offset === 0 ? [{ id: "done-one" }] : []);
    }

    return jsonResponse(
      offset === 0 ? [{ id: "hidden-one", listType: "hide" }] : []
    );
  });

  const snapshot = await fetchBannerTogetherMembership("enschede-place", {
    onProgress,
  });

  expect(global.fetch).toHaveBeenCalledTimes(7);
  const progressValues = onProgress.mock.calls.map(([value]) => value);
  expect(progressValues.at(-1)).toBe(102);
  expect(progressValues).toEqual([...progressValues].sort((a, b) => a - b));
  expect(snapshot.lists.todo).toHaveLength(100);
  expect(snapshot.lists.done).toEqual(["done-one"]);
  expect(snapshot.lists.blacklist).toEqual(["hidden-one"]);
  expect(new Date(snapshot.capturedAt).toISOString()).toBe(snapshot.capturedAt);
});

test("rejects memberships that appear in conflicting lists", async () => {
  authenticate();
  global.fetch.mockImplementation((url) => {
    const listType = new URL(url).searchParams.get("listTypes");
    return jsonResponse(
      listType === "blacklist" ? [] : [{ id: "changing-banner" }]
    );
  });

  await expect(
    fetchBannerTogetherMembership("enschede-place")
  ).rejects.toThrow(/overlapping private list memberships/i);
});

test("accepts exactly 10,000 memberships after checking the next page", async () => {
  authenticate();
  global.fetch.mockImplementation((url) => {
    const parsedUrl = new URL(url);
    const offset = Number(parsedUrl.searchParams.get("offset"));
    const listType = parsedUrl.searchParams.get("listTypes");

    if (listType !== "todo") {
      return jsonResponse([]);
    }

    if (offset === 10000) {
      return jsonResponse([]);
    }

    return jsonResponse(
      Array.from({ length: 100 }, (_value, index) => ({
        id: `todo-${offset + index}`,
        listType: "todo",
      }))
    );
  });

  const snapshot = await fetchBannerTogetherMembership("enschede-place");

  expect(snapshot.lists.todo).toHaveLength(10000);
  expect(global.fetch).toHaveBeenCalledTimes(103);
  expect(
    global.fetch.mock.calls.some(
      ([url]) => Number(new URL(url).searchParams.get("offset")) > 10000
    )
  ).toBe(false);
});

test("loads large private lists with four requests at a time", async () => {
  authenticate();
  let activeRequests = 0;
  let maximumActiveRequests = 0;

  global.fetch.mockImplementation(async (url) => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 1));
    activeRequests -= 1;
    const parsedUrl = new URL(url);
    const offset = Number(parsedUrl.searchParams.get("offset"));
    const listType = parsedUrl.searchParams.get("listTypes");
    const page =
      listType === "todo" && offset < 3000
        ? Array.from({ length: 100 }, (_value, index) => ({
            id: `large-${offset + index}`,
          }))
        : [];

    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(page),
    };
  });

  const snapshot = await fetchBannerTogetherMembership("enschede-place");

  expect(snapshot.lists.todo).toHaveLength(3000);
  expect(maximumActiveRequests).toBe(BANNER_TOGETHER_PAGE_CONCURRENCY);
  expect(global.fetch).toHaveBeenCalledTimes(35);
});

test("reuses an account-scoped membership cache for four hours", async () => {
  const capturedAt = new Date("2026-07-11T10:00:00.000Z").toISOString();
  const authData = {
    accessToken: "account-one-access-token",
    refreshToken: "account-one-refresh-token",
  };
  const snapshot = {
    capturedAt,
    lists: {
      todo: ["todo-one"],
      done: ["done-one"],
      blacklist: ["hidden-one"],
    },
  };

  await expect(
    saveBannerTogetherMembershipCache("enschede-place", snapshot, {
      authData,
      now: new Date(capturedAt).getTime(),
    })
  ).resolves.toEqual(snapshot);

  await expect(
    loadBannerTogetherMembershipCache("enschede-place", {
      authData,
      now:
        new Date(capturedAt).getTime() +
        BANNER_TOGETHER_MEMBERSHIP_CACHE_TTL_MS -
        1,
    })
  ).resolves.toEqual(snapshot);
  const cacheKeys = [...Array(window.localStorage.length)].map(
    (_value, index) => window.localStorage.key(index)
  );
  expect(cacheKeys).toEqual([
    expect.stringMatching(
      new RegExp(`^${BANNER_TOGETHER_MEMBERSHIP_CACHE_STORAGE_PREFIX}`)
    ),
  ]);
  expect(
    cacheKeys.map((key) => window.localStorage.getItem(key)).join("")
  ).not.toContain("account-one-refresh-token");
});

test("reuses a place-scoped catalog cache for four hours", () => {
  const now = new Date("2026-07-11T10:00:00.000Z").getTime();
  const banners = [
    {
      id: "catalog-one",
      title: "Cached catalog banner",
      picture: "https://example.com/banner.jpg",
      numberOfMissions: 6,
    },
  ];
  const savedCatalog = saveBannerTogetherCatalogCache(
    "enschede-place",
    banners,
    { now }
  );

  expect(savedCatalog).toEqual({
    capturedAt: new Date(now).toISOString(),
    banners,
  });
  expect(
    loadBannerTogetherCatalogCache("enschede-place", {
      now: now + BANNER_TOGETHER_CATALOG_CACHE_TTL_MS - 1,
    })
  ).toEqual(savedCatalog);
  expect(
    loadBannerTogetherCatalogCache("different-place", { now: now + 1000 })
  ).toBeNull();
  expect(
    [...Array(window.localStorage.length)].map((_value, index) =>
      window.localStorage.key(index)
    )
  ).toEqual([
    expect.stringMatching(
      new RegExp(`^${BANNER_TOGETHER_CATALOG_CACHE_STORAGE_PREFIX}`)
    ),
  ]);
});

test("expires catalog caches and ignores retired membership caches", async () => {
  const now = new Date("2026-07-11T10:00:00.000Z").getTime();
  saveBannerTogetherCatalogCache(
    "enschede-place",
    [{ id: "catalog-one", title: "Catalog banner" }],
    { now }
  );

  expect(
    loadBannerTogetherCatalogCache("enschede-place", {
      now: now + BANNER_TOGETHER_CATALOG_CACHE_TTL_MS,
    })
  ).toBeNull();

  const authData = { refreshToken: "account-one-refresh-token" };
  window.localStorage.setItem(
    "openbanners-banner-together-membership-v1:retired-cache",
    JSON.stringify({
      version: 1,
      placeId: "enschede-place",
      capturedAt: new Date(now).toISOString(),
      lists: { todo: [], done: [], blacklist: [] },
    })
  );

  await expect(
    loadBannerTogetherMembershipCache("enschede-place", { authData, now })
  ).resolves.toBeNull();
});

test("evicts an older place catalog and retired cache when storage is full", () => {
  const now = new Date("2026-07-11T10:00:00.000Z").getTime();
  saveBannerTogetherCatalogCache(
    "older-place",
    [{ id: "old-banner", title: "Old banner" }],
    { now: now - 60 * 60 * 1000 }
  );
  window.localStorage.setItem(
    "openbanners-banner-together-membership-v1:retired",
    "retired"
  );
  const olderKey = [...Array(window.localStorage.length)]
    .map((_value, index) => window.localStorage.key(index))
    .find((key) => key.includes("older-place"));
  const originalSetItem = Storage.prototype.setItem;
  const setItemSpy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function setItem(storageKey, storedValue) {
      if (
        storageKey.includes("newer-place") &&
        this.getItem(olderKey) !== null
      ) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }

      return originalSetItem.call(this, storageKey, storedValue);
    });

  try {
    expect(
      saveBannerTogetherCatalogCache(
        "newer-place",
        [{ id: "new-banner", title: "New banner" }],
        { now }
      )
    ).toMatchObject({ banners: [{ id: "new-banner", title: "New banner" }] });
  } finally {
    setItemSpy.mockRestore();
  }

  expect(window.localStorage.getItem(olderKey)).toBeNull();
  expect(
    window.localStorage.getItem(
      "openbanners-banner-together-membership-v1:retired"
    )
  ).toBeNull();
  expect(
    loadBannerTogetherCatalogCache("newer-place", { now })
  ).toMatchObject({ banners: [{ id: "new-banner", title: "New banner" }] });
});

test("protects the active catalog while making room for membership data", async () => {
  const now = new Date("2026-07-11T10:00:00.000Z").getTime();
  saveBannerTogetherCatalogCache(
    "older-place",
    [{ id: "old-banner", title: "Old banner" }],
    { now: now - 60 * 60 * 1000 }
  );
  saveBannerTogetherCatalogCache(
    "active-place",
    [{ id: "active-banner", title: "Active banner" }],
    { now }
  );
  const catalogKeys = [...Array(window.localStorage.length)].map(
    (_value, index) => window.localStorage.key(index)
  );
  const activeKey = catalogKeys.find((key) => key.includes("active-place"));
  const olderKey = catalogKeys.find((key) => key.includes("older-place"));
  const originalSetItem = Storage.prototype.setItem;
  const setItemSpy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function setItem(storageKey, storedValue) {
      if (
        storageKey.startsWith(
          BANNER_TOGETHER_MEMBERSHIP_CACHE_STORAGE_PREFIX
        ) &&
        this.getItem(olderKey) !== null
      ) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }

      return originalSetItem.call(this, storageKey, storedValue);
    });
  const capturedAt = new Date(now).toISOString();

  try {
    await expect(
      saveBannerTogetherMembershipCache(
        "active-place",
        {
          capturedAt,
          lists: { todo: ["active-banner"], done: [], blacklist: [] },
        },
        { authData: { refreshToken: "active-account" }, now }
      )
    ).resolves.toMatchObject({ capturedAt });
  } finally {
    setItemSpy.mockRestore();
  }

  expect(window.localStorage.getItem(activeKey)).not.toBeNull();
  expect(window.localStorage.getItem(olderKey)).toBeNull();
});

test("prunes expired v2 membership entries during cache writes", () => {
  const now = new Date("2026-07-11T10:00:00.000Z").getTime();
  const expiredKey = `${BANNER_TOGETHER_MEMBERSHIP_CACHE_STORAGE_PREFIX}expired`;
  window.localStorage.setItem(
    expiredKey,
    JSON.stringify({
      version: 2,
      capturedAt: new Date(
        now - BANNER_TOGETHER_MEMBERSHIP_CACHE_TTL_MS
      ).toISOString(),
    })
  );

  saveBannerTogetherCatalogCache(
    "active-place",
    [{ id: "active-banner", title: "Active banner" }],
    { now }
  );

  expect(window.localStorage.getItem(expiredKey)).toBeNull();
});

test("does not reuse membership cache across accounts or after four hours", async () => {
  const capturedAt = "2026-07-11T10:00:00.000Z";
  const accountOne = { refreshToken: "account-one-refresh-token" };
  const snapshot = {
    capturedAt,
    lists: { todo: ["private-banner"], done: [], blacklist: [] },
  };

  await saveBannerTogetherMembershipCache("enschede-place", snapshot, {
    authData: accountOne,
    now: new Date(capturedAt).getTime(),
  });

  await expect(
    loadBannerTogetherMembershipCache("enschede-place", {
      authData: { refreshToken: "account-two-refresh-token" },
      now: new Date(capturedAt).getTime() + 60 * 1000,
    })
  ).resolves.toBeNull();
  await expect(
    loadBannerTogetherMembershipCache("enschede-place", {
      authData: accountOne,
      now:
        new Date(capturedAt).getTime() +
        BANNER_TOGETHER_MEMBERSHIP_CACHE_TTL_MS,
    })
  ).resolves.toBeNull();
  expect(window.localStorage.length).toBe(0);
});

test("rejects malformed cached memberships without exposing stale data", async () => {
  const capturedAt = "2026-07-11T10:00:00.000Z";
  const authData = { refreshToken: "account-one-refresh-token" };

  await expect(
    saveBannerTogetherMembershipCache(
      "enschede-place",
      {
        capturedAt,
        lists: {
          todo: ["same-banner"],
          done: ["same-banner"],
          blacklist: [],
        },
      },
      { authData, now: new Date(capturedAt).getTime() }
    )
  ).rejects.toThrow(/more than one list/i);
});
