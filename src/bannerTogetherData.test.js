import { beforeEach, expect, test, vi } from "vitest";
import {
  BANNER_TOGETHER_MEMBERSHIP_CACHE_STORAGE_PREFIX,
  BANNER_TOGETHER_MEMBERSHIP_CACHE_TTL_MS,
  createBannerTogetherCatalogUrl,
  createBannerTogetherMembershipUrl,
  fetchBannerTogetherCatalog,
  fetchBannerTogetherMembership,
  loadBannerTogetherMembershipCache,
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

  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(onPage).toHaveBeenCalledTimes(2);
  expect(catalog).toHaveLength(101);
  expect(catalog.find((banner) => banner.id === "catalog-0")).toEqual({
    id: "catalog-0",
    title: "Updated Banner",
  });
  expect(catalog.some((banner) => Object.hasOwn(banner, "listType"))).toBe(false);
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
    const authorization = new Headers(options.headers).get("Authorization");
    expect(authorization).toBe("Bearer data-test-access-token");
    expect(parsedUrl.searchParams.getAll("listTypes")).toEqual([
      "todo",
      "done",
      "blacklist",
    ]);

    return parsedUrl.searchParams.get("offset") === "0"
      ? jsonResponse(firstPage)
      : jsonResponse([
          { id: "done-one", listType: "done" },
          { id: "hidden-one", listType: "blacklist" },
        ]);
  });

  const snapshot = await fetchBannerTogetherMembership("enschede-place", {
    onProgress,
  });

  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(onProgress).toHaveBeenNthCalledWith(1, 100);
  expect(onProgress).toHaveBeenNthCalledWith(2, 102);
  expect(snapshot.lists.todo).toHaveLength(100);
  expect(snapshot.lists.done).toEqual(["done-one"]);
  expect(snapshot.lists.blacklist).toEqual(["hidden-one"]);
  expect(new Date(snapshot.capturedAt).toISOString()).toBe(snapshot.capturedAt);
});

test("rejects memberships that appear in conflicting lists", async () => {
  authenticate();
  global.fetch.mockReturnValue(
    jsonResponse([
      { id: "changing-banner", listType: "todo" },
      { id: "changing-banner", listType: "done" },
    ])
  );

  await expect(
    fetchBannerTogetherMembership("enschede-place")
  ).rejects.toThrow(/overlapping private list memberships/i);
});

test("accepts exactly 10,000 memberships after checking the next page", async () => {
  authenticate();
  global.fetch.mockImplementation((url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));

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
  expect(global.fetch).toHaveBeenCalledTimes(101);
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
