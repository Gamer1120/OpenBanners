export const BANNER_TOGETHER_LIVE_VERSION = 3;
export const BANNER_TOGETHER_LIVE_INVITE_VERSION = 1;
export const BANNER_TOGETHER_LIVE_HASH_PREFIX = "#banner-together-live=";
export const BANNER_TOGETHER_LIVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const BANNER_TOGETHER_LIVE_MAX_BANNER_IDS = 10000;
export const BANNER_TOGETHER_LIVE_MAX_JSON_BYTES = 512 * 1024;
export const BANNER_TOGETHER_LIVE_MAX_CIPHERTEXT_BYTES =
  BANNER_TOGETHER_LIVE_MAX_JSON_BYTES + 16;
export const BANNER_TOGETHER_LIVE_ACCESS_STORAGE_PREFIX =
  "openbanners-banner-together-live-v1:";
export const BANNER_TOGETHER_LIVE_PENDING_JOIN_STORAGE_PREFIX =
  "openbanners-banner-together-live-pending-v1:";

const SECRET_BYTES = 32;
const ROOM_ID_BYTES = 16;
const PARTICIPANT_ID_BYTES = 16;
const PARTICIPANT_TOKEN_BYTES = 32;
const IV_BYTES = 12;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_PLACE_ID_LENGTH = 256;
const MAX_BANNER_ID_LENGTH = 256;
const MAX_SEQUENCE = 2147483647;
const ENVELOPE_VERSION = 1;
const SNAPSHOT_VERSION = 1;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LIST_KEYS = Object.freeze(["todo", "done", "blacklist"]);
const SNAPSHOT_KEYS = Object.freeze([
  "version",
  "roomId",
  "placeId",
  "participantId",
  "sequence",
  "capturedAt",
  "lists",
]);
const SNAPSHOT_KEYS_WITH_AGENT_NAME = Object.freeze([
  ...SNAPSHOT_KEYS,
  "agentName",
]);
const ENVELOPE_KEYS = Object.freeze([
  "version",
  "algorithm",
  "iv",
  "ciphertext",
]);
const ACCESS_KEYS = Object.freeze([
  "version",
  "roomId",
  "placeId",
  "roomSecret",
  "participantId",
  "participantVerifier",
  "participantToken",
  "expiresAt",
]);
const PENDING_JOIN_KEYS = Object.freeze([
  "version",
  "roomId",
  "placeId",
  "roomSecret",
  "participantId",
  "participantVerifier",
  "expiresAt",
]);

function getWebCrypto() {
  const webCrypto = globalThis.crypto;

  if (
    !webCrypto ||
    typeof webCrypto.getRandomValues !== "function" ||
    !webCrypto.subtle
  ) {
    throw new Error(
      "Live Banner Together rooms require Web Crypto in a secure browser context."
    );
  }

  return webCrypto;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const actualKeys = Object.keys(value);

  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => !expectedKeys.includes(key))
  ) {
    throw new Error(`${label} contains unexpected fields.`);
  }

  return value;
}

function bytesToBase64Url(bytes) {
  let encodedValue = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const firstByte = bytes[index];
    const hasSecondByte = index + 1 < bytes.length;
    const hasThirdByte = index + 2 < bytes.length;
    const secondByte = hasSecondByte ? bytes[index + 1] : 0;
    const thirdByte = hasThirdByte ? bytes[index + 2] : 0;
    const combinedValue =
      (firstByte << 16) | (secondByte << 8) | thirdByte;

    encodedValue += BASE64URL_ALPHABET[(combinedValue >> 18) & 63];
    encodedValue += BASE64URL_ALPHABET[(combinedValue >> 12) & 63];

    if (hasSecondByte) {
      encodedValue += BASE64URL_ALPHABET[(combinedValue >> 6) & 63];
    }

    if (hasThirdByte) {
      encodedValue += BASE64URL_ALPHABET[combinedValue & 63];
    }
  }

  return encodedValue;
}

function base64UrlToBytes(value, label, maximumBytes = null) {
  const maximumLength = Number.isInteger(maximumBytes)
    ? Math.ceil(maximumBytes / 3) * 4
    : null;

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (maximumLength !== null && value.length > maximumLength) ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  ) {
    throw new Error(`${label} is not valid base64url data.`);
  }

  const bytes = [];
  let bufferedValue = 0;
  let bufferedBits = 0;

  for (const character of value) {
    bufferedValue =
      (bufferedValue << 6) | BASE64URL_ALPHABET.indexOf(character);
    bufferedBits += 6;

    if (bufferedBits >= 8) {
      bufferedBits -= 8;
      bytes.push((bufferedValue >> bufferedBits) & 255);
      bufferedValue &= bufferedBits === 0 ? 0 : (1 << bufferedBits) - 1;
    }
  }

  if (bufferedValue !== 0) {
    throw new Error(`${label} has invalid base64url padding bits.`);
  }

  const result = Uint8Array.from(bytes);

  if (bytesToBase64Url(result) !== value) {
    throw new Error(`${label} is not canonical base64url data.`);
  }

  return result;
}

function validateFixedBase64Url(value, label, byteLength) {
  const bytes = base64UrlToBytes(value, label, byteLength);

  if (bytes.byteLength !== byteLength) {
    throw new Error(`${label} must contain exactly ${byteLength} bytes.`);
  }

  return value;
}

function validateIdentifier(value, label, maximumLength) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }

  if (Array.from(value).length > maximumLength) {
    throw new Error(`${label} is too long.`);
  }

  return value;
}

function normalizeDate(value, label) {
  const normalizedValue = value instanceof Date ? value.toISOString() : value;

  if (typeof normalizedValue !== "string") {
    throw new Error(`${label} must be an ISO date string.`);
  }

  const parsedDate = new Date(normalizedValue);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString() !== normalizedValue
  ) {
    throw new Error(`${label} must be a canonical ISO date string.`);
  }

  return normalizedValue;
}

function validateSnapshotAge(capturedAt, now) {
  if (!Number.isFinite(now)) {
    throw new Error("Snapshot validation time is invalid.");
  }

  const timestamp = new Date(capturedAt).getTime();

  if (timestamp - now > FUTURE_TOLERANCE_MS) {
    throw new Error("Live room snapshot timestamp is in the future.");
  }

  if (now - timestamp > BANNER_TOGETHER_LIVE_MAX_AGE_MS) {
    throw new Error("Live room snapshot has expired.");
  }
}

export function validateBannerTogetherLiveRoomId(roomId) {
  return validateFixedBase64Url(roomId, "Live room ID", ROOM_ID_BYTES);
}

export function validateBannerTogetherLiveRoomSecret(roomSecret) {
  return validateFixedBase64Url(
    roomSecret,
    "Live room secret",
    SECRET_BYTES
  );
}

export function validateBannerTogetherLiveRoomVerifier(roomVerifier) {
  return validateFixedBase64Url(
    roomVerifier,
    "Live room verifier",
    SECRET_BYTES
  );
}

export function validateBannerTogetherLiveParticipantId(participantId) {
  return validateFixedBase64Url(
    participantId,
    "Live room participant ID",
    PARTICIPANT_ID_BYTES
  );
}

export function validateBannerTogetherLiveParticipantToken(token) {
  return validateFixedBase64Url(
    token,
    "Live room participant token",
    PARTICIPANT_TOKEN_BYTES
  );
}

export function validateBannerTogetherLiveParticipantVerifier(
  participantVerifier
) {
  return validateFixedBase64Url(
    participantVerifier,
    "Live room participant verifier",
    SECRET_BYTES
  );
}

export function validateBannerTogetherLivePlaceId(placeId) {
  return validateIdentifier(placeId, "Place ID", MAX_PLACE_ID_LENGTH);
}

export function validateBannerTogetherLiveSequence(sequence) {
  if (
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_SEQUENCE
  ) {
    throw new Error(
      `Live room sequence must be an integer from 1 to ${MAX_SEQUENCE}.`
    );
  }

  return sequence;
}

function createRandomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  getWebCrypto().getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashBannerTogetherLiveRoomSecret(roomSecret) {
  const secretBytes = base64UrlToBytes(
    validateBannerTogetherLiveRoomSecret(roomSecret),
    "Live room secret",
    SECRET_BYTES
  );
  const digest = await getWebCrypto().subtle.digest("SHA-256", secretBytes);

  return bytesToBase64Url(new Uint8Array(digest));
}

export async function createBannerTogetherLiveSecrets() {
  const roomSecret = createRandomBase64Url(SECRET_BYTES);
  const roomVerifier = await hashBannerTogetherLiveRoomSecret(roomSecret);
  let participantIdentity;

  do {
    participantIdentity = createBannerTogetherLiveParticipantIdentity();
  } while (participantIdentity.participantVerifier === roomVerifier);

  return {
    roomSecret,
    roomVerifier,
    ...participantIdentity,
  };
}

export function createBannerTogetherLiveParticipantId() {
  return createRandomBase64Url(PARTICIPANT_ID_BYTES);
}

export function createBannerTogetherLiveParticipantIdentity() {
  return {
    participantId: createBannerTogetherLiveParticipantId(),
    participantVerifier: createRandomBase64Url(SECRET_BYTES),
  };
}

function normalizeLists(lists, { requireSorted = false } = {}) {
  assertExactKeys(lists, LIST_KEYS, "Live room snapshot lists");
  const normalizedLists = {};
  const allIds = new Set();
  let totalIds = 0;

  LIST_KEYS.forEach((listType) => {
    if (!Array.isArray(lists[listType])) {
      throw new Error(`Live room ${listType} list must be an array.`);
    }

    const normalizedIds = lists[listType].map((bannerId) =>
      validateIdentifier(bannerId, "Banner ID", MAX_BANNER_ID_LENGTH)
    );

    normalizedIds.forEach((bannerId) => {
      if (allIds.has(bannerId)) {
        throw new Error(
          "A banner ID can appear in only one live room snapshot list."
        );
      }

      allIds.add(bannerId);
    });

    totalIds += normalizedIds.length;

    if (totalIds > BANNER_TOGETHER_LIVE_MAX_BANNER_IDS) {
      throw new Error(
        `A live room snapshot can contain at most ${BANNER_TOGETHER_LIVE_MAX_BANNER_IDS} banner IDs.`
      );
    }

    const sortedIds = [...normalizedIds].sort();

    if (
      requireSorted &&
      normalizedIds.some((bannerId, index) => bannerId !== sortedIds[index])
    ) {
      throw new Error("Live room snapshot banner IDs must be sorted.");
    }

    normalizedLists[listType] = sortedIds;
  });

  return normalizedLists;
}

export function validateBannerTogetherLiveAgentName(agentName) {
  if (typeof agentName !== "string") {
    throw new Error("Live room agent name must be a string.");
  }

  const normalizedAgentName = agentName.normalize("NFC");

  if (
    normalizedAgentName.length === 0 ||
    normalizedAgentName.trim() !== normalizedAgentName ||
    Array.from(normalizedAgentName).length > 64 ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(
      normalizedAgentName
    )
  ) {
    throw new Error("Live room agent name is invalid.");
  }

  return normalizedAgentName;
}

function normalizeSnapshot(
  value,
  { roomId, placeId, participantId, sequence, now, requireSorted }
) {
  const hasAgentName = Object.hasOwn(value ?? {}, "agentName");
  assertExactKeys(
    value,
    hasAgentName ? SNAPSHOT_KEYS_WITH_AGENT_NAME : SNAPSHOT_KEYS,
    "Live room snapshot"
  );

  if (value.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported live room snapshot version: ${String(value.version)}.`
    );
  }

  const normalized = {
    version: SNAPSHOT_VERSION,
    roomId: validateBannerTogetherLiveRoomId(value.roomId),
    placeId: validateBannerTogetherLivePlaceId(value.placeId),
    participantId: validateBannerTogetherLiveParticipantId(
      value.participantId
    ),
    sequence: validateBannerTogetherLiveSequence(value.sequence),
    capturedAt: normalizeDate(value.capturedAt, "Snapshot capturedAt"),
    lists: normalizeLists(value.lists, { requireSorted }),
  };

  if (hasAgentName) {
    normalized.agentName = validateBannerTogetherLiveAgentName(value.agentName);
  }

  if (normalized.roomId !== roomId) {
    throw new Error("Live room snapshot belongs to a different room.");
  }

  if (normalized.placeId !== placeId) {
    throw new Error("Live room snapshot belongs to a different place.");
  }

  if (normalized.participantId !== participantId) {
    throw new Error(
      "Live room snapshot belongs to a different participant."
    );
  }

  if (normalized.sequence !== sequence) {
    throw new Error("Live room snapshot sequence does not match.");
  }

  validateSnapshotAge(normalized.capturedAt, now);
  return normalized;
}

function createAdditionalData({ roomId, placeId, participantId, sequence }) {
  return new TextEncoder().encode(
    JSON.stringify([
      "OpenBanners Banner Together live snapshot",
      SNAPSHOT_VERSION,
      roomId,
      placeId,
      participantId,
      sequence,
    ])
  );
}

async function deriveSnapshotKey(
  roomSecret,
  roomId,
  participantId,
  usages
) {
  const webCrypto = getWebCrypto();
  const sourceKey = await webCrypto.subtle.importKey(
    "raw",
    base64UrlToBytes(
      validateBannerTogetherLiveRoomSecret(roomSecret),
      "Live room secret",
      SECRET_BYTES
    ),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return webCrypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: base64UrlToBytes(
        validateBannerTogetherLiveRoomId(roomId),
        "Live room ID",
        ROOM_ID_BYTES
      ),
      info: new TextEncoder().encode(
        `OpenBanners Banner Together live v1/${validateBannerTogetherLiveParticipantId(
          participantId
        )}`
      ),
    },
    sourceKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

export function validateBannerTogetherLiveEncryptedEnvelope(envelope) {
  assertExactKeys(envelope, ENVELOPE_KEYS, "Encrypted live room snapshot");

  if (envelope.version !== ENVELOPE_VERSION) {
    throw new Error("Encrypted live room snapshot has an unsupported version.");
  }

  if (envelope.algorithm !== "AES-256-GCM") {
    throw new Error("Encrypted live room snapshot uses an unsupported algorithm.");
  }

  validateFixedBase64Url(envelope.iv, "Live room snapshot IV", IV_BYTES);
  const ciphertext = base64UrlToBytes(
    envelope.ciphertext,
    "Live room snapshot ciphertext",
    BANNER_TOGETHER_LIVE_MAX_CIPHERTEXT_BYTES
  );

  if (
    ciphertext.byteLength <= 16 ||
    ciphertext.byteLength > BANNER_TOGETHER_LIVE_MAX_CIPHERTEXT_BYTES
  ) {
    throw new Error("Live room snapshot ciphertext has an invalid size.");
  }

  return {
    version: ENVELOPE_VERSION,
    algorithm: "AES-256-GCM",
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
  };
}

export async function encryptBannerTogetherLiveSnapshot({
  roomSecret,
  roomId,
  placeId,
  participantId,
  sequence,
  capturedAt = new Date(),
  agentName = null,
  lists,
  now = Date.now(),
}) {
  const context = {
    roomId: validateBannerTogetherLiveRoomId(roomId),
    placeId: validateBannerTogetherLivePlaceId(placeId),
    participantId: validateBannerTogetherLiveParticipantId(participantId),
    sequence: validateBannerTogetherLiveSequence(sequence),
  };
  const snapshot = normalizeSnapshot(
    {
      version: SNAPSHOT_VERSION,
      ...context,
      capturedAt: normalizeDate(capturedAt, "Snapshot capturedAt"),
      ...(agentName === null || agentName === undefined
        ? {}
        : { agentName: validateBannerTogetherLiveAgentName(agentName) }),
      lists,
    },
    { ...context, now, requireSorted: false }
  );
  const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));

  if (plaintext.byteLength > BANNER_TOGETHER_LIVE_MAX_JSON_BYTES) {
    throw new Error("Live room snapshot JSON is too large.");
  }

  const iv = new Uint8Array(IV_BYTES);
  getWebCrypto().getRandomValues(iv);
  const key = await deriveSnapshotKey(
    roomSecret,
    context.roomId,
    context.participantId,
    ["encrypt"]
  );
  const ciphertext = await getWebCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: createAdditionalData(context),
      tagLength: 128,
    },
    key,
    plaintext
  );

  return {
    version: ENVELOPE_VERSION,
    algorithm: "AES-256-GCM",
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptBannerTogetherLiveSnapshot({
  roomSecret,
  roomId,
  placeId,
  participantId,
  sequence,
  envelope,
  now = Date.now(),
}) {
  const context = {
    roomId: validateBannerTogetherLiveRoomId(roomId),
    placeId: validateBannerTogetherLivePlaceId(placeId),
    participantId: validateBannerTogetherLiveParticipantId(participantId),
    sequence: validateBannerTogetherLiveSequence(sequence),
  };
  const normalizedEnvelope =
    validateBannerTogetherLiveEncryptedEnvelope(envelope);
  const key = await deriveSnapshotKey(
    roomSecret,
    context.roomId,
    context.participantId,
    ["decrypt"]
  );
  let plaintext;

  try {
    plaintext = await getWebCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(
          normalizedEnvelope.iv,
          "Live room snapshot IV",
          IV_BYTES
        ),
        additionalData: createAdditionalData(context),
        tagLength: 128,
      },
      key,
      base64UrlToBytes(
        normalizedEnvelope.ciphertext,
        "Live room snapshot ciphertext",
        BANNER_TOGETHER_LIVE_MAX_CIPHERTEXT_BYTES
      )
    );
  } catch {
    throw new Error(
      "The encrypted live room snapshot could not be authenticated for this participant."
    );
  }

  let serialized;

  try {
    serialized = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new Error("Decrypted live room snapshot is not valid UTF-8.");
  }

  let snapshot;

  try {
    snapshot = JSON.parse(serialized);
  } catch {
    throw new Error("Decrypted live room snapshot is not valid JSON.");
  }

  return normalizeSnapshot(snapshot, {
    ...context,
    now,
    requireSorted: true,
  });
}

export function createBannerTogetherLiveInviteHash({ roomSecret }) {
  return `${BANNER_TOGETHER_LIVE_HASH_PREFIX}v${BANNER_TOGETHER_LIVE_INVITE_VERSION}.${validateBannerTogetherLiveRoomSecret(
    roomSecret
  )}`;
}

export function createBannerTogetherLiveInviteUrl({
  origin,
  placeId,
  roomId,
  roomSecret,
}) {
  const url = new URL(origin);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Live room invite origin must use HTTP or HTTPS.");
  }

  url.pathname = `/together/${encodeURIComponent(
    validateBannerTogetherLivePlaceId(placeId)
  )}/live/${encodeURIComponent(validateBannerTogetherLiveRoomId(roomId))}`;
  url.search = "";
  url.hash = createBannerTogetherLiveInviteHash({ roomSecret });
  return url.toString();
}

export function parseBannerTogetherLiveInviteHash(
  hash,
  { roomId, placeId }
) {
  const normalizedRoomId = validateBannerTogetherLiveRoomId(roomId);
  const normalizedPlaceId = validateBannerTogetherLivePlaceId(placeId);

  if (
    typeof hash !== "string" ||
    !hash.startsWith(BANNER_TOGETHER_LIVE_HASH_PREFIX)
  ) {
    throw new Error("Live room invite has an invalid fragment prefix.");
  }

  const parts = hash.slice(BANNER_TOGETHER_LIVE_HASH_PREFIX.length).split(".");

  if (
    parts.length !== 2 ||
    parts[0] !== `v${BANNER_TOGETHER_LIVE_INVITE_VERSION}`
  ) {
    throw new Error("Live room invite has an unsupported format.");
  }

  return {
    version: BANNER_TOGETHER_LIVE_INVITE_VERSION,
    roomId: normalizedRoomId,
    placeId: normalizedPlaceId,
    roomSecret: validateBannerTogetherLiveRoomSecret(parts[1]),
  };
}

function getAccessStorageKey(roomId) {
  return `${BANNER_TOGETHER_LIVE_ACCESS_STORAGE_PREFIX}${validateBannerTogetherLiveRoomId(
    roomId
  )}`;
}

function normalizeAccess(access, now) {
  assertExactKeys(access, ACCESS_KEYS, "Live room access");

  if (access.version !== BANNER_TOGETHER_LIVE_VERSION) {
    throw new Error("Live room access has an unsupported version.");
  }

  const normalized = {
    version: BANNER_TOGETHER_LIVE_VERSION,
    roomId: validateBannerTogetherLiveRoomId(access.roomId),
    placeId: validateBannerTogetherLivePlaceId(access.placeId),
    roomSecret: validateBannerTogetherLiveRoomSecret(access.roomSecret),
    participantId: validateBannerTogetherLiveParticipantId(
      access.participantId
    ),
    participantVerifier: validateBannerTogetherLiveParticipantVerifier(
      access.participantVerifier
    ),
    participantToken: validateBannerTogetherLiveParticipantToken(
      access.participantToken
    ),
    expiresAt: normalizeDate(access.expiresAt, "Live room expiresAt"),
  };
  const expiresAt = new Date(normalized.expiresAt).getTime();

  if (expiresAt <= now) {
    throw new Error("Live room access has expired.");
  }

  if (expiresAt - now > BANNER_TOGETHER_LIVE_MAX_AGE_MS + FUTURE_TOLERANCE_MS) {
    throw new Error("Live room access expiry is too far in the future.");
  }

  return normalized;
}

export function saveBannerTogetherLiveAccess(access, { now = Date.now() } = {}) {
  const normalized = normalizeAccess(access, now);
  window.localStorage.setItem(
    getAccessStorageKey(normalized.roomId),
    JSON.stringify(normalized)
  );
  return normalized;
}

export function loadBannerTogetherLiveAccess(
  { roomId, placeId },
  { now = Date.now() } = {}
) {
  const normalizedRoomId = validateBannerTogetherLiveRoomId(roomId);
  const normalizedPlaceId = validateBannerTogetherLivePlaceId(placeId);
  const storageKey = getAccessStorageKey(normalizedRoomId);
  const storedValue = window.localStorage.getItem(storageKey);

  if (storedValue === null) {
    return null;
  }

  try {
    const normalized = normalizeAccess(JSON.parse(storedValue), now);

    if (
      normalized.roomId !== normalizedRoomId ||
      normalized.placeId !== normalizedPlaceId
    ) {
      throw new Error("Stored live room access belongs elsewhere.");
    }

    return normalized;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

export function clearBannerTogetherLiveAccess(roomId) {
  window.localStorage.removeItem(getAccessStorageKey(roomId));
}

function getPendingJoinStorageKey(roomId) {
  return `${BANNER_TOGETHER_LIVE_PENDING_JOIN_STORAGE_PREFIX}${validateBannerTogetherLiveRoomId(
    roomId
  )}`;
}

function normalizePendingJoin(pendingJoin, now) {
  assertExactKeys(
    pendingJoin,
    PENDING_JOIN_KEYS,
    "Pending live room join"
  );

  if (pendingJoin.version !== BANNER_TOGETHER_LIVE_VERSION) {
    throw new Error("Pending live room join has an unsupported version.");
  }

  const normalized = {
    version: BANNER_TOGETHER_LIVE_VERSION,
    roomId: validateBannerTogetherLiveRoomId(pendingJoin.roomId),
    placeId: validateBannerTogetherLivePlaceId(pendingJoin.placeId),
    roomSecret: validateBannerTogetherLiveRoomSecret(pendingJoin.roomSecret),
    participantId: validateBannerTogetherLiveParticipantId(
      pendingJoin.participantId
    ),
    participantVerifier: validateBannerTogetherLiveParticipantVerifier(
      pendingJoin.participantVerifier
    ),
    expiresAt: normalizeDate(
      pendingJoin.expiresAt,
      "Pending live room join expiresAt"
    ),
  };
  const expiresAt = new Date(normalized.expiresAt).getTime();

  if (expiresAt <= now) {
    throw new Error("Pending live room join has expired.");
  }

  if (expiresAt - now > BANNER_TOGETHER_LIVE_MAX_AGE_MS + FUTURE_TOLERANCE_MS) {
    throw new Error("Pending live room join expiry is too far in the future.");
  }

  return normalized;
}

export function saveBannerTogetherLivePendingJoin(
  pendingJoin,
  { now = Date.now() } = {}
) {
  const normalized = normalizePendingJoin(pendingJoin, now);
  window.localStorage.setItem(
    getPendingJoinStorageKey(normalized.roomId),
    JSON.stringify(normalized)
  );
  return normalized;
}

export function loadBannerTogetherLivePendingJoin(
  { roomId, placeId },
  { now = Date.now() } = {}
) {
  const normalizedRoomId = validateBannerTogetherLiveRoomId(roomId);
  const normalizedPlaceId = validateBannerTogetherLivePlaceId(placeId);
  const storageKey = getPendingJoinStorageKey(normalizedRoomId);
  const storedValue = window.localStorage.getItem(storageKey);

  if (storedValue === null) {
    return null;
  }

  try {
    const normalized = normalizePendingJoin(JSON.parse(storedValue), now);

    if (
      normalized.roomId !== normalizedRoomId ||
      normalized.placeId !== normalizedPlaceId
    ) {
      throw new Error("Pending live room join belongs elsewhere.");
    }

    return normalized;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

export function clearBannerTogetherLivePendingJoin(roomId) {
  window.localStorage.removeItem(getPendingJoinStorageKey(roomId));
}
