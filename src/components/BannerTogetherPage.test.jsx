import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import BannerTogetherPage, { LegacyBannerTogetherPage } from "./BannerTogetherPage";
import {
  BANNERGRESS_AUTH_STORAGE_KEY,
  loadBannergressAuthData,
  saveBannergressAuthData,
} from "../bannergressSync";
import {
  createBannerTogetherInviteHash,
  parseBannerTogetherInviteHash,
} from "../bannerTogether";

vi.mock("./BannerCard", () => ({
  default: ({ banner }) => <div>{banner.title}</div>,
}));

const theme = createTheme({
  palette: {
    mode: "dark",
  },
});
const TEST_CREATED_AT = new Date().toISOString();

function jsonResponse(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createBanner(id, title = id) {
  return {
    id,
    title,
    listType: "todo",
    numberOfMissions: 6,
    lengthMeters: 1800,
    numberOfDisabledMissions: 0,
  };
}

function authenticate() {
  saveBannergressAuthData({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    accessExpiresAt: Date.now() + 5 * 60 * 1000,
    refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    updatedAt: Date.now(),
  });
}

function renderPage(placeId = "enschede-place") {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter
        initialEntries={[`${window.location.pathname}${window.location.hash}`]}
      >
        <LegacyBannerTogetherPage placeId={placeId} />
      </MemoryRouter>
    </ThemeProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/together/enschede-place");
  global.fetch = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

test("creates a place-scoped snapshot after loading every to-do page", async () => {
  authenticate();
  const firstPage = Array.from({ length: 100 }, (_value, index) =>
    createBanner(`host-banner-${index + 1}`, `Host Banner ${index + 1}`)
  );
  const finalBanner = createBanner("host-banner-101", "Host Banner 101");

  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/enschede-place")) {
      return jsonResponse({
        id: "enschede-place",
        formattedAddress: "Enschede, Netherlands",
      });
    }

    if (url.includes("/bnrs?") && url.includes("offset=0")) {
      return jsonResponse(firstPage);
    }

    if (url.includes("/bnrs?") && url.includes("offset=100")) {
      return jsonResponse([finalBanner]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderPage();

  expect(await screen.findByText("Enschede, Netherlands")).toBeInTheDocument();
  expect(await screen.findByText("101 to do")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /show more/i })).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: /copy snapshot invite/i })
  );

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  const copiedUrl = navigator.clipboard.writeText.mock.calls[0][0];
  const parsedUrl = new URL(copiedUrl);
  const invite = await parseBannerTogetherInviteHash(parsedUrl.hash);

  expect(parsedUrl.pathname).toBe("/together/enschede-place");
  expect(invite.placeId).toBe("enschede-place");
  expect(invite.bannerIds).toHaveLength(101);
  expect(invite.bannerIds).toContain("host-banner-101");
  expect(copiedUrl).not.toContain("test-access-token");
  expect(copiedUrl).not.toContain("test-refresh-token");
  expect(
    screen.getByText(/complete to-do list for this place/i)
  ).toHaveTextContent(/cannot be revoked/i);
  expect(
    global.fetch.mock.calls.filter(([url]) => url.includes("/bnrs?"))
  ).toHaveLength(2);
});

test("shows only banners on both agents' to-do lists", async () => {
  authenticate();
  const inviteHash = await createBannerTogetherInviteHash({
    placeId: "enschede-place",
    bannerIds: ["shared-banner", "host-only-banner"],
    createdAt: TEST_CREATED_AT,
  });
  window.history.replaceState(
    {},
    "",
    `/together/enschede-place${inviteHash}`
  );

  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/enschede-place")) {
      return jsonResponse({
        id: "enschede-place",
        formattedAddress: "Enschede, Netherlands",
      });
    }

    if (url.includes("/bnrs?")) {
      return jsonResponse([
        createBanner("guest-only-banner", "Guest Only Banner"),
        createBanner("shared-banner", "Shared Banner"),
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderPage();

  expect(await screen.findByText("Shared Banner")).toBeInTheDocument();
  expect(screen.queryByText("Guest Only Banner")).not.toBeInTheDocument();
  expect(screen.getByText("2 in invite")).toBeInTheDocument();
  expect(screen.getByText("1 shared")).toBeInTheDocument();
  expect(screen.getByText(/^Snapshot /)).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Shared to-do banners" })
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /copy result link/i }));

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  const resultUrl = new URL(navigator.clipboard.writeText.mock.calls[0][0]);
  const resultInvite = await parseBannerTogetherInviteHash(resultUrl.hash);

  expect(resultInvite.bannerIds).toEqual(["shared-banner"]);
  expect(await screen.findByText("Shared result link copied.")).toBeInTheDocument();
});

test("shows an exact empty state when the two lists do not overlap", async () => {
  authenticate();
  const inviteHash = await createBannerTogetherInviteHash({
    placeId: "enschede-place",
    bannerIds: ["host-only-banner"],
    createdAt: TEST_CREATED_AT,
  });
  window.history.replaceState(
    {},
    "",
    `/together/enschede-place${inviteHash}`
  );

  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/enschede-place")) {
      return jsonResponse({ id: "enschede-place", formattedAddress: "Enschede" });
    }

    if (url.includes("/bnrs?")) {
      return jsonResponse([createBanner("guest-only-banner")]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderPage();

  expect(
    await screen.findByText(
      "You do not share any to-do banners in this place."
    )
  ).toBeInTheDocument();
  expect(screen.getByText("0 shared")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /copy result link/i }));

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  const resultUrl = new URL(navigator.clipboard.writeText.mock.calls[0][0]);
  await expect(parseBannerTogetherInviteHash(resultUrl.hash)).resolves.toMatchObject({
    bannerIds: [],
  });
});

test("waits for Bannergress authentication before requesting a private list", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/enschede-place")) {
      return jsonResponse({ id: "enschede-place", formattedAddress: "Enschede" });
    }

    throw new Error(`Private list should not be requested: ${url}`);
  });

  renderPage();

  expect(
    await screen.findByText(
      "Authenticate with Bannergress in the top bar to compare to-do lists."
    )
  ).toBeInTheDocument();
  expect(
    global.fetch.mock.calls.some(([url]) => url.includes("/bnrs?"))
  ).toBe(false);
});

test("rejects an invite whose payload belongs to another place", async () => {
  authenticate();
  const inviteHash = await createBannerTogetherInviteHash({
    placeId: "utrecht-place",
    bannerIds: ["shared-banner"],
    createdAt: TEST_CREATED_AT,
  });
  window.history.replaceState(
    {},
    "",
    `/together/enschede-place${inviteHash}`
  );

  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/enschede-place")) {
      return jsonResponse({ id: "enschede-place", formattedAddress: "Enschede" });
    }

    throw new Error(`Private list should not be requested: ${url}`);
  });

  renderPage();

  expect(
    await screen.findByText("This invite belongs to a different place.")
  ).toBeInTheDocument();
  expect(
    global.fetch.mock.calls.some(([url]) => url.includes("/bnrs?"))
  ).toBe(false);
  expect(window.localStorage.getItem(BANNERGRESS_AUTH_STORAGE_KEY)).toContain(
    "test-access-token"
  );
});

test("removes an invalid fragment when starting a new snapshot", async () => {
  window.history.replaceState(
    {},
    "",
    "/together/enschede-place#banner-together=raw.invalid"
  );
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/enschede-place")) {
      return jsonResponse({ id: "enschede-place", formattedAddress: "Enschede" });
    }

    throw new Error(`Private list should not be requested: ${url}`);
  });

  renderPage();

  expect(await screen.findByText(/invite payload/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: /start new/i }));

  expect(await screen.findByText("Your snapshot")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Authenticate with Bannergress in the top bar to compare to-do lists."
    )
  ).toBeInTheDocument();
});

test("does not request a private list until the place is valid", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  authenticate();
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/missing-place")) {
      return jsonResponse({}, 404);
    }

    throw new Error(`Private list should not be requested: ${url}`);
  });

  renderPage("missing-place");

  expect(
    await screen.findByText("This Bannergress place could not be loaded.")
  ).toBeInTheDocument();
  expect(
    global.fetch.mock.calls.some(([url]) => url.includes("/bnrs?"))
  ).toBe(false);
  expect(screen.queryByText("Your snapshot")).not.toBeInTheDocument();
});

test("does not request the next place's private list before validating it", async () => {
  authenticate();
  const missingPlaceResponse = deferred();
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/enschede-place")) {
      return jsonResponse({ id: "enschede-place", formattedAddress: "Enschede" });
    }

    if (url.includes("/places/missing-place")) {
      return missingPlaceResponse.promise;
    }

    if (url.includes("/bnrs?") && url.includes("placeId=enschede-place")) {
      return jsonResponse([createBanner("enschede-banner", "Enschede Banner")]);
    }

    throw new Error(`Private list should not be requested: ${url}`);
  });

  const renderResult = renderPage();
  expect(await screen.findByText("Enschede Banner")).toBeInTheDocument();

  renderResult.rerender(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LegacyBannerTogetherPage placeId="missing-place" />
      </MemoryRouter>
    </ThemeProvider>
  );

  await waitFor(() => {
    expect(
      global.fetch.mock.calls.some(
        ([url]) => url.includes("/bnrs?") && url.includes("placeId=missing-place")
      )
    ).toBe(false);
  });

  missingPlaceResponse.resolve({
    ok: false,
    status: 404,
    json: () => Promise.resolve({}),
  });

  expect(
    await screen.findByText("This Bannergress place could not be loaded.")
  ).toBeInTheDocument();
  expect(
    global.fetch.mock.calls.some(
      ([url]) => url.includes("/bnrs?") && url.includes("placeId=missing-place")
    )
  ).toBe(false);
});

test("keeps replacement credentials when an older list request is rejected", async () => {
  authenticate();
  const oldListResponse = deferred();
  global.fetch.mockImplementation((url, options = {}) => {
    if (url.includes("/places/enschede-place")) {
      return jsonResponse({ id: "enschede-place", formattedAddress: "Enschede" });
    }

    if (url.includes("/bnrs?")) {
      const authorization = new Headers(options.headers).get("Authorization");

      if (authorization === "Bearer test-access-token") {
        return oldListResponse.promise;
      }

      if (authorization === "Bearer replacement-access-token") {
        return jsonResponse([
          createBanner("replacement-banner", "Replacement Session Banner"),
        ]);
      }
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderPage();

  await waitFor(() => {
    expect(
      global.fetch.mock.calls.some(
        ([url, options = {}]) =>
          url.includes("/bnrs?") &&
          new Headers(options.headers).get("Authorization") ===
            "Bearer test-access-token"
      )
    ).toBe(true);
  });

  saveBannergressAuthData({
    accessToken: "replacement-access-token",
    refreshToken: "replacement-refresh-token",
    accessExpiresAt: Date.now() + 5 * 60 * 1000,
    refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    updatedAt: Date.now(),
  });

  expect(
    await screen.findByText("Replacement Session Banner")
  ).toBeInTheDocument();

  oldListResponse.resolve({
    ok: false,
    status: 401,
    json: () => Promise.resolve({}),
  });

  await waitFor(() => {
    expect(loadBannergressAuthData()).toMatchObject({
      accessToken: "replacement-access-token",
      refreshToken: "replacement-refresh-token",
    });
  });
});

test("stops host pagination once the snapshot limit is exceeded", async () => {
  authenticate();
  let bannerPageRequests = 0;
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/enschede-place")) {
      return jsonResponse({ id: "enschede-place", formattedAddress: "Enschede" });
    }

    if (url.includes("/bnrs?")) {
      bannerPageRequests += 1;
      const offset = Number(new URL(url).searchParams.get("offset"));
      return jsonResponse(
        Array.from({ length: 100 }, (_value, index) =>
          createBanner(`bounded-banner-${offset + index}`)
        )
      );
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderPage();

  expect(await screen.findByText("1001 to do")).toBeInTheDocument();
  expect(bannerPageRequests).toBe(11);
  expect(
    screen.getByText(/snapshot invites support at most 1000/i)
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /copy snapshot invite/i })
  ).toBeDisabled();
});

test("prioritizes a room route over an unrelated legacy snapshot fragment", async () => {
  const roomId = "Q".repeat(22);
  const legacyHash = await createBannerTogetherInviteHash({
    placeId: "enschede-place",
    bannerIds: ["legacy-banner"],
  });
  global.fetch.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        id: "enschede-place",
        formattedAddress: "Enschede, Netherlands",
      }),
  });

  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter
        initialEntries={[
          `/together/enschede-place/room/${roomId}${legacyHash}`,
        ]}
      >
        <BannerTogetherPage placeId="enschede-place" roomId={roomId} />
      </MemoryRouter>
    </ThemeProvider>
  );

  expect(
    await screen.findByText("Room invite hash has an invalid prefix.")
  ).toBeInTheDocument();
});
