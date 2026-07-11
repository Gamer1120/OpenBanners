import { webcrypto } from "node:crypto";
import {
  BANNER_TOGETHER_ROOM_API_BASE_PATH,
  BannerTogetherRoomApiError,
  createBannerTogetherRoom,
  deleteBannerTogetherRoom,
  getBannerTogetherRoom,
  joinBannerTogetherRoom,
  putBannerTogetherRoomSnapshot,
} from "./bannerTogetherRoomApi";
import {
  BANNER_TOGETHER_ROOM_MAX_CIPHERTEXT_BYTES,
  createBannerTogetherRoomGuestAccess,
  createBannerTogetherRoomSecrets,
  encryptBannerTogetherRoomSnapshot,
} from "./bannerTogetherRoomCrypto";

const TEST_ROOM_ID = "AAECAwQFBgcICQoLDA0ODw";
const OTHER_ROOM_ID = "AQIDBAUGBwgJCgsMDQ4PEA";
const TEST_PLACE_ID = "enschede-place";
const TEST_EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const TEST_UPDATED_AT = new Date().toISOString();
const BANNERGRESS_ACCESS_TOKEN = "bannergress-access-token-must-not-leak";
const BANNERGRESS_REFRESH_TOKEN = "bannergress-refresh-token-must-not-leak";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  global.fetch = vi.fn();
  window.localStorage.clear();
  window.localStorage.setItem(
    "openbanners-bannergress-auth",
    JSON.stringify({
      accessToken: BANNERGRESS_ACCESS_TOKEN,
      refreshToken: BANNERGRESS_REFRESH_TOKEN,
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function serializeFetchCall([url, options]) {
  return JSON.stringify({
    url,
    options: {
      ...options,
      headers: [...new Headers(options.headers).entries()],
    },
  });
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

test("keeps the largest accepted encrypted PUT body below the outer proxy limit", () => {
  const maximumEnvelope = {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: bytesToBase64Url(new Uint8Array(12)),
    ciphertext: bytesToBase64Url(
      new Uint8Array(BANNER_TOGETHER_ROOM_MAX_CIPHERTEXT_BYTES)
    ),
  };
  const putBody = JSON.stringify({
    version: 2,
    expectedSequence: 2147483646,
    envelope: maximumEnvelope,
  });

  expect(new TextEncoder().encode(putBody).byteLength).toBeLessThan(1000000);
});

test("uses only same-origin native fetch and never sends room keys or Bannergress tokens", async () => {
  const secrets = await createBannerTogetherRoomSecrets();
  const guestAccess = await createBannerTogetherRoomGuestAccess();
  const firstEnvelope = await encryptBannerTogetherRoomSnapshot({
    roomKey: secrets.roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "owner",
    sequence: 1,
    lists: { todo: ["one"], done: [], blacklist: [] },
  });
  const secondEnvelope = await encryptBannerTogetherRoomSnapshot({
    roomKey: secrets.roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "owner",
    sequence: 2,
    lists: { todo: ["one", "two"], done: [], blacklist: [] },
  });

  global.fetch
    .mockResolvedValueOnce(
      jsonResponse(
        {
          version: 2,
          roomId: TEST_ROOM_ID,
          expiresAt: TEST_EXPIRES_AT,
        },
        201
      )
    )
    .mockResolvedValueOnce(emptyResponse())
    .mockResolvedValueOnce(
      jsonResponse({
        version: 2,
        roomId: TEST_ROOM_ID,
        expiresAt: TEST_EXPIRES_AT,
        joined: true,
        snapshots: {
          owner: {
            sequence: 1,
            updatedAt: TEST_UPDATED_AT,
            envelope: firstEnvelope,
          },
          guest: null,
        },
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        version: 2,
        role: "owner",
        sequence: 2,
        updatedAt: TEST_UPDATED_AT,
      })
    )
    .mockResolvedValueOnce(emptyResponse());

  await expect(
    createBannerTogetherRoom({
      ownerCapabilityHash: secrets.ownerCapabilityHash,
      joinCapabilityHash: secrets.joinCapabilityHash,
      idempotencyKey: "create-request-01",
    })
  ).resolves.toMatchObject({ roomId: TEST_ROOM_ID });
  await expect(
    joinBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      joinCapability: secrets.joinCapability,
      guestCapabilityHash: guestAccess.guestCapabilityHash,
    })
  ).resolves.toEqual({ joined: true });
  await expect(
    getBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      capability: secrets.ownerCapability,
    })
  ).resolves.toMatchObject({
    roomId: TEST_ROOM_ID,
    joined: true,
    snapshots: { owner: { sequence: 1 }, guest: null },
  });
  await expect(
    putBannerTogetherRoomSnapshot({
      roomId: TEST_ROOM_ID,
      role: "owner",
      capability: secrets.ownerCapability,
      expectedSequence: 1,
      envelope: secondEnvelope,
    })
  ).resolves.toMatchObject({ role: "owner", sequence: 2 });
  await expect(
    deleteBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      ownerCapability: secrets.ownerCapability,
    })
  ).resolves.toEqual({ deleted: true });

  expect(global.fetch).toHaveBeenCalledTimes(5);
  global.fetch.mock.calls.forEach(([url, options]) => {
    expect(url).toMatch(
      new RegExp(`^${BANNER_TOGETHER_ROOM_API_BASE_PATH}`)
    );
    expect(url).not.toMatch(/^https?:/);
    expect(options).toMatchObject({
      credentials: "omit",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  const serializedCalls = global.fetch.mock.calls
    .map(serializeFetchCall)
    .join("\n");
  expect(serializedCalls).not.toContain(secrets.roomKey);
  expect(serializedCalls).not.toContain(BANNERGRESS_ACCESS_TOKEN);
  expect(serializedCalls).not.toContain(BANNERGRESS_REFRESH_TOKEN);

  const createCall = serializeFetchCall(global.fetch.mock.calls[0]);
  expect(createCall).toContain(secrets.ownerCapabilityHash);
  expect(createCall).toContain(secrets.joinCapabilityHash);
  expect(createCall).not.toContain(secrets.ownerCapability);
  expect(createCall).not.toContain(secrets.joinCapability);

  const joinCall = serializeFetchCall(global.fetch.mock.calls[1]);
  expect(joinCall).toContain(guestAccess.guestCapabilityHash);
  expect(joinCall).not.toContain(guestAccess.guestCapability);
});

test("sends exact CAS update fields and exposes a nested conflict sequence", async () => {
  const secrets = await createBannerTogetherRoomSecrets();
  const envelope = await encryptBannerTogetherRoomSnapshot({
    roomKey: secrets.roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "guest",
    sequence: 4,
    lists: { todo: [], done: ["done-one"], blacklist: [] },
  });
  global.fetch.mockResolvedValueOnce(
    jsonResponse(
      {
        error: {
          code: "stale_sequence",
          message: "Snapshot sequence is stale.",
          currentSequence: 8,
        },
      },
      409
    )
  );

  const error = await putBannerTogetherRoomSnapshot({
    roomId: TEST_ROOM_ID,
    role: "guest",
    capability: secrets.ownerCapability,
    expectedSequence: 3,
    envelope,
  }).catch((caughtError) => caughtError);

  expect(error).toBeInstanceOf(BannerTogetherRoomApiError);
  expect(error).toMatchObject({
    code: "stale_sequence",
    status: 409,
    currentSequence: 8,
    message: "Snapshot sequence is stale.",
  });
  const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(Object.keys(requestBody)).toEqual([
    "version",
    "expectedSequence",
    "envelope",
  ]);
  expect(requestBody).toEqual({
    version: 2,
    expectedSequence: 3,
    envelope,
  });
});

test("rejects malformed or cross-room service responses", async () => {
  const secrets = await createBannerTogetherRoomSecrets();
  global.fetch.mockResolvedValueOnce(
    jsonResponse({
      version: 2,
      roomId: OTHER_ROOM_ID,
      expiresAt: TEST_EXPIRES_AT,
      joined: false,
      snapshots: { owner: null, guest: null },
    })
  );

  await expect(
    getBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      capability: secrets.ownerCapability,
    })
  ).rejects.toMatchObject({ code: "INVALID_ROOM_RESPONSE" });

  global.fetch.mockResolvedValueOnce(
    jsonResponse({
      version: 2,
      roomId: TEST_ROOM_ID,
      expiresAt: TEST_EXPIRES_AT,
      joined: "yes",
      snapshots: { owner: null, guest: null },
    })
  );
  await expect(
    getBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      capability: secrets.ownerCapability,
    })
  ).rejects.toMatchObject({ code: "INVALID_ROOM_RESPONSE" });
});

test("rejects invalid capabilities before making a room request", async () => {
  await expect(
    getBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      capability: BANNERGRESS_ACCESS_TOKEN,
    })
  ).rejects.toThrow(/capability/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("requires an idempotency key before creating a room request", async () => {
  const secrets = await createBannerTogetherRoomSecrets();

  await expect(
    createBannerTogetherRoom({
      ownerCapabilityHash: secrets.ownerCapabilityHash,
      joinCapabilityHash: secrets.joinCapabilityHash,
    })
  ).rejects.toThrow(/idempotency key/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("preserves abort errors while reading success and error response bodies", async () => {
  const secrets = await createBannerTogetherRoomSecrets();
  const successAbort = new DOMException("The request was aborted.", "AbortError");
  const errorAbort = new DOMException("The request was aborted.", "AbortError");

  global.fetch
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(successAbort),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: vi.fn().mockRejectedValue(errorAbort),
    });

  await expect(
    getBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      capability: secrets.ownerCapability,
    })
  ).rejects.toBe(successAbort);
  await expect(
    getBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      capability: secrets.ownerCapability,
    })
  ).rejects.toBe(errorAbort);
});

test("wraps malformed nested service fields as invalid room responses", async () => {
  const secrets = await createBannerTogetherRoomSecrets();
  const envelope = await encryptBannerTogetherRoomSnapshot({
    roomKey: secrets.roomKey,
    roomId: TEST_ROOM_ID,
    placeId: TEST_PLACE_ID,
    participant: "owner",
    sequence: 1,
    lists: { todo: ["one"], done: [], blacklist: [] },
  });
  const expectInvalidResponse = async (request) => {
    const error = await request.catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(BannerTogetherRoomApiError);
    expect(error).toMatchObject({ code: "INVALID_ROOM_RESPONSE" });
  };

  global.fetch.mockResolvedValueOnce(
    jsonResponse(
      {
        version: 2,
        roomId: "not-a-room-id",
        expiresAt: TEST_EXPIRES_AT,
      },
      201
    )
  );
  await expectInvalidResponse(
    createBannerTogetherRoom({
      ownerCapabilityHash: secrets.ownerCapabilityHash,
      joinCapabilityHash: secrets.joinCapabilityHash,
      idempotencyKey: "create-request-02",
    })
  );

  global.fetch.mockResolvedValueOnce(
    jsonResponse({
      version: 2,
      roomId: TEST_ROOM_ID,
      expiresAt: TEST_EXPIRES_AT,
      joined: true,
      snapshots: {
        owner: {
          sequence: 0,
          updatedAt: TEST_UPDATED_AT,
          envelope,
        },
        guest: null,
      },
    })
  );
  await expectInvalidResponse(
    getBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      capability: secrets.ownerCapability,
    })
  );

  global.fetch.mockResolvedValueOnce(
    jsonResponse({
      version: 2,
      roomId: TEST_ROOM_ID,
      expiresAt: TEST_EXPIRES_AT,
      joined: true,
      snapshots: {
        owner: {
          sequence: 1,
          updatedAt: TEST_UPDATED_AT,
          envelope: { ...envelope, accessToken: "must-not-be-accepted" },
        },
        guest: null,
      },
    })
  );
  await expectInvalidResponse(
    getBannerTogetherRoom({
      roomId: TEST_ROOM_ID,
      capability: secrets.ownerCapability,
    })
  );

  global.fetch.mockResolvedValueOnce(
    jsonResponse({
      version: 2,
      role: "owner",
      sequence: 0,
      updatedAt: TEST_UPDATED_AT,
    })
  );
  await expectInvalidResponse(
    putBannerTogetherRoomSnapshot({
      roomId: TEST_ROOM_ID,
      role: "owner",
      capability: secrets.ownerCapability,
      expectedSequence: 0,
      envelope,
    })
  );
});
