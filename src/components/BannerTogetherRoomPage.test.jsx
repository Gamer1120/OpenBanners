import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import BannerTogetherRoomPage from "./BannerTogetherRoomPage";
import { saveBannergressAuthData } from "../bannergressSync";
import {
  BANNER_TOGETHER_ROOM_VERSION,
  createBannerTogetherRoomInviteHash,
  loadBannerTogetherRoomAccess,
  saveBannerTogetherRoomAccess,
} from "../bannerTogetherRoomCrypto";

const mocks = vi.hoisted(() => ({
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
  getRoom: vi.fn(),
  putSnapshot: vi.fn(),
  deleteRoom: vi.fn(),
  fetchMembership: vi.fn(),
  fetchCatalog: vi.fn(),
  createSecrets: vi.fn(),
  createGuestAccess: vi.fn(),
  encryptSnapshot: vi.fn(),
  decryptSnapshot: vi.fn(),
}));

vi.mock("../bannerTogetherRoomApi", () => ({
  createBannerTogetherRoom: mocks.createRoom,
  joinBannerTogetherRoom: mocks.joinRoom,
  getBannerTogetherRoom: mocks.getRoom,
  putBannerTogetherRoomSnapshot: mocks.putSnapshot,
  deleteBannerTogetherRoom: mocks.deleteRoom,
}));

vi.mock("../bannerTogetherData", () => ({
  fetchBannerTogetherMembership: mocks.fetchMembership,
  fetchBannerTogetherCatalog: mocks.fetchCatalog,
}));

vi.mock("../bannerTogetherRoomCrypto", async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    createBannerTogetherRoomSecrets: mocks.createSecrets,
    createBannerTogetherRoomGuestAccess: mocks.createGuestAccess,
    encryptBannerTogetherRoomSnapshot: mocks.encryptSnapshot,
    decryptBannerTogetherRoomSnapshot: mocks.decryptSnapshot,
  };
});

vi.mock("./BannerCard", () => ({
  default: ({ banner }) => <div>{banner.title}</div>,
}));

const theme = createTheme({ palette: { mode: "dark" } });
const PLACE_ID = "enschede-place";
const ROOM_ID = "Q".repeat(22);
const ROOM_KEY = "M".repeat(43);
const OWNER_CAPABILITY = "A".repeat(43);
const JOIN_CAPABILITY = "E".repeat(43);
const GUEST_CAPABILITY = "I".repeat(43);
const GUEST_CAPABILITY_HASH =
  "c96PpWIrq17J1ZcEuhZSbRrnHB9aHYEDhnqkyfVCcaE";
const EXPIRES_AT = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
const ENVELOPE = {
  version: 1,
  algorithm: "AES-256-GCM",
  iv: "A".repeat(16),
  ciphertext: "A".repeat(88),
};

function authenticate() {
  saveBannergressAuthData({
    accessToken: "room-page-access-token",
    refreshToken: "room-page-refresh-token",
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

function roomResponse({ owner = null, guest = null } = {}) {
  return {
    version: 2,
    roomId: ROOM_ID,
    expiresAt: EXPIRES_AT,
    joined: Boolean(guest),
    snapshots: { owner, guest },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function LocationProbe() {
  const location = useLocation();

  return <output data-testid="location-hash">{location.hash}</output>;
}

function renderPage({ roomId = null, hash = "" } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter
        initialEntries={[
          `/together/${PLACE_ID}${
            roomId ? `/room/${roomId}` : ""
          }${hash}`,
        ]}
      >
        <BannerTogetherRoomPage placeId={PLACE_ID} roomId={roomId} />
        <LocationProbe />
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
    roomKey: ROOM_KEY,
    ownerCapability: OWNER_CAPABILITY,
    ownerCapabilityHash: "A".repeat(43),
    joinCapability: JOIN_CAPABILITY,
    joinCapabilityHash: "E".repeat(43),
  });
  mocks.createGuestAccess.mockResolvedValue({
    guestCapability: GUEST_CAPABILITY,
    guestCapabilityHash: GUEST_CAPABILITY_HASH,
  });
  mocks.createRoom.mockResolvedValue({
    version: 2,
    roomId: ROOM_ID,
    expiresAt: EXPIRES_AT,
  });
  mocks.joinRoom.mockResolvedValue({ joined: true });
  mocks.putSnapshot.mockResolvedValue({
    version: 2,
    role: "owner",
    sequence: 1,
    updatedAt: new Date().toISOString(),
  });
  mocks.deleteRoom.mockResolvedValue({ deleted: true });
  mocks.encryptSnapshot.mockResolvedValue(ENVELOPE);
  mocks.fetchCatalog.mockImplementation(async (_placeId, { onPage }) => {
    const catalog = [
      { id: "shared", title: "Shared Banner" },
      { id: "guest-done", title: "Guest Done Banner" },
      { id: "guest-hidden", title: "Guest Hidden Banner" },
      { id: "guest-unlisted", title: "Guest Unlisted Banner" },
    ];
    onPage(catalog);
    return catalog;
  });
});

test("creates a fixed-length encrypted room invite for hundreds of list entries", async () => {
  authenticate();
  const ownMembership = membership({
    todo: Array.from({ length: 500 }, (_value, index) => `todo-${index}`),
    done: ["done-one"],
    blacklist: ["hidden-one"],
  });
  mocks.fetchMembership.mockResolvedValue(ownMembership);

  renderPage();

  expect(await screen.findByText("500 to do")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /create and copy invite/i })
  );

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  const inviteUrl = navigator.clipboard.writeText.mock.calls[0][0];
  expect(inviteUrl.length).toBeLessThan(220);
  expect(inviteUrl).toContain(`/together/${PLACE_ID}/room/${ROOM_ID}`);
  expect(inviteUrl).not.toContain("todo-499");
  expect(inviteUrl).not.toContain("room-page-access-token");
  expect(inviteUrl).not.toContain("room-page-refresh-token");
  expect(mocks.putSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({
      roomId: ROOM_ID,
      role: "owner",
      capability: OWNER_CAPABILITY,
      expectedSequence: 0,
      envelope: ENVELOPE,
    })
  );
});

test("reuses the same idempotency key after an uncertain create failure", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["one"] }));
  mocks.createRoom
    .mockRejectedValueOnce(new Error("The create response was interrupted."))
    .mockResolvedValueOnce({
      version: 2,
      roomId: ROOM_ID,
      expiresAt: EXPIRES_AT,
    });

  renderPage();

  const createButton = await screen.findByRole("button", {
    name: /create and copy invite/i,
  });
  fireEvent.click(createButton);
  expect(
    await screen.findByText("The create response was interrupted.")
  ).toBeInTheDocument();
  fireEvent.click(createButton);

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  expect(mocks.createSecrets).toHaveBeenCalledTimes(1);
  expect(mocks.createRoom).toHaveBeenCalledTimes(2);
  expect(mocks.createRoom.mock.calls[0][0].idempotencyKey).toBe(
    mocks.createRoom.mock.calls[1][0].idempotencyKey
  );
});

test("recovers when the first snapshot was committed but its response was lost", async () => {
  authenticate();
  const ownMembership = membership({
    todo: ["one", "two"],
    done: ["finished"],
  });
  mocks.fetchMembership.mockResolvedValue(ownMembership);
  mocks.putSnapshot.mockRejectedValueOnce(
    Object.assign(new Error("The upload response was interrupted."), {
      status: 409,
      currentSequence: 1,
    })
  );
  mocks.getRoom.mockResolvedValue(
    roomResponse({
      owner: {
        sequence: 1,
        updatedAt: new Date().toISOString(),
        envelope: ENVELOPE,
      },
    })
  );
  mocks.decryptSnapshot.mockResolvedValue(ownMembership);

  renderPage();

  fireEvent.click(
    await screen.findByRole("button", { name: /create and copy invite/i })
  );

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  expect(mocks.getRoom).toHaveBeenCalledWith({
    roomId: ROOM_ID,
    capability: OWNER_CAPABILITY,
  });
  expect(mocks.decryptSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({
      roomId: ROOM_ID,
      participant: "owner",
      sequence: 1,
    })
  );
  expect(mocks.deleteRoom).not.toHaveBeenCalled();
});

test("joins an invite, publishes the guest snapshot, and compares locally", async () => {
  authenticate();
  const ownMembership = membership({ todo: ["shared", "guest-unlisted"] });
  const ownerSnapshot = membership({
    todo: ["shared", "guest-done", "guest-hidden", "guest-unlisted"],
  });
  mocks.fetchMembership.mockResolvedValue(ownMembership);
  mocks.getRoom.mockResolvedValue(
    roomResponse({
      owner: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
      guest: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
    })
  );
  mocks.decryptSnapshot.mockResolvedValue(ownerSnapshot);
  mocks.putSnapshot.mockResolvedValue({
    version: 2,
    role: "guest",
    sequence: 1,
    updatedAt: new Date().toISOString(),
  });
  const inviteHash = createBannerTogetherRoomInviteHash({
    roomKey: ROOM_KEY,
    joinCapability: JOIN_CAPABILITY,
  });

  renderPage({ roomId: ROOM_ID, hash: inviteHash });

  expect(
    await screen.findByRole("button", { name: /join and share my lists/i })
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: /join and share my lists/i })
  );

  expect(await screen.findByText("Shared Banner")).toBeInTheDocument();
  expect(screen.getByLabelText("Inviter")).toBeInTheDocument();
  expect(screen.getByLabelText("Mine")).toBeInTheDocument();
  expect(mocks.joinRoom).toHaveBeenCalledWith(
    expect.objectContaining({
      roomId: ROOM_ID,
      joinCapability: JOIN_CAPABILITY,
      guestCapabilityHash: GUEST_CAPABILITY_HASH,
    })
  );
  expect(mocks.putSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ role: "guest", expectedSequence: 0 })
  );
});

test("applies richer list-state presets after the collaborator shares", async () => {
  authenticate();
  const ownMembership = membership({
    todo: ["shared", "guest-done", "guest-hidden", "guest-unlisted"],
  });
  const guestSnapshot = membership({
    todo: ["shared"],
    done: ["guest-done"],
    blacklist: ["guest-hidden"],
  });
  mocks.fetchMembership.mockResolvedValue(ownMembership);
  mocks.getRoom.mockResolvedValue(
    roomResponse({
      owner: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
      guest: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
    })
  );
  mocks.decryptSnapshot.mockResolvedValue(guestSnapshot);
  saveBannerTogetherRoomAccess({
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    role: "owner",
    roomKey: ROOM_KEY,
    capability: OWNER_CAPABILITY,
    joinCapability: JOIN_CAPABILITY,
    expiresAt: EXPIRES_AT,
    highestSequences: { owner: 1, guest: 0 },
  });

  renderPage({ roomId: ROOM_ID });

  expect(await screen.findByText("Shared Banner")).toBeInTheDocument();
  expect(screen.queryByText("Guest Done Banner")).not.toBeInTheDocument();

  fireEvent.mouseDown(screen.getByLabelText("Comparison"));
  fireEvent.click(
    await screen.findByRole("option", {
      name: "My to-do, not hidden by them",
    })
  );

  expect(await screen.findByText("Guest Done Banner")).toBeInTheDocument();
  expect(screen.getByText("Guest Unlisted Banner")).toBeInTheDocument();
  expect(screen.queryByText("Guest Hidden Banner")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /^copy invite$/i })
  ).not.toBeInTheDocument();
});

test("ignores an older room load that finishes after a newer refresh", async () => {
  authenticate();
  const staleDecryption = createDeferred();
  mocks.fetchMembership.mockResolvedValue(
    membership({ todo: ["shared", "old-only", "new-only"] })
  );
  mocks.fetchCatalog.mockImplementation(async (_placeId, { onPage }) => {
    const catalog = [
      { id: "shared", title: "Shared Banner" },
      { id: "old-only", title: "Old Snapshot Banner" },
      { id: "new-only", title: "New Snapshot Banner" },
    ];
    onPage(catalog);
    return catalog;
  });
  mocks.getRoom
    .mockResolvedValueOnce(
      roomResponse({
        owner: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
        guest: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
      })
    )
    .mockResolvedValueOnce(
      roomResponse({
        owner: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
        guest: { sequence: 2, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
      })
    )
    .mockResolvedValueOnce(
      roomResponse({
        owner: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
        guest: { sequence: 3, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
      })
    );
  mocks.decryptSnapshot.mockImplementation(({ sequence }) => {
    if (sequence === 2) {
      return staleDecryption.promise;
    }

    return Promise.resolve(
      membership({ todo: sequence === 3 ? ["new-only"] : ["shared"] })
    );
  });
  saveBannerTogetherRoomAccess({
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    role: "owner",
    roomKey: ROOM_KEY,
    capability: OWNER_CAPABILITY,
    joinCapability: JOIN_CAPABILITY,
    expiresAt: EXPIRES_AT,
    highestSequences: { owner: 1, guest: 1 },
  });

  renderPage({ roomId: ROOM_ID });

  expect(await screen.findByText("Shared Banner")).toBeInTheDocument();
  const refreshButton = screen.getByRole("button", {
    name: /refresh encrypted room/i,
  });
  fireEvent.click(refreshButton);
  await waitFor(() => expect(mocks.getRoom).toHaveBeenCalledTimes(2));
  fireEvent.click(refreshButton);

  expect(await screen.findByText("New Snapshot Banner")).toBeInTheDocument();
  staleDecryption.resolve(membership({ todo: ["old-only"] }));

  await waitFor(() => {
    expect(screen.getByText("New Snapshot Banner")).toBeInTheDocument();
    expect(screen.queryByText("Old Snapshot Banner")).not.toBeInTheDocument();
  });
  expect(loadBannerTogetherRoomAccess(ROOM_ID).highestSequences.guest).toBe(3);
});

test("rejects a room response that removes an observed snapshot", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["shared"] }));
  mocks.getRoom.mockResolvedValue(
    roomResponse({
      owner: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
      guest: null,
    })
  );
  saveBannerTogetherRoomAccess({
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    role: "owner",
    roomKey: ROOM_KEY,
    capability: OWNER_CAPABILITY,
    joinCapability: JOIN_CAPABILITY,
    expiresAt: EXPIRES_AT,
    highestSequences: { owner: 1, guest: 1 },
  });

  renderPage({ roomId: ROOM_ID });

  expect(
    await screen.findByText("The encrypted room returned an older snapshot.")
  ).toBeInTheDocument();
});

test("does not present partial catalog matches after a later page fails", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["shared"] }));
  mocks.getRoom.mockResolvedValue(
    roomResponse({
      owner: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
      guest: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
    })
  );
  mocks.decryptSnapshot.mockResolvedValue(membership({ todo: ["shared"] }));
  mocks.fetchCatalog.mockImplementation(async (_placeId, { onPage }) => {
    onPage([{ id: "shared", title: "Partial Catalog Banner" }]);
    throw new Error("The second catalog page failed.");
  });
  saveBannerTogetherRoomAccess({
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    role: "owner",
    roomKey: ROOM_KEY,
    capability: OWNER_CAPABILITY,
    joinCapability: JOIN_CAPABILITY,
    expiresAt: EXPIRES_AT,
    highestSequences: { owner: 1, guest: 1 },
  });

  renderPage({ roomId: ROOM_ID });

  expect(await screen.findByText("The second catalog page failed.")).toBeInTheDocument();
  expect(screen.queryByText("Partial Catalog Banner")).not.toBeInTheDocument();
  expect(screen.queryByText("Matching banners")).not.toBeInTheDocument();
});

test("clears an accepted invite fragment even when the first guest upload fails", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["shared"] }));
  mocks.putSnapshot.mockRejectedValueOnce(new Error("The first share failed."));
  mocks.getRoom.mockResolvedValue(
    roomResponse({
      owner: { sequence: 1, updatedAt: new Date().toISOString(), envelope: ENVELOPE },
      guest: null,
    })
  );
  mocks.decryptSnapshot.mockResolvedValue(membership({ todo: ["shared"] }));
  const inviteHash = createBannerTogetherRoomInviteHash({
    roomKey: ROOM_KEY,
    joinCapability: JOIN_CAPABILITY,
  });

  renderPage({ roomId: ROOM_ID, hash: inviteHash });
  fireEvent.click(
    await screen.findByRole("button", { name: /join and share my lists/i })
  );

  expect(await screen.findByText("The first share failed.")).toBeInTheDocument();
  expect(screen.getByTestId("location-hash").textContent).toBe("");
  expect(loadBannerTogetherRoomAccess(ROOM_ID)).toMatchObject({
    role: "guest",
    capability: GUEST_CAPABILITY,
  });
});

test("reuses the guest capability after an uncertain join and page reload", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["shared"] }));
  mocks.getRoom.mockResolvedValue(
    roomResponse({
      owner: {
        sequence: 1,
        updatedAt: new Date().toISOString(),
        envelope: ENVELOPE,
      },
      guest: {
        sequence: 1,
        updatedAt: new Date().toISOString(),
        envelope: ENVELOPE,
      },
    })
  );
  mocks.decryptSnapshot.mockResolvedValue(membership({ todo: ["shared"] }));
  mocks.joinRoom
    .mockRejectedValueOnce(new Error("The join response was interrupted."))
    .mockResolvedValueOnce({ joined: true });
  const inviteHash = createBannerTogetherRoomInviteHash({
    roomKey: ROOM_KEY,
    joinCapability: JOIN_CAPABILITY,
  });

  const firstRender = renderPage({ roomId: ROOM_ID, hash: inviteHash });
  fireEvent.click(await screen.findByRole("button", {
    name: /join and share my lists/i,
  }));

  expect(
    await screen.findByText("The join response was interrupted.")
  ).toBeInTheDocument();
  firstRender.unmount();

  renderPage({ roomId: ROOM_ID, hash: inviteHash });
  fireEvent.click(
    await screen.findByRole("button", { name: /join and share my lists/i })
  );

  await waitFor(() => expect(mocks.joinRoom).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Joined and shared your lists.")).toBeInTheDocument();
  expect(mocks.createGuestAccess).toHaveBeenCalledTimes(1);
  expect(mocks.joinRoom.mock.calls[0][0].guestCapabilityHash).toBe(
    mocks.joinRoom.mock.calls[1][0].guestCapabilityHash
  );
});

test("recovers when a published snapshot committed but its response was lost", async () => {
  authenticate();
  const ownMembership = membership({ todo: ["shared", "new-own"] });
  const ownerSnapshot = membership({ todo: ["shared"] });
  mocks.fetchMembership.mockResolvedValue(ownMembership);
  mocks.putSnapshot.mockRejectedValueOnce(
    Object.assign(new Error("The upload response was interrupted."), {
      status: 409,
      currentSequence: 1,
    })
  );
  mocks.getRoom.mockResolvedValue(
    roomResponse({
      owner: {
        sequence: 1,
        updatedAt: new Date().toISOString(),
        envelope: ENVELOPE,
      },
      guest: {
        sequence: 1,
        updatedAt: new Date().toISOString(),
        envelope: ENVELOPE,
      },
    })
  );
  mocks.decryptSnapshot.mockImplementation(({ participant }) =>
    Promise.resolve(participant === "guest" ? ownMembership : ownerSnapshot)
  );
  const inviteHash = createBannerTogetherRoomInviteHash({
    roomKey: ROOM_KEY,
    joinCapability: JOIN_CAPABILITY,
  });

  renderPage({ roomId: ROOM_ID, hash: inviteHash });
  fireEvent.click(
    await screen.findByRole("button", { name: /join and share my lists/i })
  );

  expect(await screen.findByText("Joined and shared your lists.")).toBeInTheDocument();
  expect(loadBannerTogetherRoomAccess(ROOM_ID).highestSequences.guest).toBe(1);
  expect(mocks.deleteRoom).not.toHaveBeenCalled();
});

test("keeps clipboard failure feedback after navigating into a created room", async () => {
  authenticate();
  mocks.fetchMembership.mockResolvedValue(membership({ todo: ["shared"] }));
  navigator.clipboard.writeText.mockRejectedValueOnce(new Error("Clipboard blocked."));

  renderPage();
  fireEvent.click(
    await screen.findByRole("button", { name: /create and copy invite/i })
  );

  expect(
    await screen.findByText("The room was created, but the invite could not be copied.")
  ).toBeInTheDocument();
});
