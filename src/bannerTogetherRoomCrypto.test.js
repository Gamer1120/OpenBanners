import { webcrypto } from "node:crypto";
import {
  BANNER_TOGETHER_ROOM_ACCESS_STORAGE_PREFIX,
  BANNER_TOGETHER_ROOM_HASH_PREFIX,
  BANNER_TOGETHER_ROOM_MAX_AGE_MS,
  BANNER_TOGETHER_ROOM_MAX_BANNER_IDS,
  BANNER_TOGETHER_ROOM_PADDING_BYTES,
  BANNER_TOGETHER_PENDING_JOIN_STORAGE_PREFIX,
  clearBannerTogetherPendingJoin,
  clearBannerTogetherRoomAccess,
  createBannerTogetherRoomGuestAccess,
  createBannerTogetherRoomInviteHash,
  createBannerTogetherRoomInviteUrl,
  createBannerTogetherRoomSecrets,
  decryptBannerTogetherRoomSnapshot,
  encryptBannerTogetherRoomSnapshot,
  hashBannerTogetherRoomCapability,
  loadBannerTogetherPendingJoin,
  loadBannerTogetherRoomAccess,
  parseBannerTogetherRoomInviteHash,
  saveBannerTogetherPendingJoin,
  saveBannerTogetherRoomAccess,
  validateBannerTogetherRoomEncryptedEnvelope,
} from "./bannerTogetherRoomCrypto";

const TEST_ROOM_ID = "AAECAwQFBgcICQoLDA0ODw";
const OTHER_ROOM_ID = "AQIDBAUGBwgJCgsMDQ4PEA";
const TEST_PLACE_ID = "東京 centrum";
const TEST_CAPTURED_AT = new Date().toISOString();

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createLists(overrides = {}) {
  return {
    todo: ["todo-beta", "todo-alpha"],
    done: ["done-café"],
    blacklist: ["hidden-旗"],
    ...overrides,
  };
}

function replaceFirstBase64UrlCharacter(value) {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

test("generates independent client secrets and SHA-256 capability verifiers", async () => {
  const secrets = await createBannerTogetherRoomSecrets();
  const guestAccess = await createBannerTogetherRoomGuestAccess();

  expect(secrets.roomKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(secrets.ownerCapability).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(secrets.joinCapability).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(guestAccess.guestCapability).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(
    new Set([
      secrets.roomKey,
      secrets.ownerCapability,
      secrets.joinCapability,
      guestAccess.guestCapability,
    ])
  ).toHaveProperty("size", 4);
  await expect(
    hashBannerTogetherRoomCapability(secrets.ownerCapability)
  ).resolves.toBe(secrets.ownerCapabilityHash);
  await expect(
    hashBannerTogetherRoomCapability(secrets.joinCapability)
  ).resolves.toBe(secrets.joinCapabilityHash);
  await expect(
    hashBannerTogetherRoomCapability(guestAccess.guestCapability)
  ).resolves.toBe(guestAccess.guestCapabilityHash);
  expect(secrets.ownerCapabilityHash).not.toBe(secrets.ownerCapability);
});

test("builds a bounded room invite with room ID in the path and secrets in the fragment", async () => {
  const secrets = await createBannerTogetherRoomSecrets();
  const inviteUrl = createBannerTogetherRoomInviteUrl({
    origin: "https://openbanners.org/ignored/path",
    placeId: TEST_PLACE_ID,
    roomId: TEST_ROOM_ID,
    roomKey: secrets.roomKey,
    joinCapability: secrets.joinCapability,
  });
  const parsedUrl = new URL(inviteUrl);

  expect(decodeURIComponent(parsedUrl.pathname)).toBe(
    `/together/${TEST_PLACE_ID}/room/${TEST_ROOM_ID}`
  );
  expect(parsedUrl.hash).toBe(
    `${BANNER_TOGETHER_ROOM_HASH_PREFIX}v2.${secrets.roomKey}.${secrets.joinCapability}`
  );
  expect(parsedUrl.pathname).not.toContain(secrets.roomKey);
  expect(parsedUrl.pathname).not.toContain(secrets.joinCapability);
  expect(inviteUrl.length).toBeLessThan(250);
  expect(
    parseBannerTogetherRoomInviteHash(parsedUrl.hash, {
      roomId: TEST_ROOM_ID,
      placeId: TEST_PLACE_ID,
    })
  ).toEqual({
    version: 2,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    roomKey: secrets.roomKey,
    joinCapability: secrets.joinCapability,
  });
});

test("rejects malformed room invite fragments and invalid route context", async () => {
  const secrets = await createBannerTogetherRoomSecrets();
  const hash = createBannerTogetherRoomInviteHash({
    roomKey: secrets.roomKey,
    joinCapability: secrets.joinCapability,
  });

  expect(() =>
    parseBannerTogetherRoomInviteHash(hash, {
      roomId: "not-a-room-id",
      placeId: TEST_PLACE_ID,
    })
  ).toThrow(/room ID/i);
  expect(() =>
    parseBannerTogetherRoomInviteHash(
      `${hash}.extra`,
      { roomId: TEST_ROOM_ID, placeId: TEST_PLACE_ID }
    )
  ).toThrow(/unsupported format/i);
  expect(() =>
    parseBannerTogetherRoomInviteHash("#banner-together=raw.abc", {
      roomId: TEST_ROOM_ID,
      placeId: TEST_PLACE_ID,
    })
  ).toThrow(/prefix/i);
});

test("round trips a padded, sorted, place-scoped room snapshot", async () => {
  const { roomKey } = await createBannerTogetherRoomSecrets();
  const envelope = await encryptBannerTogetherRoomSnapshot({
    roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "owner",
    sequence: 1,
    capturedAt: TEST_CAPTURED_AT,
    lists: createLists(),
  });
  const ciphertextByteLength = Math.floor(
    (envelope.ciphertext.length * 3) / 4
  );

  expect(envelope).toMatchObject({
    version: 1,
    algorithm: "AES-256-GCM",
  });
  expect(envelope.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
  expect(ciphertextByteLength).toBe(
    BANNER_TOGETHER_ROOM_PADDING_BYTES + 16
  );
  await expect(
    decryptBannerTogetherRoomSnapshot({
      roomKey,
      roomId: TEST_ROOM_ID,
      placeId: TEST_PLACE_ID,
      participant: "owner",
      sequence: 1,
      envelope,
    })
  ).resolves.toEqual({
    version: 2,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "owner",
    sequence: 1,
    capturedAt: TEST_CAPTURED_AT,
    lists: {
      todo: ["todo-alpha", "todo-beta"],
      done: ["done-café"],
      blacklist: ["hidden-旗"],
    },
  });
});

test("uses fresh IVs and ciphertext for the same snapshot", async () => {
  const { roomKey } = await createBannerTogetherRoomSecrets();
  const options = {
    roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "owner",
    sequence: 1,
    capturedAt: TEST_CAPTURED_AT,
    lists: createLists(),
  };
  const firstEnvelope = await encryptBannerTogetherRoomSnapshot(options);
  const secondEnvelope = await encryptBannerTogetherRoomSnapshot(options);

  expect(firstEnvelope.iv).not.toBe(secondEnvelope.iv);
  expect(firstEnvelope.ciphertext).not.toBe(secondEnvelope.ciphertext);
});

test.each([
  ["different room", { roomId: OTHER_ROOM_ID }],
  ["different place", { placeId: "different-place" }],
  ["different participant", { participant: "guest" }],
  ["different sequence", { sequence: 2 }],
])("rejects a snapshot authenticated for a %s", async (_label, overrides) => {
  const { roomKey } = await createBannerTogetherRoomSecrets();
  const envelope = await encryptBannerTogetherRoomSnapshot({
    roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "owner",
    sequence: 1,
    capturedAt: TEST_CAPTURED_AT,
    lists: createLists(),
  });

  await expect(
    decryptBannerTogetherRoomSnapshot({
      roomKey,
      roomId: TEST_ROOM_ID,
      placeId: TEST_PLACE_ID,
      participant: "owner",
      sequence: 1,
      envelope,
      ...overrides,
    })
  ).rejects.toThrow(/authenticated/i);
});

test("rejects the wrong room key and tampered ciphertext", async () => {
  const { roomKey } = await createBannerTogetherRoomSecrets();
  const { roomKey: wrongRoomKey } = await createBannerTogetherRoomSecrets();
  const envelope = await encryptBannerTogetherRoomSnapshot({
    roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "guest",
    sequence: 3,
    capturedAt: TEST_CAPTURED_AT,
    lists: createLists(),
  });
  const decryptOptions = {
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "guest",
    sequence: 3,
    envelope,
  };

  await expect(
    decryptBannerTogetherRoomSnapshot({
      ...decryptOptions,
      roomKey: wrongRoomKey,
    })
  ).rejects.toThrow(/authenticated/i);
  await expect(
    decryptBannerTogetherRoomSnapshot({
      ...decryptOptions,
      roomKey,
      envelope: {
        ...envelope,
        ciphertext: replaceFirstBase64UrlCharacter(envelope.ciphertext),
      },
    })
  ).rejects.toThrow(/authenticated/i);
});

test("rejects ambiguous list membership, excessive IDs, and oversized JSON", async () => {
  const { roomKey } = await createBannerTogetherRoomSecrets();
  const baseOptions = {
    roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "owner",
    sequence: 1,
    capturedAt: TEST_CAPTURED_AT,
  };

  await expect(
    encryptBannerTogetherRoomSnapshot({
      ...baseOptions,
      lists: createLists({
        todo: ["duplicate"],
        done: ["duplicate"],
      }),
    })
  ).rejects.toThrow(/only one/i);

  const excessiveIds = Array.from(
    { length: BANNER_TOGETHER_ROOM_MAX_BANNER_IDS + 1 },
    (_value, index) => `banner-${index}`
  );
  await expect(
    encryptBannerTogetherRoomSnapshot({
      ...baseOptions,
      lists: { todo: excessiveIds, done: [], blacklist: [] },
    })
  ).rejects.toThrow(/at most/i);

  const oversizedIds = Array.from({ length: 5000 }, (_value, index) =>
    `${String(index).padStart(5, "0")}-${"x".repeat(245)}`
  );
  await expect(
    encryptBannerTogetherRoomSnapshot({
      ...baseOptions,
      lists: { todo: oversizedIds, done: [], blacklist: [] },
    })
  ).rejects.toThrow(/JSON is too large/i);
});

test("rejects stale snapshots and malformed encrypted envelopes", async () => {
  const now = Date.now();
  const { roomKey } = await createBannerTogetherRoomSecrets();
  const envelope = await encryptBannerTogetherRoomSnapshot({
    roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "owner",
    sequence: 1,
    capturedAt: new Date(now).toISOString(),
    lists: createLists(),
    now,
  });

  await expect(
    decryptBannerTogetherRoomSnapshot({
      roomKey,
      roomId: TEST_ROOM_ID,
      placeId: TEST_PLACE_ID,
      participant: "owner",
      sequence: 1,
      envelope,
      now: now + BANNER_TOGETHER_ROOM_MAX_AGE_MS + 1,
    })
  ).rejects.toThrow(/expired/i);
  expect(() =>
    validateBannerTogetherRoomEncryptedEnvelope({
      ...envelope,
      accessToken: "must-not-be-accepted",
    })
  ).toThrow(/unexpected fields/i);
  expect(() =>
    validateBannerTogetherRoomEncryptedEnvelope({
      ...envelope,
      ciphertext: Buffer.from(
        new Uint8Array(BANNER_TOGETHER_ROOM_PADDING_BYTES + 17)
      ).toString("base64url"),
    })
  ).toThrow(/invalid size/i);
});

test("stores strict owner and guest room access records and removes expired data", async () => {
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  const secrets = await createBannerTogetherRoomSecrets();
  const guestAccess = await createBannerTogetherRoomGuestAccess();
  const ownerRecord = {
    version: 2,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    role: "owner",
    roomKey: secrets.roomKey,
    capability: secrets.ownerCapability,
    joinCapability: secrets.joinCapability,
    expiresAt,
    highestSequences: { owner: 1, guest: 0 },
  };

  expect(saveBannerTogetherRoomAccess(ownerRecord, { now })).toEqual(
    ownerRecord
  );
  expect(loadBannerTogetherRoomAccess(TEST_ROOM_ID, { now })).toEqual(
    ownerRecord
  );
  expect(
    window.localStorage.getItem(
      `${BANNER_TOGETHER_ROOM_ACCESS_STORAGE_PREFIX}${TEST_ROOM_ID}`
    )
  ).not.toContain("accessToken");

  expect(() =>
    saveBannerTogetherRoomAccess(
      {
        ...ownerRecord,
        role: "guest",
        capability: guestAccess.guestCapability,
      },
      { now }
    )
  ).toThrow(/guest.*join capability/i);

  expect(
    loadBannerTogetherRoomAccess(TEST_ROOM_ID, {
      now: new Date(expiresAt).getTime(),
    })
  ).toBeNull();
  expect(
    window.localStorage.getItem(
      `${BANNER_TOGETHER_ROOM_ACCESS_STORAGE_PREFIX}${TEST_ROOM_ID}`
    )
  ).toBeNull();

  saveBannerTogetherRoomAccess(ownerRecord, { now });
  clearBannerTogetherRoomAccess(TEST_ROOM_ID);
  expect(loadBannerTogetherRoomAccess(TEST_ROOM_ID, { now })).toBeNull();
});

test("keeps highest room sequences monotonic across stale access saves", async () => {
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  const secrets = await createBannerTogetherRoomSecrets();
  const initialRecord = {
    version: 2,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    role: "owner",
    roomKey: secrets.roomKey,
    capability: secrets.ownerCapability,
    joinCapability: secrets.joinCapability,
    expiresAt,
    highestSequences: { owner: 1, guest: 1 },
  };

  saveBannerTogetherRoomAccess(initialRecord, { now });
  const staleOwnerUpdate = loadBannerTogetherRoomAccess(TEST_ROOM_ID, { now });
  const staleGuestUpdate = loadBannerTogetherRoomAccess(TEST_ROOM_ID, { now });

  saveBannerTogetherRoomAccess(
    {
      ...staleOwnerUpdate,
      highestSequences: { owner: 2, guest: 1 },
    },
    { now }
  );
  expect(
    saveBannerTogetherRoomAccess(
      {
        ...staleGuestUpdate,
        highestSequences: { owner: 1, guest: 3 },
      },
      { now }
    ).highestSequences
  ).toEqual({ owner: 2, guest: 3 });
  expect(
    loadBannerTogetherRoomAccess(TEST_ROOM_ID, { now }).highestSequences
  ).toEqual({ owner: 2, guest: 3 });
});

test("persists a strict pending guest claim until it succeeds or expires", async () => {
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  const secrets = await createBannerTogetherRoomSecrets();
  const guestAccess = await createBannerTogetherRoomGuestAccess();
  const pendingJoin = {
    version: 2,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    roomKey: secrets.roomKey,
    joinCapability: secrets.joinCapability,
    guestCapability: guestAccess.guestCapability,
    expiresAt,
  };

  expect(saveBannerTogetherPendingJoin(pendingJoin, { now })).toEqual(
    pendingJoin
  );
  expect(loadBannerTogetherPendingJoin(TEST_ROOM_ID, { now })).toEqual(
    pendingJoin
  );
  expect(
    window.localStorage.getItem(
      `${BANNER_TOGETHER_PENDING_JOIN_STORAGE_PREFIX}${TEST_ROOM_ID}`
    )
  ).not.toContain("accessToken");

  expect(
    loadBannerTogetherPendingJoin(TEST_ROOM_ID, {
      now: new Date(expiresAt).getTime(),
    })
  ).toBeNull();

  saveBannerTogetherPendingJoin(pendingJoin, { now });
  clearBannerTogetherPendingJoin(TEST_ROOM_ID);
  expect(loadBannerTogetherPendingJoin(TEST_ROOM_ID, { now })).toBeNull();
});
