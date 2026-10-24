import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("./bannergressSync", () => ({
  useBannergressAuth: () => ({ accessToken: "token" }),
  requestBannergressAccessToken: async () => "token",
}));

const { useBannerNote } = await import("./bannerNotes");

describe("useBannerNote", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads and saves the note with the login", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => ({
      ok: true,
      json: async () => ({ note: { text: options.body ? JSON.parse(options.body).text : "old", updatedAt: "2026-10-24T19:00:00.000Z" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBannerNote("b-1"));
    await waitFor(() => expect(result.current.text).toBe("old"));
    expect(fetchMock.mock.calls[0][0]).toBe("/_openbanners/passphrases/v1/notes/banners/b-1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
    await act(() => result.current.save("new"));
    expect(result.current.text).toBe("new");
  });
});
