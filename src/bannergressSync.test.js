import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  getBannergressAgentName,
  loadBannergressAuthData,
  requestBannergressAccessToken,
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
