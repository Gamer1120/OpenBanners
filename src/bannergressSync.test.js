import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  BANNERGRESS_AGENT_STORAGE_KEY,
  clearBannergressAuthData,
  getBannergressAccountId,
  getBannergressAgentName,
  getBannergressDisplayName,
  readBannergressUserAgentName,
  fetchBannergressUserAgentName,
  refreshBannergressAgentName,
  loadBannergressAuthData,
  requestBannergressAccessToken,
  requestBannergressSyncData,
  saveBannergressAuthData,
} from "./bannergressSync";

function createJwt(payload) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const encodedPayload = window
    .btoa(String.fromCharCode(...payloadBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `header.${encodedPayload}.signature`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function saveExpiredAccessToken(refreshToken = "refresh-token") {
  saveBannergressAuthData({
    accessToken: "expired-access-token",
    refreshToken,
    accessExpiresAt: Date.now() - 1000,
    refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    updatedAt: Date.now() - 2000,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("shares one refresh request across concurrent access-token callers", async () => {
  saveExpiredAccessToken();
  const response = deferred();
  global.fetch.mockReturnValue(response.promise);

  const firstToken = requestBannergressAccessToken();
  const secondToken = requestBannergressAccessToken();

  await vi.waitFor(() => {
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  response.resolve({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        access_token: "refreshed-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 300,
        refresh_expires_in: 1800,
      }),
  });

  await expect(Promise.all([firstToken, secondToken])).resolves.toEqual([
    "refreshed-access-token",
    "refreshed-access-token",
  ]);
  expect(loadBannergressAuthData().refreshToken).toBe("rotated-refresh-token");
});

test("does not clear newer credentials when an older refresh fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  saveExpiredAccessToken("old-refresh-token");
  const response = deferred();
  global.fetch.mockReturnValue(response.promise);

  const tokenRequest = requestBannergressAccessToken();

  await vi.waitFor(() => {
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  saveBannergressAuthData({
    accessToken: "new-access-token",
    refreshToken: "new-refresh-token",
    accessExpiresAt: Date.now() + 5 * 60 * 1000,
    refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    updatedAt: Date.now(),
  });
  response.resolve({
    ok: false,
    status: 400,
    json: () => Promise.resolve({ error: "invalid_grant" }),
  });

  await expect(tokenRequest).resolves.toBe("new-access-token");
  expect(loadBannergressAuthData()).toMatchObject({
    accessToken: "new-access-token",
    refreshToken: "new-refresh-token",
  });
});

test("reads the Bannergress agent name from local token claims", () => {
  expect(
    getBannergressAgentName({
      idToken: createJwt({ preferred_username: "AgéntOne" }),
      accessToken: createJwt({ preferred_username: "AccessFallback" }),
    })
  ).toBe("AgéntOne");
  expect(
    getBannergressAgentName({
      idToken: "malformed",
      accessToken: createJwt({ preferred_username: "AccessFallback" }),
    })
  ).toBe("AccessFallback");
  expect(
    getBannergressAgentName({
      idToken: createJwt({ preferred_username: "Bad\u202eName" }),
    })
  ).toBeNull();
  expect(
    getBannergressAgentName({
      idToken: createJwt({ preferred_username: "A".repeat(65) }),
    })
  ).toBeNull();
});

test("reads the agent name from a Bannergress /user response", () => {
  expect(readBannergressUserAgentName({ agent: { name: " Gamer1120 ", faction: "enlightened" } })).toBe("Gamer1120");
  expect(readBannergressUserAgentName({ agent: null, verificationAgent: null })).toBeNull();
  expect(readBannergressUserAgentName({})).toBeNull();
  expect(readBannergressUserAgentName(null)).toBeNull();
  expect(readBannergressUserAgentName({ agent: { name: "" } })).toBeNull();
  expect(readBannergressUserAgentName({ agent: { name: "Bad\u202eName" } })).toBeNull();
  expect(readBannergressUserAgentName({ agent: { name: 42 } })).toBeNull();
});

test("identifies the account by issuer and subject", () => {
  expect(
    getBannergressAccountId({
      idToken: createJwt({ iss: "https://login.example", sub: "user-1" }),
    })
  ).toBe("https://login.example:user-1");
  expect(
    getBannergressAccountId({
      idToken: "malformed",
      accessToken: createJwt({ iss: "https://login.example", sub: "user-2" }),
    })
  ).toBe("https://login.example:user-2");
  expect(getBannergressAccountId({ accessToken: "opaque" })).toBeNull();
});

function saveSignedInAccount(sub = "user-1", claims = {}) {
  saveBannergressAuthData({
    accessToken: createJwt({ iss: "https://login.example", sub, ...claims }),
    refreshToken: "refresh-token",
    accessExpiresAt: Date.now() + 5 * 60 * 1000,
    refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    updatedAt: Date.now(),
  });
}

function userResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

test("fetches the agent name from Bannergress /user and caches it per account", async () => {
  saveSignedInAccount("user-1");
  global.fetch.mockReturnValue(userResponse({ agent: { name: "Gamer1120", faction: "enlightened" } }));

  await expect(refreshBannergressAgentName()).resolves.toBe("Gamer1120");
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe("https://api.bannergress.com/user");
  expect(new Headers(options.headers).get("Authorization")).toMatch(/^Bearer /);
  expect(getBannergressDisplayName()).toBe("Gamer1120");

  // Fresh cache: no second request.
  await expect(refreshBannergressAgentName()).resolves.toBe("Gamer1120");
  expect(global.fetch).toHaveBeenCalledTimes(1);

  // Another account on the same browser never sees the cached name.
  saveSignedInAccount("user-2");
  expect(getBannergressDisplayName()).toBeNull();

  clearBannergressAuthData();
  expect(window.localStorage.getItem(BANNERGRESS_AGENT_STORAGE_KEY)).toBeNull();
});

test("falls back to a token username, then to no name, without an agent", async () => {
  saveSignedInAccount("user-1", { preferred_username: "TokenName" });
  global.fetch.mockReturnValue(userResponse({ agent: null }));
  await expect(refreshBannergressAgentName()).resolves.toBe("TokenName");

  window.localStorage.clear();
  saveSignedInAccount("user-1");
  global.fetch.mockReturnValue(userResponse({ agent: null }));
  await expect(refreshBannergressAgentName()).resolves.toBeNull();
  expect(getBannergressDisplayName()).toBeNull();
});

test("keeps no cached name when /user fails or the request errors", async () => {
  saveSignedInAccount("user-1");
  global.fetch.mockReturnValue(userResponse({}, 401));
  await expect(refreshBannergressAgentName()).resolves.toBeNull();
  expect(window.localStorage.getItem(BANNERGRESS_AGENT_STORAGE_KEY)).toBeNull();

  global.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(refreshBannergressAgentName()).resolves.toBeNull();
  expect(window.localStorage.getItem(BANNERGRESS_AGENT_STORAGE_KEY)).toBeNull();

  // Signed out: nothing is requested.
  window.localStorage.clear();
  clearBannergressAuthData();
  global.fetch.mockClear();
  await expect(refreshBannergressAgentName()).resolves.toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});

function saveFreshAccessToken() {
  saveBannergressAuthData({
    accessToken: "fresh-access-token",
    refreshToken: "refresh-token",
    accessExpiresAt: Date.now() + 10 * 60 * 1000,
    refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    updatedAt: Date.now(),
  });
}

function jsonResponse(data, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(data),
  });
}

function page(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }));
}

test("list sync counts every list and pages with offset", async () => {
  saveFreshAccessToken();
  global.fetch.mockImplementation((input) => {
    const url = new URL(String(input));
    const listType = url.searchParams.get("listTypes");
    const offset = Number(url.searchParams.get("offset"));

    if (listType === "todo") {
      return jsonResponse(offset === 0 ? page("todo-a", 100) : page("todo-b", 3));
    }

    return jsonResponse(listType === "done" ? page("done", 2) : []);
  });

  const result = await requestBannergressSyncData();
  const values = Object.values(result.bannerLists);

  expect(values.filter((value) => value === "todo")).toHaveLength(103);
  expect(values.filter((value) => value === "done")).toHaveLength(2);
  expect(global.fetch).toHaveBeenCalledTimes(4);
});

test("list sync stops when Bannergress ignores the offset", async () => {
  saveFreshAccessToken();
  global.fetch.mockImplementation((input) => {
    const listType = new URL(String(input)).searchParams.get("listTypes");
    return jsonResponse(listType === "todo" ? page("same", 100) : []);
  });

  const result = await requestBannergressSyncData();

  expect(Object.keys(result.bannerLists)).toHaveLength(100);
  // todo: page 1 + the repeated page 2, then done + hidden.
  expect(global.fetch).toHaveBeenCalledTimes(4);
});

test("list sync stops after the page limit", async () => {
  saveFreshAccessToken();
  let call = 0;
  global.fetch.mockImplementation(() => {
    call += 1;
    return jsonResponse(page(`p${call}`, 100));
  });

  await requestBannergressSyncData({ maxPages: 3 });

  expect(global.fetch).toHaveBeenCalledTimes(9);
});

test("list sync retries a rejected page once without attributes, then fails", async () => {
  saveFreshAccessToken();
  global.fetch.mockImplementation(() => jsonResponse(null, 400));

  await expect(requestBannergressSyncData()).rejects.toMatchObject({
    code: "REQUEST_FAILED",
    status: 400,
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(String(global.fetch.mock.calls[0][0])).toContain("attributes=id");
  expect(String(global.fetch.mock.calls[1][0])).not.toContain("attributes");
});

test("list sync fails at once on server errors and 429", async () => {
  for (const status of [500, 503, 429]) {
    saveFreshAccessToken();
    global.fetch.mockReset();
    global.fetch.mockImplementation(() => jsonResponse(null, status));

    await expect(requestBannergressSyncData()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      status,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  }
});

test("list sync reports 401 as AUTH_REQUIRED", async () => {
  saveFreshAccessToken();
  global.fetch.mockImplementation(() => jsonResponse(null, 401));

  await expect(requestBannergressSyncData()).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
    status: 401,
  });
  expect(loadBannergressAuthData().accessToken).toBeNull();
});

test("list sync times out a request that never answers and aborts it", async () => {
  saveFreshAccessToken();
  let signal = null;
  global.fetch.mockImplementation((input, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });

  await expect(requestBannergressSyncData({ timeoutMs: 30 })).rejects.toMatchObject({
    code: "TIMEOUT",
  });
  expect(signal?.aborted).toBe(true);
});

test("list sync times out a stuck token refresh and frees the refresh lock", async () => {
  vi.useFakeTimers();

  try {
    saveExpiredAccessToken();
    global.fetch.mockImplementation(() => new Promise(() => {}));

    const sync = requestBannergressSyncData();
    const assertion = expect(sync).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15 * 1000 + 10);
    await assertion;

    global.fetch.mockReset();
    global.fetch.mockImplementation(() =>
      jsonResponse({ access_token: "new-token", expires_in: 300 })
    );

    const nextToken = requestBannergressAccessToken();
    await vi.advanceTimersByTimeAsync(0);
    await expect(nextToken).resolves.toBe("new-token");
  } finally {
    vi.useRealTimers();
  }
});

test("the shared /user request reports sign-in problems and caches the agent", async () => {
  saveSignedInAccount("user-1");
  global.fetch.mockReturnValue(userResponse({}, 403));
  await expect(fetchBannergressUserAgentName()).rejects.toMatchObject({ code: "AUTH" });
  expect(window.localStorage.getItem(BANNERGRESS_AGENT_STORAGE_KEY)).toBeNull();

  global.fetch.mockReturnValue(userResponse({ agent: { name: "ListsAgent" } }));
  await expect(fetchBannergressUserAgentName()).resolves.toBe("ListsAgent");
  // The top bar and Banner Together read the same cached name.
  expect(getBannergressDisplayName()).toBe("ListsAgent");
  global.fetch.mockClear();
  await expect(refreshBannergressAgentName()).resolves.toBe("ListsAgent");
  expect(global.fetch).not.toHaveBeenCalled();

  global.fetch.mockReturnValue(userResponse({ agent: null }));
  await expect(fetchBannergressUserAgentName()).resolves.toBeNull();
});
