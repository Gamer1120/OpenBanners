export const BANNER_TOGETHER_ROOM_VERSION = 2;
export const BANNER_TOGETHER_ROOM_HASH_PREFIX = "#banner-together-room=";
export const BANNER_TOGETHER_ROOM_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const BANNER_TOGETHER_ROOM_MAX_BANNER_IDS = 10000;
export const BANNER_TOGETHER_ROOM_MAX_JSON_BYTES = 512 * 1024;
export const BANNER_TOGETHER_ROOM_PADDING_BYTES = 64 * 1024;
export const BANNER_TOGETHER_ROOM_MAX_FRAME_BYTES =
  BANNER_TOGETHER_ROOM_MAX_JSON_BYTES + BANNER_TOGETHER_ROOM_PADDING_BYTES;
export const BANNER_TOGETHER_ROOM_MAX_CIPHERTEXT_BYTES =
  BANNER_TOGETHER_ROOM_MAX_FRAME_BYTES + 16;
export const BANNER_TOGETHER_ROOM_ACCESS_STORAGE_PREFIX =
  "openbanners-banner-together-room-v2:";
export const BANNER_TOGETHER_PENDING_JOIN_STORAGE_PREFIX =
  "openbanners-banner-together-pending-join-v2:";

const ENCRYPTED_ENVELOPE_VERSION = 1;
const ENCRYPTED_ENVELOPE_ALGORITHM = "AES-256-GCM";
const ROOM_ID_BYTES = 16;
const SECRET_BYTES = 32;
const IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const SNAPSHOT_VERSION = 2;
const MAX_PLACE_ID_LENGTH = 256;
const MAX_BANNER_ID_LENGTH = 256;
const MAX_SEQUENCE = 2147483647;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SNAPSHOT_KEYS = Object.freeze([
  "version",
  "roomId",
  "placeId",
  "participant",
  "sequence",
  "capturedAt",
  "lists",
]);
const LIST_KEYS = Object.freeze(["todo", "done", "blacklist"]);
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
  "role",
  "roomKey",
  "capability",
  "joinCapability",
  "expiresAt",
  "highestSequences",
]);
const SEQUENCE_KEYS = Object.freeze(["owner", "guest"]);
const PENDING_JOIN_KEYS = Object.freeze([
  "version",
  "roomId",
  "placeId",
  "roomKey",
  "joinCapability",
  "guestCapability",
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
      "Banner Together rooms require Web Crypto in a secure browser context."
    );
  }

  return webCrypto;
}

function getCharacterLength(value) {
  return Array.from(value).length;
}

function validateIdentifier(value, label, maximumLength) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  if (
    value.length === 0 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }

  if (getCharacterLength(value) > maximumLength) {
    throw new Error(`${label} is too long.`);
  }

  return value;
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

function compareStrings(valueA, valueB) {
  if (valueA < valueB) {
    return -1;
  }

  if (valueA > valueB) {
    return 1;
  }

  return 0;
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

function base64UrlToBytes(encodedValue, label, maximumBytes = null) {
  const maximumEncodedLength = Number.isInteger(maximumBytes)
    ? Math.ceil(maximumBytes / 3) * 4
    : null;

  if (
    typeof encodedValue !== "string" ||
    encodedValue.length === 0 ||
    (maximumEncodedLength !== null &&
      encodedValue.length > maximumEncodedLength) ||
    !/^[A-Za-z0-9_-]+$/.test(encodedValue) ||
    encodedValue.length % 4 === 1
  ) {
    throw new Error(`${label} is not valid base64url data.`);
  }

  const bytes = [];
  let bufferedValue = 0;
  let bufferedBits = 0;

  for (const character of encodedValue) {
    const characterValue = BASE64URL_ALPHABET.indexOf(character);
    bufferedValue = (bufferedValue << 6) | characterValue;
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

  if (bytesToBase64Url(result) !== encodedValue) {
    throw new Error(`${label} is not canonical base64url data.`);
  }

  return result;
}

function validateFixedBase64Url(value, label, expectedBytes) {
  const bytes = base64UrlToBytes(value, label, expectedBytes);

  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`${label} must contain exactly ${expectedBytes} bytes.`);
  }

  return value;
}

export function validateBannerTogetherRoomId(roomId) {
  return validateFixedBase64Url(roomId, "Room ID", ROOM_ID_BYTES);
}

export function validateBannerTogetherRoomCapability(capability) {
  return validateFixedBase64Url(
    capability,
    "Room capability",
    SECRET_BYTES
  );
}

export function validateBannerTogetherRoomCapabilityHash(capabilityHash) {
  return validateFixedBase64Url(
    capabilityHash,
    "Room capability hash",
    SECRET_BYTES
  );
}

export function validateBannerTogetherRoomKey(roomKey) {
  return validateFixedBase64Url(roomKey, "Room key", SECRET_BYTES);
}

export function validateBannerTogetherRoomPlaceId(placeId) {
  return validateIdentifier(placeId, "Place ID", MAX_PLACE_ID_LENGTH);
}

export function validateBannerTogetherRoomRole(role) {
  if (role !== "owner" && role !== "guest") {
    throw new Error("Room role must be owner or guest.");
  }

  return role;
}

export function validateBannerTogetherRoomSequence(
  sequence,
  { allowZero = false } = {}
) {
  const minimumSequence = allowZero ? 0 : 1;

  if (
    !Number.isInteger(sequence) ||
    sequence < minimumSequence ||
    sequence > MAX_SEQUENCE
  ) {
    throw new Error(
      `Room sequence must be an integer from ${minimumSequence} to ${MAX_SEQUENCE}.`
    );
  }

  return sequence;
}

function createRandomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  getWebCrypto().getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashBannerTogetherRoomCapability(capability) {
  const normalizedCapability = validateBannerTogetherRoomCapability(capability);
  const capabilityBytes = base64UrlToBytes(
    normalizedCapability,
    "Room capability",
    SECRET_BYTES
  );
  const digest = await getWebCrypto().subtle.digest(
    "SHA-256",
    capabilityBytes
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function createBannerTogetherRoomCapability() {
  const capability = createRandomBase64Url(SECRET_BYTES);

  return {
    capability,
    capabilityHash: await hashBannerTogetherRoomCapability(capability),
  };
}

export async function createBannerTogetherRoomSecrets() {
  const roomKey = createRandomBase64Url(SECRET_BYTES);
  const ownerAccess = await createBannerTogetherRoomCapability();
  const joinAccess = await createBannerTogetherRoomCapability();

  return {
    roomKey,
    ownerCapability: ownerAccess.capability,
    ownerCapabilityHash: ownerAccess.capabilityHash,
    joinCapability: joinAccess.capability,
    joinCapabilityHash: joinAccess.capabilityHash,
  };
}

export async function createBannerTogetherRoomGuestAccess() {
  const guestAccess = await createBannerTogetherRoomCapability();

  return {
    guestCapability: guestAccess.capability,
    guestCapabilityHash: guestAccess.capabilityHash,
  };
}

function normalizeDate(value, label) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${label} must be a valid date.`);
    }

    return value.toISOString();
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be an ISO date string.`);
  }

  const parsedDate = new Date(value);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO date string.`);
  }

  return value;
}

function validateTimestampAge(value, now, label) {
  if (!Number.isFinite(now)) {
    throw new Error("Room validation time is invalid.");
  }

  const timestamp = new Date(value).getTime();

  if (timestamp - now > FUTURE_TOLERANCE_MS) {
    throw new Error(`${label} is in the future.`);
  }

  if (now - timestamp > BANNER_TOGETHER_ROOM_MAX_AGE_MS) {
    throw new Error(`${label} has expired.`);
  }
}

function normalizeSnapshotLists(lists, { requireSorted = false } = {}) {
  assertExactKeys(lists, LIST_KEYS, "Room snapshot lists");

  const normalizedLists = {};
  const allIds = new Set();
  let totalIds = 0;

  LIST_KEYS.forEach((listType) => {
    const sourceIds = lists[listType];

    if (!Array.isArray(sourceIds)) {
      throw new Error(`Room snapshot ${listType} list must be an array.`);
    }

    const normalizedIds = sourceIds.map((bannerId) =>
      validateIdentifier(bannerId, "Banner ID", MAX_BANNER_ID_LENGTH)
    );

    normalizedIds.forEach((bannerId) => {
      if (allIds.has(bannerId)) {
        throw new Error(
          "A banner ID can appear in only one room snapshot list."
        );
      }

      allIds.add(bannerId);
    });

    totalIds += normalizedIds.length;

    if (totalIds > BANNER_TOGETHER_ROOM_MAX_BANNER_IDS) {
      throw new Error(
        `A room snapshot can contain at most ${BANNER_TOGETHER_ROOM_MAX_BANNER_IDS} banner IDs.`
      );
    }

    const sortedIds = [...normalizedIds].sort(compareStrings);

    if (
      requireSorted &&
      normalizedIds.some((bannerId, index) => bannerId !== sortedIds[index])
    ) {
      throw new Error("Room snapshot banner IDs must be sorted.");
    }

    normalizedLists[listType] = sortedIds;
  });

  return normalizedLists;
}

function normalizeSnapshotPayload(
  payload,
  {
    expectedRoomId,
    expectedPlaceId,
    expectedParticipant,
    expectedSequence,
    requireSorted = false,
    now = Date.now(),
  }
) {
  assertExactKeys(payload, SNAPSHOT_KEYS, "Room snapshot");

  if (payload.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported room snapshot version: ${String(payload.version)}.`
    );
  }

  const normalizedPayload = {
    version: SNAPSHOT_VERSION,
    roomId: validateBannerTogetherRoomId(payload.roomId),
    placeId: validateBannerTogetherRoomPlaceId(payload.placeId),
    participant: validateBannerTogetherRoomRole(payload.participant),
    sequence: validateBannerTogetherRoomSequence(payload.sequence),
    capturedAt: normalizeDate(payload.capturedAt, "Room snapshot capturedAt"),
    lists: normalizeSnapshotLists(payload.lists, { requireSorted }),
  };

  if (normalizedPayload.roomId !== expectedRoomId) {
    throw new Error("Room snapshot belongs to a different room.");
  }

  if (normalizedPayload.placeId !== expectedPlaceId) {
    throw new Error("Room snapshot belongs to a different place.");
  }

  if (normalizedPayload.participant !== expectedParticipant) {
    throw new Error("Room snapshot belongs to a different participant.");
  }

  if (normalizedPayload.sequence !== expectedSequence) {
    throw new Error("Room snapshot sequence does not match its envelope.");
  }

  validateTimestampAge(
    normalizedPayload.capturedAt,
    now,
    "Room snapshot timestamp"
  );

  return normalizedPayload;
}

function createAdditionalData({ roomId, placeId, participant, sequence }) {
  return new TextEncoder().encode(
    JSON.stringify([
      "OpenBanners Banner Together",
      BANNER_TOGETHER_ROOM_VERSION,
      roomId,
      placeId,
      participant,
      sequence,
    ])
  );
}

async function deriveSnapshotKey(roomKey, roomId, participant, keyUsages) {
  const webCrypto = getWebCrypto();
  const roomKeyBytes = base64UrlToBytes(
    validateBannerTogetherRoomKey(roomKey),
    "Room key",
    SECRET_BYTES
  );
  const roomIdBytes = base64UrlToBytes(
    validateBannerTogetherRoomId(roomId),
    "Room ID",
    ROOM_ID_BYTES
  );
  const sourceKey = await webCrypto.subtle.importKey(
    "raw",
    roomKeyBytes,
    "HKDF",
    false,
    ["deriveKey"]
  );

  return webCrypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: roomIdBytes,
      info: new TextEncoder().encode(
        `OpenBanners Banner Together v2/${participant}`
      ),
    },
    sourceKey,
    { name: "AES-GCM", length: 256 },
    false,
    keyUsages
  );
}

function createPaddedFrame(serializedBytes) {
  if (serializedBytes.byteLength > BANNER_TOGETHER_ROOM_MAX_JSON_BYTES) {
    throw new Error("Room snapshot JSON is too large.");
  }

  const unpaddedLength = 4 + serializedBytes.byteLength;
  const frameLength =
    Math.ceil(unpaddedLength / BANNER_TOGETHER_ROOM_PADDING_BYTES) *
    BANNER_TOGETHER_ROOM_PADDING_BYTES;

  if (frameLength > BANNER_TOGETHER_ROOM_MAX_FRAME_BYTES) {
    throw new Error("Room snapshot frame is too large.");
  }

  const frame = new Uint8Array(frameLength);
  const dataView = new DataView(frame.buffer);
  dataView.setUint32(0, serializedBytes.byteLength, false);
  frame.set(serializedBytes, 4);

  const padding = frame.subarray(unpaddedLength);

  if (padding.byteLength > 0) {
    getWebCrypto().getRandomValues(padding);
  }

  return frame;
}

function readPaddedFrame(frame) {
  if (
    frame.byteLength < BANNER_TOGETHER_ROOM_PADDING_BYTES ||
    frame.byteLength > BANNER_TOGETHER_ROOM_MAX_FRAME_BYTES ||
    frame.byteLength % BANNER_TOGETHER_ROOM_PADDING_BYTES !== 0
  ) {
    throw new Error("Decrypted room snapshot has an invalid padded size.");
  }

  const serializedLength = new DataView(
    frame.buffer,
    frame.byteOffset,
    frame.byteLength
  ).getUint32(0, false);

  if (
    serializedLength === 0 ||
    serializedLength > BANNER_TOGETHER_ROOM_MAX_JSON_BYTES ||
    serializedLength > frame.byteLength - 4
  ) {
    throw new Error("Decrypted room snapshot has an invalid JSON length.");
  }

  const serializedBytes = frame.subarray(4, 4 + serializedLength);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(serializedBytes);
  } catch {
    throw new Error("Decrypted room snapshot is not valid UTF-8.");
  }
}

export function validateBannerTogetherRoomEncryptedEnvelope(envelope) {
  assertExactKeys(envelope, ENVELOPE_KEYS, "Encrypted room snapshot");

  if (envelope.version !== ENCRYPTED_ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported encrypted room snapshot version: ${String(envelope.version)}.`
    );
  }

  if (envelope.algorithm !== ENCRYPTED_ENVELOPE_ALGORITHM) {
    throw new Error("Encrypted room snapshot uses an unsupported algorithm.");
  }

  validateFixedBase64Url(envelope.iv, "Room snapshot IV", IV_BYTES);
  const ciphertextBytes = base64UrlToBytes(
    envelope.ciphertext,
    "Room snapshot ciphertext",
    BANNER_TOGETHER_ROOM_MAX_CIPHERTEXT_BYTES
  );

  if (
    ciphertextBytes.byteLength < BANNER_TOGETHER_ROOM_PADDING_BYTES + 16 ||
    ciphertextBytes.byteLength > BANNER_TOGETHER_ROOM_MAX_CIPHERTEXT_BYTES ||
    (ciphertextBytes.byteLength - 16) %
      BANNER_TOGETHER_ROOM_PADDING_BYTES !==
      0
  ) {
    throw new Error("Room snapshot ciphertext has an invalid size.");
  }

  return {
    version: ENCRYPTED_ENVELOPE_VERSION,
    algorithm: ENCRYPTED_ENVELOPE_ALGORITHM,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
  };
}

export async function encryptBannerTogetherRoomSnapshot({
  roomKey,
  roomId,
  placeId,
  participant,
  sequence,
  capturedAt = new Date(),
  lists,
  now = Date.now(),
}) {
  const normalizedRoomId = validateBannerTogetherRoomId(roomId);
  const normalizedPlaceId = validateBannerTogetherRoomPlaceId(placeId);
  const normalizedParticipant = validateBannerTogetherRoomRole(participant);
  const normalizedSequence = validateBannerTogetherRoomSequence(sequence);
  const normalizedPayload = normalizeSnapshotPayload(
    {
      version: SNAPSHOT_VERSION,
      roomId: normalizedRoomId,
      placeId: normalizedPlaceId,
      participant: normalizedParticipant,
      sequence: normalizedSequence,
      capturedAt: normalizeDate(capturedAt, "Room snapshot capturedAt"),
      lists,
    },
    {
      expectedRoomId: normalizedRoomId,
      expectedPlaceId: normalizedPlaceId,
      expectedParticipant: normalizedParticipant,
      expectedSequence: normalizedSequence,
      now,
    }
  );
  const serializedBytes = new TextEncoder().encode(
    JSON.stringify(normalizedPayload)
  );
  const paddedFrame = createPaddedFrame(serializedBytes);
  const ivBytes = new Uint8Array(IV_BYTES);
  getWebCrypto().getRandomValues(ivBytes);
  const encryptionKey = await deriveSnapshotKey(
    roomKey,
    normalizedRoomId,
    normalizedParticipant,
    ["encrypt"]
  );
  const encryptedBytes = await getWebCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
      additionalData: createAdditionalData({
        roomId: normalizedRoomId,
        placeId: normalizedPlaceId,
        participant: normalizedParticipant,
        sequence: normalizedSequence,
      }),
      tagLength: AES_GCM_TAG_BITS,
    },
    encryptionKey,
    paddedFrame
  );

  return {
    version: ENCRYPTED_ENVELOPE_VERSION,
    algorithm: ENCRYPTED_ENVELOPE_ALGORITHM,
    iv: bytesToBase64Url(ivBytes),
    ciphertext: bytesToBase64Url(new Uint8Array(encryptedBytes)),
  };
}

export async function decryptBannerTogetherRoomSnapshot({
  roomKey,
  roomId,
  placeId,
  participant,
  sequence,
  envelope,
  now = Date.now(),
}) {
  const normalizedRoomId = validateBannerTogetherRoomId(roomId);
  const normalizedPlaceId = validateBannerTogetherRoomPlaceId(placeId);
  const normalizedParticipant = validateBannerTogetherRoomRole(participant);
  const normalizedSequence = validateBannerTogetherRoomSequence(sequence);
  const normalizedEnvelope =
    validateBannerTogetherRoomEncryptedEnvelope(envelope);
  const ivBytes = base64UrlToBytes(
    normalizedEnvelope.iv,
    "Room snapshot IV",
    IV_BYTES
  );
  const ciphertextBytes = base64UrlToBytes(
    normalizedEnvelope.ciphertext,
    "Room snapshot ciphertext",
    BANNER_TOGETHER_ROOM_MAX_CIPHERTEXT_BYTES
  );
  const decryptionKey = await deriveSnapshotKey(
    roomKey,
    normalizedRoomId,
    normalizedParticipant,
    ["decrypt"]
  );
  let decryptedBytes;

  try {
    decryptedBytes = await getWebCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBytes,
        additionalData: createAdditionalData({
          roomId: normalizedRoomId,
          placeId: normalizedPlaceId,
          participant: normalizedParticipant,
          sequence: normalizedSequence,
        }),
        tagLength: AES_GCM_TAG_BITS,
      },
      decryptionKey,
      ciphertextBytes
    );
  } catch {
    throw new Error(
      "The encrypted room snapshot could not be authenticated for this room."
    );
  }

  const serializedPayload = readPaddedFrame(new Uint8Array(decryptedBytes));
  let payload;

  try {
    payload = JSON.parse(serializedPayload);
  } catch {
    throw new Error("Decrypted room snapshot is not valid JSON.");
  }

  return normalizeSnapshotPayload(payload, {
    expectedRoomId: normalizedRoomId,
    expectedPlaceId: normalizedPlaceId,
    expectedParticipant: normalizedParticipant,
    expectedSequence: normalizedSequence,
    requireSorted: true,
    now,
  });
}

export function createBannerTogetherRoomInviteHash({
  roomKey,
  joinCapability,
}) {
  const normalizedRoomKey = validateBannerTogetherRoomKey(roomKey);
  const normalizedJoinCapability =
    validateBannerTogetherRoomCapability(joinCapability);

  return `${BANNER_TOGETHER_ROOM_HASH_PREFIX}v2.${normalizedRoomKey}.${normalizedJoinCapability}`;
}

export function createBannerTogetherRoomInviteUrl({
  origin,
  placeId,
  roomId,
  roomKey,
  joinCapability,
}) {
  let inviteOrigin;

  try {
    const parsedOrigin = new URL(origin);

    if (!/^https?:$/.test(parsedOrigin.protocol) || parsedOrigin.origin === "null") {
      throw new Error("Unsupported origin protocol.");
    }

    inviteOrigin = parsedOrigin.origin;
  } catch {
    throw new Error("origin must be a valid HTTP or HTTPS origin.");
  }

  const normalizedPlaceId = validateBannerTogetherRoomPlaceId(placeId);
  const normalizedRoomId = validateBannerTogetherRoomId(roomId);
  const hash = createBannerTogetherRoomInviteHash({
    roomKey,
    joinCapability,
  });

  return `${inviteOrigin}/together/${encodeURIComponent(
    normalizedPlaceId
  )}/room/${encodeURIComponent(normalizedRoomId)}${hash}`;
}

export function parseBannerTogetherRoomInviteHash(
  hash,
  { roomId, placeId } = {}
) {
  const normalizedRoomId = validateBannerTogetherRoomId(roomId);
  const normalizedPlaceId = validateBannerTogetherRoomPlaceId(placeId);

  if (
    typeof hash !== "string" ||
    !hash.startsWith(BANNER_TOGETHER_ROOM_HASH_PREFIX)
  ) {
    throw new Error("Room invite hash has an invalid prefix.");
  }

  const encodedInvite = hash.slice(BANNER_TOGETHER_ROOM_HASH_PREFIX.length);
  const inviteParts = encodedInvite.split(".");

  if (inviteParts.length !== 3 || inviteParts[0] !== "v2") {
    throw new Error("Room invite hash has an unsupported format.");
  }

  return {
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId: normalizedRoomId,
    placeId: normalizedPlaceId,
    roomKey: validateBannerTogetherRoomKey(inviteParts[1]),
    joinCapability: validateBannerTogetherRoomCapability(inviteParts[2]),
  };
}

function getDefaultStorage() {
  if (!globalThis.localStorage) {
    throw new Error("Local storage is unavailable for this room.");
  }

  return globalThis.localStorage;
}

function getRoomAccessStorageKey(roomId) {
  return `${BANNER_TOGETHER_ROOM_ACCESS_STORAGE_PREFIX}${validateBannerTogetherRoomId(
    roomId
  )}`;
}

function getPendingJoinStorageKey(roomId) {
  return `${BANNER_TOGETHER_PENDING_JOIN_STORAGE_PREFIX}${validateBannerTogetherRoomId(
    roomId
  )}`;
}

function normalizeHighestSequences(highestSequences = { owner: 0, guest: 0 }) {
  assertExactKeys(
    highestSequences,
    SEQUENCE_KEYS,
    "Room access highestSequences"
  );

  return {
    owner: validateBannerTogetherRoomSequence(highestSequences.owner, {
      allowZero: true,
    }),
    guest: validateBannerTogetherRoomSequence(highestSequences.guest, {
      allowZero: true,
    }),
  };
}

function normalizeRoomAccess(
  access,
  { now = Date.now(), rejectExpired = true } = {}
) {
  assertExactKeys(access, ACCESS_KEYS, "Room access");

  if (access.version !== BANNER_TOGETHER_ROOM_VERSION) {
    throw new Error(`Unsupported room access version: ${String(access.version)}.`);
  }

  const role = validateBannerTogetherRoomRole(access.role);
  const expiresAt = normalizeDate(access.expiresAt, "Room access expiresAt");
  const expiresAtTimestamp = new Date(expiresAt).getTime();

  if (!Number.isFinite(now)) {
    throw new Error("Room access validation time is invalid.");
  }

  if (expiresAtTimestamp - now > BANNER_TOGETHER_ROOM_MAX_AGE_MS + FUTURE_TOLERANCE_MS) {
    throw new Error("Room access expiry is too far in the future.");
  }

  if (rejectExpired && expiresAtTimestamp <= now) {
    throw new Error("Room access has expired.");
  }

  const joinCapability =
    access.joinCapability === null
      ? null
      : validateBannerTogetherRoomCapability(access.joinCapability);

  if (role === "guest" && joinCapability !== null) {
    throw new Error("Guest room access cannot retain a join capability.");
  }

  return {
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId: validateBannerTogetherRoomId(access.roomId),
    placeId: validateBannerTogetherRoomPlaceId(access.placeId),
    role,
    roomKey: validateBannerTogetherRoomKey(access.roomKey),
    capability: validateBannerTogetherRoomCapability(access.capability),
    joinCapability,
    expiresAt,
    highestSequences: normalizeHighestSequences(access.highestSequences),
  };
}

function normalizePendingJoin(
  pendingJoin,
  { now = Date.now(), rejectExpired = true } = {}
) {
  assertExactKeys(pendingJoin, PENDING_JOIN_KEYS, "Pending room join");

  if (pendingJoin.version !== BANNER_TOGETHER_ROOM_VERSION) {
    throw new Error(
      `Unsupported pending room join version: ${String(pendingJoin.version)}.`
    );
  }

  const expiresAt = normalizeDate(
    pendingJoin.expiresAt,
    "Pending room join expiresAt"
  );
  const expiresAtTimestamp = new Date(expiresAt).getTime();

  if (!Number.isFinite(now)) {
    throw new Error("Pending room join validation time is invalid.");
  }

  if (
    expiresAtTimestamp - now >
    BANNER_TOGETHER_ROOM_MAX_AGE_MS + FUTURE_TOLERANCE_MS
  ) {
    throw new Error("Pending room join expiry is too far in the future.");
  }

  if (rejectExpired && expiresAtTimestamp <= now) {
    throw new Error("Pending room join has expired.");
  }

  return {
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId: validateBannerTogetherRoomId(pendingJoin.roomId),
    placeId: validateBannerTogetherRoomPlaceId(pendingJoin.placeId),
    roomKey: validateBannerTogetherRoomKey(pendingJoin.roomKey),
    joinCapability: validateBannerTogetherRoomCapability(
      pendingJoin.joinCapability
    ),
    guestCapability: validateBannerTogetherRoomCapability(
      pendingJoin.guestCapability
    ),
    expiresAt,
  };
}

function hasSameRoomAccessIdentity(accessA, accessB) {
  return (
    accessA.version === accessB.version &&
    accessA.roomId === accessB.roomId &&
    accessA.placeId === accessB.placeId &&
    accessA.role === accessB.role &&
    accessA.roomKey === accessB.roomKey &&
    accessA.capability === accessB.capability &&
    accessA.joinCapability === accessB.joinCapability
  );
}

export function saveBannerTogetherRoomAccess(
  access,
  { storage = getDefaultStorage(), now = Date.now() } = {}
) {
  let normalizedAccess = normalizeRoomAccess(access, { now });
  const storageKey = getRoomAccessStorageKey(normalizedAccess.roomId);
  const storedValue = storage.getItem(storageKey);

  if (storedValue) {
    try {
      const storedAccess = normalizeRoomAccess(JSON.parse(storedValue), {
        now,
        rejectExpired: false,
      });

      if (hasSameRoomAccessIdentity(storedAccess, normalizedAccess)) {
        normalizedAccess = {
          ...normalizedAccess,
          highestSequences: {
            owner: Math.max(
              storedAccess.highestSequences.owner,
              normalizedAccess.highestSequences.owner
            ),
            guest: Math.max(
              storedAccess.highestSequences.guest,
              normalizedAccess.highestSequences.guest
            ),
          },
        };
      }
    } catch {
      // A new valid access record replaces unusable stored data.
    }
  }

  storage.setItem(
    storageKey,
    JSON.stringify(normalizedAccess)
  );
  return normalizedAccess;
}

export function loadBannerTogetherRoomAccess(
  roomId,
  { storage = getDefaultStorage(), now = Date.now() } = {}
) {
  const storageKey = getRoomAccessStorageKey(roomId);
  const storedValue = storage.getItem(storageKey);

  if (!storedValue) {
    return null;
  }

  try {
    const access = normalizeRoomAccess(JSON.parse(storedValue), { now });

    if (access.roomId !== roomId) {
      throw new Error("Stored room access belongs to a different room.");
    }

    return access;
  } catch {
    storage.removeItem(storageKey);
    return null;
  }
}

export function clearBannerTogetherRoomAccess(
  roomId,
  { storage = getDefaultStorage() } = {}
) {
  storage.removeItem(getRoomAccessStorageKey(roomId));
}

export function saveBannerTogetherPendingJoin(
  pendingJoin,
  { storage = getDefaultStorage(), now = Date.now() } = {}
) {
  const normalizedPendingJoin = normalizePendingJoin(pendingJoin, { now });
  storage.setItem(
    getPendingJoinStorageKey(normalizedPendingJoin.roomId),
    JSON.stringify(normalizedPendingJoin)
  );
  return normalizedPendingJoin;
}

export function loadBannerTogetherPendingJoin(
  roomId,
  { storage = getDefaultStorage(), now = Date.now() } = {}
) {
  const storageKey = getPendingJoinStorageKey(roomId);
  const storedValue = storage.getItem(storageKey);

  if (!storedValue) {
    return null;
  }

  try {
    const pendingJoin = normalizePendingJoin(JSON.parse(storedValue), { now });

    if (pendingJoin.roomId !== roomId) {
      throw new Error("Pending room join belongs to a different room.");
    }

    return pendingJoin;
  } catch {
    storage.removeItem(storageKey);
    return null;
  }
}

export function clearBannerTogetherPendingJoin(
  roomId,
  { storage = getDefaultStorage() } = {}
) {
  storage.removeItem(getPendingJoinStorageKey(roomId));
}
