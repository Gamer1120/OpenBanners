import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("./bannergressSync", () => ({
  useBannergressAuth: () => ({ accessToken: "token" }),
  requestBannergressAccessToken: async () => "token",
}));

const { useBannerReviews } = await import("./bannerReviews");

describe("useBannerReviews", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the summary with the login, saves stars + tags, deletes and suggests", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => ({
      ok: true,
      json: async () =>
        url.endsWith("/tag-suggestions")
          ? { suggestion: { id: 1, name: "Muddy paths", kind: "negative", pending: true } }
          : { bannerId: "b 1", count: options.method === "PUT" ? 1 : 0, average: null, tags: [], mine: options.method === "PUT" ? JSON.parse(options.body) : null },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBannerReviews("b 1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock.mock.calls[0][0]).toBe("/_openbanners/passphrases/v1/reviews/banners/b%201");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
    await act(() => result.current.save(4, ["scenic-route"]));
    const [, put] = fetchMock.mock.calls[1];
    expect(put.method).toBe("PUT");
    expect(JSON.parse(put.body)).toEqual({ stars: 4, tags: ["scenic-route"] });
    expect(result.current.data.count).toBe(1);
    await act(() => result.current.remove());
    expect(fetchMock.mock.calls[2][1].method).toBe("DELETE");
    await act(() => result.current.suggest("Muddy paths", "negative"));
    expect(fetchMock.mock.calls[3][0]).toBe("/_openbanners/passphrases/v1/reviews/tag-suggestions");
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ name: "Muddy paths", kind: "negative", bannerId: "b 1" });
    // Shown right away as your pending tag; saving can keep it.
    expect(result.current.data.minePending).toEqual([{ suggestionId: 1, name: "Muddy paths", kind: "negative" }]);
    await act(() => result.current.save(5, [], [1]));
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ stars: 5, tags: [], suggestions: [1] });
  });
});
