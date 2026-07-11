import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import BannerTogetherLivePage from "./BannerTogetherLivePage";
import { saveBannergressAuthData } from "../bannergressSync";
import {
  BANNER_TOGETHER_LIVE_VERSION,
  createBannerTogetherLiveInviteHash,
  loadBannerTogetherLiveAccess,
  saveBannerTogetherLiveAccess,
} from "../bannerTogetherLiveCrypto";

const mocks = vi.hoisted(() => ({
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
  fetchMembership: vi.fn(),
  fetchCatalog: vi.fn(),
  loadCatalogCache: vi.fn(),
  saveCatalogCache: vi.fn(),
  loadMembershipCache: vi.fn(),
  saveMembershipCache: vi.fn(),
  createSecrets: vi.fn(),
  createParticipantIdentity: vi.fn(),
  encryptSnapshot: vi.fn(),
  decryptSnapshot: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("../bannerTogetherLiveApi", () => ({
  createBannerTogetherLiveRoom: mocks.createRoom,
  joinBannerTogetherLiveRoom: mocks.joinRoom,
}));

vi.mock("../bannerTogetherData", () => ({
  fetchBannerTogetherMembership: mocks.fetchMembership,
  fetchBannerTogetherCatalog: mocks.fetchCatalog,
  loadBannerTogetherCatalogCache: mocks.loadCatalogCache,
  loadBannerTogetherMembershipCache: mocks.loadMembershipCache,
  saveBannerTogetherCatalogCache: mocks.saveCatalogCache,
  saveBannerTogetherMembershipCache: mocks.saveMembershipCache,
}));

vi.mock("../bannerTogetherLiveCrypto", async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    createBannerTogetherLiveSecrets: mocks.createSecrets,
    createBannerTogetherLiveParticipantIdentity:
      mocks.createParticipantIdentity,
    encryptBannerTogetherLiveSnapshot: mocks.encryptSnapshot,
    decryptBannerTogetherLiveSnapshot: mocks.decryptSnapshot,
  };
});

vi.mock("../bannerTogetherPeerMesh", () => ({
  createBannerTogetherPeerMeshSession: mocks.createSession,
}));

vi.mock("./BannerCard", () => ({
  default: ({ banner }) => <div>{banner.title}</div>,
}));

const theme = createTheme({ palette: { mode: "dark" } });
const PLACE_ID = "enschede-place";
const ROOM_ID = "Q".repeat(22);
const ROOM_SECRET = "M".repeat(43);
const ROOM_VERIFIER = "E".repeat(43);
const LOCAL_PARTICIPANT_ID = "A".repeat(22);
const LOCAL_PARTICIPANT_VERIFIER = "U".repeat(43);
const LOCAL_PARTICIPANT_TOKEN = "I".repeat(43);
const GUEST_PARTICIPANT_ID = "g".repeat(22);
const GUEST_PARTICIPANT_VERIFIER = "U".repeat(43);
const PEER_ONE_ID = "Q".repeat(22);
const PEER_TWO_ID = "g".repeat(22);
const EXPIRES_AT = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
const ENVELOPE = {
  version: 1,
  algorithm: "AES-256-GCM",
  iv: "A".repeat(16),
  ciphertext: "A".repeat(64),
};

let sessionOptions;
let session;

function createJwt(payload) {
  const encodedPayload = window
    .btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `header.${encodedPayload}.signature`;
}

function authenticate(agentName = null) {
  saveBannergressAuthData({
    accessToken: "live-page-access-token",
    idToken: agentName
      ? createJwt({ preferred_username: agentName })
      : null,
    refreshToken: "live-page-refresh-token",
    accessExpiresAt: Date.now() + 5 * 60 * 1000,
    refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    updatedAt: Date.now(),
  });
}

function membership(lists) {
  return {
    capturedAt: new Date().toISOString(),
    lists: {
      todo: lists.todo ?? [],
      done: lists.done ?? [],
      blacklist: lists.blacklist ?? [],
    },
  };
}

function roomResponse({ participantId = LOCAL_PARTICIPANT_ID, peers = [] } = {}) {
  return {
    version: 3,
    roomId: ROOM_ID,
    participantToken:
      participantId === LOCAL_PARTICIPANT_ID
        ? LOCAL_PARTICIPANT_TOKEN
        : "Y".repeat(43),
    expiresAt: EXPIRES_AT,
    peers,
  };
}

function renderPage({ roomId = null, hash = "" } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter
        initialEntries={[
          `/together/${PLACE_ID}${
            roomId ? `/live/${roomId}` : ""
          }${hash}`,
        ]}
      >
        <BannerTogetherLivePage placeId={PLACE_ID} roomId={roomId} />
      </MemoryRouter>
    </ThemeProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        id: PLACE_ID,
        formattedAddress: "Enschede, Netherlands",
      }),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  mocks.createSecrets.mockResolvedValue({
    roomSecret: ROOM_SECRET,
    roomVerifier: ROOM_VERIFIER,
    participantId: LOCAL_PARTICIPANT_ID,
    participantVerifier: LOCAL_PARTICIPANT_VERIFIER,
  });
  mocks.createParticipantIdentity.mockReturnValue({
    participantId: GUEST_PARTICIPANT_ID,
    participantVerifier: GUEST_PARTICIPANT_VERIFIER,
  });
  mocks.createRoom.mockResolvedValue(roomResponse());
  mocks.joinRoom.mockResolvedValue(
    roomResponse({ participantId: GUEST_PARTICIPANT_ID })
  );
  mocks.encryptSnapshot.mockResolvedValue(ENVELOPE);
  mocks.loadCatalogCache.mockReturnValue(null);
  mocks.saveCatalogCache.mockImplementation((_placeId, banners) => ({
    capturedAt: new Date().toISOString(),
    banners,
  }));
  mocks.loadMembershipCache.mockResolvedValue(null);
  mocks.saveMembershipCache.mockImplementation((_placeId, snapshot) =>
    Promise.resolve(snapshot)
  );
  mocks.fetchCatalog.mockImplementation(async (_placeId, { onPage }) => {
    const catalog = [
      { id: "shared", title: "Shared Banner" },
      { id: "mine-only", title: "Mine Only Banner" },
      { id: "peer-hidden", title: "Peer Hidden Banner" },
    ];
    onPage(catalog);
    return catalog;
  });
  session = {
    start: vi.fn(function start() {
      return this;
    }),
    publishSnapshot: vi.fn().mockResolvedValue({ sentTo: [] }),
    clearPublishedSnapshot: vi.fn().mockResolvedValue({ sentTo: [] }),
    getParticipantStates: vi.fn().mockReturnValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  mocks.createSession.mockImplementation((options) => {
    sessionOptions = options;
    return session;
  });
});

test("creates a fixed-length live invite without sharing hundreds of list IDs", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(
    membership({
      todo: Array.from({ length: 500 }, (_value, index) => `todo-${index}`),
    })
  );

  renderPage();
  fireEvent.click(
    await screen.findByRole("button", { name: /create and copy invite/i })
  );

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  const inviteUrl = navigator.clipboard.writeText.mock.calls[0][0];
  expect(inviteUrl.length).toBeLessThan(220);
  expect(inviteUrl).toContain(`/together/${PLACE_ID}/live/${ROOM_ID}`);
  expect(inviteUrl).not.toContain("todo-499");
  expect(inviteUrl).not.toContain("live-page-access-token");
  expect(inviteUrl).not.toContain("live-page-refresh-token");
  expect(session.publishSnapshot).not.toHaveBeenCalled();
  expect(mocks.createRoom).toHaveBeenCalledWith({
    roomVerifier: ROOM_VERIFIER,
    participantId: LOCAL_PARTICIPANT_ID,
    participantVerifier: LOCAL_PARTICIPANT_VERIFIER,
  });
});

test("uses four-hour browser caches until the user refreshes all lists", async () => {
  authenticate();
  const capturedAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const cachedMembership = {
    capturedAt,
    lists: { todo: ["shared"], done: [], blacklist: [] },
  };
  const refreshedMembership = membership({ todo: ["mine-only"] });
  const cachedCatalog = {
    capturedAt,
    banners: [{ id: "shared", title: "Cached shared banner" }],
  };
  mocks.loadCatalogCache.mockReturnValue(cachedCatalog);
  mocks.loadMembershipCache.mockResolvedValue(cachedMembership);
  mocks.fetchMembership.mockResolvedValue(refreshedMembership);

  renderPage();

  expect(
    await screen.findByText(/using browser-cached comparison data/i)
  ).toHaveTextContent(/1 hour 30 minutes old/i);
  expect(mocks.fetchMembership).not.toHaveBeenCalled();
  expect(mocks.fetchCatalog).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: /refresh lists/i }));

  await waitFor(() => {
    expect(mocks.fetchMembership).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.saveMembershipCache).toHaveBeenCalledWith(
      PLACE_ID,
      refreshedMembership
    );
  });
  expect(
    screen.queryByText(/using browser-cached comparison data/i)
  ).not.toBeInTheDocument();
});

test("retries a failed catalog without refetching private memberships", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["shared"] }));
  mocks.fetchCatalog.mockRejectedValueOnce(new Error("Catalog temporarily down"));

  renderPage();

  expect(
    await screen.findByText("Catalog temporarily down")
  ).toBeInTheDocument();
  expect(mocks.fetchMembership).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalledTimes(2));
  expect(mocks.fetchMembership).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(screen.queryByText("Catalog temporarily down")).not.toBeInTheDocument()
  );
  consoleError.mockRestore();
});

test("warns when comparison data cannot be retained in browser storage", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["shared"] }));
  mocks.saveCatalogCache.mockReturnValue(null);

  renderPage();

  expect(
    await screen.findByText(/could not cache all comparison data/i)
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /create and copy invite/i })
  );
  expect(
    await screen.findByText(/could not cache all comparison data/i)
  ).toBeInTheDocument();
});

test("rejoins privately when a suspended session token expires", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["shared"] }));
  saveBannerTogetherLiveAccess({
    version: BANNER_TOGETHER_LIVE_VERSION,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    roomSecret: ROOM_SECRET,
    participantId: LOCAL_PARTICIPANT_ID,
    participantVerifier: LOCAL_PARTICIPANT_VERIFIER,
    participantToken: LOCAL_PARTICIPANT_TOKEN,
    expiresAt: EXPIRES_AT,
  });

  renderPage({ roomId: ROOM_ID });

  await waitFor(() => {
    expect(mocks.joinRoom).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });
  act(() => {
    sessionOptions.onSessionState({
      state: "reconnect-required",
      error: Object.assign(new Error("Inactive"), { status: 401 }),
    });
  });

  expect(
    await screen.findByText(/connection expired and is rejoining privately/i)
  ).toBeInTheDocument();
  await waitFor(() => {
    expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
  });
  expect(screen.getByRole("checkbox", { name: "Share my lists" })).not.toBeChecked();
});

test("joins a room with sharing off until the participant explicitly enables it", async () => {
  authenticate("JoiningAgent");
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["shared"] }));
  const inviteHash = createBannerTogetherLiveInviteHash({
    roomSecret: ROOM_SECRET,
  });

  renderPage({ roomId: ROOM_ID, hash: inviteHash });
  fireEvent.click(await screen.findByRole("button", { name: /^join room$/i }));

  expect(
    await screen.findByText("Joined. Your lists are still private.")
  ).toBeInTheDocument();
  const shareSwitch = screen.getByRole("checkbox", { name: "Share my lists" });
  expect(shareSwitch).not.toBeChecked();
  expect(session.publishSnapshot).not.toHaveBeenCalled();
  expect(mocks.joinRoom).toHaveBeenCalledWith(
    expect.objectContaining({
      roomId: ROOM_ID,
      participantId: GUEST_PARTICIPANT_ID,
      participantVerifier: GUEST_PARTICIPANT_VERIFIER,
    })
  );

  fireEvent.click(shareSwitch);
  await waitFor(() => expect(session.publishSnapshot).toHaveBeenCalledTimes(1));
  expect(mocks.encryptSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({
      participantId: GUEST_PARTICIPANT_ID,
      agentName: "JoiningAgent",
      lists: { todo: ["shared"], done: [], blacklist: [] },
    })
  );
  expect(shareSwitch).toBeChecked();

  fireEvent.click(shareSwitch);
  await waitFor(() => {
    expect(session.clearPublishedSnapshot.mock.calls.length).toBeGreaterThan(1);
  });
  expect(shareSwitch).not.toBeChecked();
});

test("compares local lists with two named peers that explicitly share", async () => {
  authenticate("LocalAgent");
  const ownMembership = membership({
    todo: ["shared", "mine-only", "peer-hidden"],
  });
  mocks.fetchMembership.mockResolvedValue(ownMembership);
  mocks.joinRoom.mockResolvedValue(
    roomResponse({ peers: [PEER_ONE_ID, PEER_TWO_ID] })
  );
  mocks.decryptSnapshot.mockImplementation(({ participantId }) =>
    Promise.resolve(
      participantId === PEER_ONE_ID
        ? {
            ...membership({ todo: ["shared"] }),
            agentName: "AgentOne",
          }
        : {
            ...membership({
              todo: ["shared"],
              blacklist: ["peer-hidden"],
            }),
            agentName: "AgentTwo",
          }
    )
  );
  saveBannerTogetherLiveAccess({
    version: BANNER_TOGETHER_LIVE_VERSION,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    roomSecret: ROOM_SECRET,
    participantId: LOCAL_PARTICIPANT_ID,
    participantVerifier: LOCAL_PARTICIPANT_VERIFIER,
    participantToken: LOCAL_PARTICIPANT_TOKEN,
    expiresAt: EXPIRES_AT,
  });

  renderPage({ roomId: ROOM_ID });
  await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));

  await act(async () => {
    sessionOptions.onParticipantState({
      participantId: PEER_ONE_ID,
      state: "connected",
    });
    sessionOptions.onParticipantState({
      participantId: PEER_TWO_ID,
      state: "connected",
    });
    await sessionOptions.onSnapshot({
      participantId: PEER_ONE_ID,
      sequence: 1,
      envelope: ENVELOPE,
    });
    await sessionOptions.onSnapshot({
      participantId: PEER_TWO_ID,
      sequence: 1,
      envelope: ENVELOPE,
    });
  });

  expect(await screen.findByText("Shared Banner")).toBeInTheDocument();
  expect(screen.getByText("Everyone to-do")).toBeInTheDocument();
  expect(screen.getByText("AgentOne - sharing")).toBeInTheDocument();
  expect(screen.getByText("AgentTwo - sharing")).toBeInTheDocument();
  expect(screen.getByText(/AgentOne: 1 to do, 0 done, 0 hidden/)).toBeInTheDocument();

  fireEvent.mouseDown(screen.getByLabelText("Comparison"));
  fireEvent.click(
    await screen.findByRole("option", {
      name: "My to-do, nobody else hidden",
    })
  );
  expect(await screen.findByText("Mine Only Banner")).toBeInTheDocument();
  expect(screen.queryByText("Peer Hidden Banner")).not.toBeInTheDocument();

  act(() => {
    sessionOptions.onParticipantState({
      participantId: PEER_TWO_ID,
      state: "disconnected",
    });
  });
  expect(
    await screen.findByText(
      "AgentTwo - disconnected"
    )
  ).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText("Comparison"));
  fireEvent.click(
    await screen.findByRole("option", {
      name: "My to-do, nobody else hidden",
    })
  );
  expect(await screen.findByText("Peer Hidden Banner")).toBeInTheDocument();

  act(() => {
    sessionOptions.onParticipantState({
      participantId: PEER_TWO_ID,
      state: "connected",
    });
  });
  expect(
    await screen.findByText("AgentTwo - sharing")
  ).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText("Comparison"));
  fireEvent.click(
    await screen.findByRole("option", {
      name: "My to-do, nobody else hidden",
    })
  );
  expect(screen.queryByText("Peer Hidden Banner")).not.toBeInTheDocument();

  act(() => {
    sessionOptions.onParticipantState({
      participantId: PEER_ONE_ID,
      state: "left",
    });
    sessionOptions.onParticipantState({
      participantId: PEER_TWO_ID,
      state: "left",
    });
  });
  expect(
    await screen.findByText(/waiting for other people/i)
  ).toBeInTheDocument();
  expect(screen.queryByText(/Agent.* - left/)).not.toBeInTheDocument();
});

test("leaves the ephemeral room and clears local access", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: [] }));
  mocks.joinRoom.mockResolvedValue(roomResponse());
  saveBannerTogetherLiveAccess({
    version: BANNER_TOGETHER_LIVE_VERSION,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    roomSecret: ROOM_SECRET,
    participantId: LOCAL_PARTICIPANT_ID,
    participantVerifier: LOCAL_PARTICIPANT_VERIFIER,
    participantToken: LOCAL_PARTICIPANT_TOKEN,
    expiresAt: EXPIRES_AT,
  });

  renderPage({ roomId: ROOM_ID });
  fireEvent.click(
    await screen.findByRole("button", { name: "Leave live room" })
  );

  await waitFor(() => {
    expect(session.close).toHaveBeenCalledWith({ notifyServer: true });
  });
  expect(loadBannerTogetherLiveAccess({ roomId: ROOM_ID, placeId: PLACE_ID })).toBeNull();
});
