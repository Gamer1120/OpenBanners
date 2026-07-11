import { webcrypto } from "node:crypto";
import {
  BANNER_TOGETHER_LIVE_HASH_PREFIX,
  BANNER_TOGETHER_LIVE_MAX_AGE_MS,
  BANNER_TOGETHER_LIVE_VERSION,
  clearBannerTogetherLiveAccess,
  clearBannerTogetherLivePendingJoin,
  createBannerTogetherLiveInviteUrl,
  createBannerTogetherLiveParticipantIdentity,
  createBannerTogetherLiveSecrets,
  decryptBannerTogetherLiveSnapshot,
  encryptBannerTogetherLiveSnapshot,
  hashBannerTogetherLiveRoomSecret,
  loadBannerTogetherLiveAccess,
  loadBannerTogetherLivePendingJoin,
  parseBannerTogetherLiveInviteHash,
  saveBannerTogetherLiveAccess,
  saveBannerTogetherLivePendingJoin,
} from "./bannerTogetherLiveCrypto";

const ROOM_ID = "AAECAwQFBgcICQoLDA0ODw";
const OTHER_ROOM_ID = "AQIDBAUGBwgJCgsMDQ4PEA";
const PLACE_ID = "utrecht centrum";
const NOW = Date.now();
const CAPTURED_AT = new Date(NOW).toISOString();
const EXPIRES_AT = new Date(NOW + 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("creates independent room and participant identity material", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  const secondIdentity = createBannerTogetherLiveParticipantIdentity();

  expect(secrets).toMatchObject({
    roomSecret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    roomVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    participantId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    participantVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  });
  expect(secondIdentity.participantId).not.toBe(secrets.participantId);
  expect(secondIdentity.participantVerifier).not.toBe(
    secrets.participantVerifier
  );
  await expect(
    hashBannerTogetherLiveRoomSecret(secrets.roomSecret)
  ).resolves.toBe(secrets.roomVerifier);
  expect(secrets.roomVerifier).not.toBe(secrets.roomSecret);
});

test("regenerates a participant identity on the theoretical verifier collision", async () => {
  const fills = [1, 2, 9, 3, 4];
  const collisionCrypto = {
    subtle: {
      digest: vi.fn().mockResolvedValue(
        new Uint8Array(32).fill(9).buffer
      ),
    },
    getRandomValues: vi.fn((bytes) => {
      bytes.fill(fills.shift());
      return bytes;
    }),
  };
  vi.stubGlobal("crypto", collisionCrypto);

  const secrets = await createBannerTogetherLiveSecrets();

  expect(secrets.participantVerifier).not.toBe(secrets.roomVerifier);
  expect(collisionCrypto.getRandomValues).toHaveBeenCalledTimes(5);
});

test("keeps the room secret only in a short invite fragment", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  const inviteUrl = createBannerTogetherLiveInviteUrl({
    origin: "https://openbanners.org/ignored?query=yes#old",
    placeId: PLACE_ID,
    roomId: ROOM_ID,
    roomSecret: secrets.roomSecret,
  });
  const url = new URL(inviteUrl);

  expect(decodeURIComponent(url.pathname)).toBe(
    `/together/${PLACE_ID}/live/${ROOM_ID}`
  );
  expect(url.search).toBe("");
  expect(url.hash).toBe(
    `${BANNER_TOGETHER_LIVE_HASH_PREFIX}v1.${secrets.roomSecret}`
  );
  expect(url.pathname).not.toContain(secrets.roomSecret);
  expect(inviteUrl.length).toBeLessThan(220);
  expect(
    parseBannerTogetherLiveInviteHash(url.hash, {
      roomId: ROOM_ID,
      placeId: PLACE_ID,
    })
  ).toEqual({
    version: 1,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    roomSecret: secrets.roomSecret,
  });
});

test("round trips a sorted participant-bound encrypted snapshot", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  const envelope = await encryptBannerTogetherLiveSnapshot({
    roomSecret: secrets.roomSecret,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    participantId: secrets.participantId,
    sequence: 4,
    capturedAt: CAPTURED_AT,
    now: NOW,
    lists: {
      todo: ["todo-z", "todo-a"],
      done: ["done-one"],
      blacklist: ["hidden-one"],
    },
  });

  expect(envelope).toMatchObject({
    version: 1,
    algorithm: "AES-256-GCM",
    iv: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/),
  });
  await expect(
    decryptBannerTogetherLiveSnapshot({
      roomSecret: secrets.roomSecret,
      roomId: ROOM_ID,
      placeId: PLACE_ID,
      participantId: secrets.participantId,
      sequence: 4,
      envelope,
      now: NOW,
    })
  ).resolves.toEqual({
    version: 1,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    participantId: secrets.participantId,
    sequence: 4,
    capturedAt: CAPTURED_AT,
    lists: {
      todo: ["todo-a", "todo-z"],
      done: ["done-one"],
      blacklist: ["hidden-one"],
    },
  });
});

test("rejects tampering, wrong context, stale data, and ambiguous membership", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  const envelope = await encryptBannerTogetherLiveSnapshot({
    roomSecret: secrets.roomSecret,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    participantId: secrets.participantId,
    sequence: 1,
    capturedAt: CAPTURED_AT,
    now: NOW,
    lists: { todo: ["one"], done: [], blacklist: [] },
  });

  await expect(
    decryptBannerTogetherLiveSnapshot({
      roomSecret: secrets.roomSecret,
      roomId: OTHER_ROOM_ID,
      placeId: PLACE_ID,
      participantId: secrets.participantId,
      sequence: 1,
      envelope,
      now: NOW,
    })
  ).rejects.toThrow(/authenticated/i);
  await expect(
    decryptBannerTogetherLiveSnapshot({
      roomSecret: secrets.roomSecret,
      roomId: ROOM_ID,
      placeId: PLACE_ID,
      participantId: secrets.participantId,
      sequence: 1,
      envelope: {
        ...envelope,
        ciphertext: `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}`,
      },
      now: NOW,
    })
  ).rejects.toThrow(/authenticated/i);
  await expect(
    decryptBannerTogetherLiveSnapshot({
      roomSecret: secrets.roomSecret,
      roomId: ROOM_ID,
      placeId: PLACE_ID,
      participantId: secrets.participantId,
      sequence: 1,
      envelope,
      now: NOW + BANNER_TOGETHER_LIVE_MAX_AGE_MS + 1,
    })
  ).rejects.toThrow(/expired/i);
  await expect(
    encryptBannerTogetherLiveSnapshot({
      roomSecret: secrets.roomSecret,
      roomId: ROOM_ID,
      placeId: PLACE_ID,
      participantId: secrets.participantId,
      sequence: 1,
      capturedAt: CAPTURED_AT,
      now: NOW,
      lists: { todo: ["duplicate"], done: ["duplicate"], blacklist: [] },
    })
  ).rejects.toThrow(/only one/i);
});

test("strictly stores expiring access and retry-safe pending join identity", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  const access = {
    version: BANNER_TOGETHER_LIVE_VERSION,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    roomSecret: secrets.roomSecret,
    participantId: secrets.participantId,
    participantVerifier: secrets.participantVerifier,
    participantToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    expiresAt: EXPIRES_AT,
  };
  const pendingJoin = {
    version: BANNER_TOGETHER_LIVE_VERSION,
    roomId: ROOM_ID,
    placeId: PLACE_ID,
    roomSecret: secrets.roomSecret,
    participantId: secrets.participantId,
    participantVerifier: secrets.participantVerifier,
    expiresAt: EXPIRES_AT,
  };

  expect(saveBannerTogetherLiveAccess(access, { now: NOW })).toEqual(access);
  expect(
    loadBannerTogetherLiveAccess(
      { roomId: ROOM_ID, placeId: PLACE_ID },
      { now: NOW }
    )
  ).toEqual(access);
  expect(
    saveBannerTogetherLivePendingJoin(pendingJoin, { now: NOW })
  ).toEqual(pendingJoin);
  expect(
    loadBannerTogetherLivePendingJoin(
      { roomId: ROOM_ID, placeId: PLACE_ID },
      { now: NOW }
    )
  ).toEqual(pendingJoin);

  clearBannerTogetherLiveAccess(ROOM_ID);
  clearBannerTogetherLivePendingJoin(ROOM_ID);
  expect(
    loadBannerTogetherLiveAccess(
      { roomId: ROOM_ID, placeId: PLACE_ID },
      { now: NOW }
    )
  ).toBeNull();
  expect(
    loadBannerTogetherLivePendingJoin(
      { roomId: ROOM_ID, placeId: PLACE_ID },
      { now: NOW }
    )
  ).toBeNull();
});

test("removes malformed or expired local access instead of returning it", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  saveBannerTogetherLiveAccess(
    {
      version: BANNER_TOGETHER_LIVE_VERSION,
      roomId: ROOM_ID,
      placeId: PLACE_ID,
      roomSecret: secrets.roomSecret,
      participantId: secrets.participantId,
      participantVerifier: secrets.participantVerifier,
      participantToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      expiresAt: EXPIRES_AT,
    },
    { now: NOW }
  );

  expect(
    loadBannerTogetherLiveAccess(
      { roomId: ROOM_ID, placeId: PLACE_ID },
      { now: NOW + 2 * 60 * 60 * 1000 }
    )
  ).toBeNull();
});
