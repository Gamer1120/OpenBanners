import {
  BANNER_TOGETHER_ROOM_VERSION,
  validateBannerTogetherRoomCapability,
  validateBannerTogetherRoomCapabilityHash,
  validateBannerTogetherRoomEncryptedEnvelope,
  validateBannerTogetherRoomId,
  validateBannerTogetherRoomRole,
  validateBannerTogetherRoomSequence,
} from "./bannerTogetherRoomCrypto";

export const BANNER_TOGETHER_ROOM_API_BASE_PATH =
  "/_openbanners/banner-together/v2/rooms";

const ROOM_RESPONSE_KEYS = Object.freeze([
  "version",
  "roomId",
  "expiresAt",
  "joined",
  "snapshots",
]);
const SNAPSHOTS_KEYS = Object.freeze(["owner", "guest"]);
const SNAPSHOT_SLOT_KEYS = Object.freeze([
  "sequence",
  "updatedAt",
  "envelope",
]);

export class BannerTogetherRoomApiError extends Error {
  constructor(message, { code, status = null, currentSequence = null } = {}) {
    super(message);
    this.name = "BannerTogetherRoomApiError";
    this.code = code ?? "ROOM_REQUEST_FAILED";
    this.status = status;
    this.currentSequence = currentSequence;
  }
}

function normalizeResponseValue(normalizeValue, label) {
  try {
    return normalizeValue();
  } catch (error) {
    if (error instanceof BannerTogetherRoomApiError) {
      throw error;
    }

    throw new BannerTogetherRoomApiError(`${label} is invalid.`, {
      code: "INVALID_ROOM_RESPONSE",
    });
  }
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BannerTogetherRoomApiError(`${label} must be an object.`, {
      code: "INVALID_ROOM_RESPONSE",
    });
  }

  const actualKeys = Object.keys(value);

  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => !expectedKeys.includes(key))
  ) {
    throw new BannerTogetherRoomApiError(
      `${label} contains unexpected fields.`,
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  return value;
}

function normalizeCanonicalDate(value, label) {
  if (typeof value !== "string") {
    throw new BannerTogetherRoomApiError(
      `${label} must be an ISO date string.`,
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  const parsedDate = new Date(value);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString() !== value
  ) {
    throw new BannerTogetherRoomApiError(
      `${label} must be a canonical ISO date string.`,
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  return value;
}

function validateIdempotencyKey(idempotencyKey) {
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 16 ||
    idempotencyKey.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)
  ) {
    throw new Error(
      "Room idempotency key must be 16 to 128 base64url characters."
    );
  }

  return idempotencyKey;
}

function getRoomPath(roomId, suffix = "") {
  const normalizedRoomId = validateBannerTogetherRoomId(roomId);
  return `${BANNER_TOGETHER_ROOM_API_BASE_PATH}/${encodeURIComponent(
    normalizedRoomId
  )}${suffix}`;
}

function getErrorDetails(status) {
  if (status === 400) {
    return ["ROOM_INVALID_REQUEST", "The room request was not valid."];
  }

  if (status === 401 || status === 403) {
    return ["ROOM_ACCESS_DENIED", "This browser cannot access that room."];
  }

  if (status === 404) {
    return [
      "ROOM_NOT_FOUND",
      "This room does not exist, has expired, or was ended.",
    ];
  }

  if (status === 409) {
    return ["ROOM_CONFLICT", "The room changed before this request completed."];
  }

  if (status === 410) {
    return ["ROOM_GONE", "This room has expired or was ended."];
  }

  if (status === 413) {
    return ["ROOM_SNAPSHOT_TOO_LARGE", "The encrypted room snapshot is too large."];
  }

  if (status === 429) {
    return ["ROOM_RATE_LIMITED", "Too many room requests were made."];
  }

  return ["ROOM_REQUEST_FAILED", "The Banner Together room request failed."];
}

async function readOptionalErrorPayload(response) {
  try {
    const payload = await response.json();

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {};
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    return {};
  }
}

async function throwRoomResponseError(response) {
  const [fallbackCode, fallbackMessage] = getErrorDetails(response.status);
  const payload = await readOptionalErrorPayload(response);
  const errorPayload =
    payload.error &&
    typeof payload.error === "object" &&
    !Array.isArray(payload.error)
      ? payload.error
      : payload;
  const currentSequence = Number.isInteger(errorPayload.currentSequence)
    ? errorPayload.currentSequence
    : null;

  throw new BannerTogetherRoomApiError(
    typeof errorPayload.message === "string" && errorPayload.message
      ? errorPayload.message
      : fallbackMessage,
    {
      code:
        typeof errorPayload.code === "string" && errorPayload.code
          ? errorPayload.code
          : fallbackCode,
      status: response.status,
      currentSequence,
    }
  );
}

async function roomFetch(
  path,
  {
    method = "GET",
    capability = null,
    body = null,
    idempotencyKey = null,
    signal = null,
  } = {}
) {
  const headers = new Headers({
    Accept: "application/json",
  });

  if (capability !== null) {
    headers.set(
      "Authorization",
      `Bearer ${validateBannerTogetherRoomCapability(capability)}`
    );
  }

  if (body !== null) {
    headers.set("Content-Type", "application/json");
  }

  if (idempotencyKey !== null) {
    headers.set("Idempotency-Key", validateIdempotencyKey(idempotencyKey));
  }

  try {
    return await fetch(path, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      credentials: "omit",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    throw new BannerTogetherRoomApiError(
      "The Banner Together room service could not be reached.",
      { code: "ROOM_NETWORK_ERROR" }
    );
  }
}

async function readJsonResponse(response, label) {
  try {
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    throw new BannerTogetherRoomApiError(
      `${label} was not valid JSON.`,
      { code: "INVALID_ROOM_RESPONSE", status: response.status }
    );
  }
}

function normalizeCreateResponse(payload) {
  assertExactKeys(
    payload,
    ["version", "roomId", "expiresAt"],
    "Create room response"
  );

  if (payload.version !== BANNER_TOGETHER_ROOM_VERSION) {
    throw new BannerTogetherRoomApiError(
      `Unsupported room response version: ${String(payload.version)}.`,
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  return {
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId: normalizeResponseValue(
      () => validateBannerTogetherRoomId(payload.roomId),
      "Create room response roomId"
    ),
    expiresAt: normalizeCanonicalDate(payload.expiresAt, "Room expiresAt"),
  };
}

function normalizeSnapshotSlot(slot, role) {
  if (slot === null) {
    return null;
  }

  assertExactKeys(slot, SNAPSHOT_SLOT_KEYS, `${role} snapshot slot`);

  return {
    sequence: normalizeResponseValue(
      () => validateBannerTogetherRoomSequence(slot.sequence),
      `${role} snapshot sequence`
    ),
    updatedAt: normalizeCanonicalDate(
      slot.updatedAt,
      `${role} snapshot updatedAt`
    ),
    envelope: normalizeResponseValue(
      () => validateBannerTogetherRoomEncryptedEnvelope(slot.envelope),
      `${role} snapshot envelope`
    ),
  };
}

function normalizeRoomResponse(payload, expectedRoomId) {
  assertExactKeys(payload, ROOM_RESPONSE_KEYS, "Room response");

  if (payload.version !== BANNER_TOGETHER_ROOM_VERSION) {
    throw new BannerTogetherRoomApiError(
      `Unsupported room response version: ${String(payload.version)}.`,
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  const roomId = normalizeResponseValue(
    () => validateBannerTogetherRoomId(payload.roomId),
    "Room response roomId"
  );

  if (roomId !== expectedRoomId) {
    throw new BannerTogetherRoomApiError(
      "Room response belongs to a different room.",
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  if (typeof payload.joined !== "boolean") {
    throw new BannerTogetherRoomApiError(
      "Room response joined state is invalid.",
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  assertExactKeys(payload.snapshots, SNAPSHOTS_KEYS, "Room snapshots");
  const snapshots = {
    owner: normalizeSnapshotSlot(payload.snapshots.owner, "owner"),
    guest: normalizeSnapshotSlot(payload.snapshots.guest, "guest"),
  };

  return {
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId,
    expiresAt: normalizeCanonicalDate(payload.expiresAt, "Room expiresAt"),
    joined: payload.joined,
    snapshots,
  };
}

export async function createBannerTogetherRoom({
  ownerCapabilityHash,
  joinCapabilityHash,
  idempotencyKey,
  signal = null,
}) {
  const response = await roomFetch(BANNER_TOGETHER_ROOM_API_BASE_PATH, {
    method: "POST",
    idempotencyKey: validateIdempotencyKey(idempotencyKey),
    signal,
    body: {
      version: BANNER_TOGETHER_ROOM_VERSION,
      ownerCapabilityHash:
        validateBannerTogetherRoomCapabilityHash(ownerCapabilityHash),
      joinCapabilityHash:
        validateBannerTogetherRoomCapabilityHash(joinCapabilityHash),
    },
  });

  if (!response.ok) {
    await throwRoomResponseError(response);
  }

  return normalizeCreateResponse(
    await readJsonResponse(response, "Create room response")
  );
}

export async function joinBannerTogetherRoom({
  roomId,
  joinCapability,
  guestCapabilityHash,
  signal = null,
}) {
  const response = await roomFetch(getRoomPath(roomId, "/join"), {
    method: "POST",
    capability: joinCapability,
    signal,
    body: {
      version: BANNER_TOGETHER_ROOM_VERSION,
      guestCapabilityHash:
        validateBannerTogetherRoomCapabilityHash(guestCapabilityHash),
    },
  });

  if (!response.ok) {
    await throwRoomResponseError(response);
  }

  return { joined: true };
}

export async function getBannerTogetherRoom({
  roomId,
  capability,
  signal = null,
}) {
  const normalizedRoomId = validateBannerTogetherRoomId(roomId);
  const response = await roomFetch(getRoomPath(normalizedRoomId), {
    capability,
    signal,
  });

  if (!response.ok) {
    await throwRoomResponseError(response);
  }

  return normalizeRoomResponse(
    await readJsonResponse(response, "Room response"),
    normalizedRoomId
  );
}

export async function putBannerTogetherRoomSnapshot({
  roomId,
  role,
  capability,
  expectedSequence,
  envelope,
  signal = null,
}) {
  const normalizedRole = validateBannerTogetherRoomRole(role);
  const normalizedExpectedSequence = validateBannerTogetherRoomSequence(
    expectedSequence,
    { allowZero: true }
  );
  const response = await roomFetch(
    getRoomPath(roomId, `/snapshots/${normalizedRole}`),
    {
      method: "PUT",
      capability,
      signal,
      body: {
        version: BANNER_TOGETHER_ROOM_VERSION,
        expectedSequence: normalizedExpectedSequence,
        envelope: validateBannerTogetherRoomEncryptedEnvelope(envelope),
      },
    }
  );

  if (!response.ok) {
    await throwRoomResponseError(response);
  }

  const payload = await readJsonResponse(response, "Update room response");
  assertExactKeys(
    payload,
    ["version", "role", "sequence", "updatedAt"],
    "Update room response"
  );

  if (payload.version !== BANNER_TOGETHER_ROOM_VERSION) {
    throw new BannerTogetherRoomApiError(
      `Unsupported room response version: ${String(payload.version)}.`,
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  if (payload.role !== normalizedRole) {
    throw new BannerTogetherRoomApiError(
      "Update room response belongs to a different participant.",
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  const sequence = normalizeResponseValue(
    () => validateBannerTogetherRoomSequence(payload.sequence),
    "Update room response sequence"
  );

  if (sequence !== normalizedExpectedSequence + 1) {
    throw new BannerTogetherRoomApiError(
      "Update room response has an unexpected sequence.",
      { code: "INVALID_ROOM_RESPONSE" }
    );
  }

  return {
    version: BANNER_TOGETHER_ROOM_VERSION,
    role: normalizedRole,
    sequence,
    updatedAt: normalizeCanonicalDate(
      payload.updatedAt,
      "Room snapshot updatedAt"
    ),
  };
}

export async function deleteBannerTogetherRoom({
  roomId,
  ownerCapability,
  signal = null,
}) {
  const response = await roomFetch(getRoomPath(roomId), {
    method: "DELETE",
    capability: ownerCapability,
    signal,
  });

  if (!response.ok) {
    await throwRoomResponseError(response);
  }

  return { deleted: true };
}
