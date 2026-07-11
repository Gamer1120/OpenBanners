export const BANNER_TOGETHER_HASH_PREFIX = "#banner-together=";
export const BANNER_TOGETHER_MAX_BANNER_IDS = 1000;
export const BANNER_TOGETHER_MAX_HASH_LENGTH = 16 * 1024;
export const BANNER_TOGETHER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const BANNER_TOGETHER_VERSION = 1;
const BANNER_TOGETHER_ROUTE_PREFIX = "/together/";
const BANNER_TOGETHER_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_PLACE_ID_LENGTH = 256;
const MAX_BANNER_ID_LENGTH = 256;
const MAX_SERIALIZED_BYTES = 2 * 1024 * 1024;
const MAX_ENCODED_LENGTH = Math.ceil(MAX_SERIALIZED_BYTES / 3) * 4;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const PAYLOAD_KEYS = new Set([
  "version",
  "placeId",
  "bannerIds",
  "createdAt",
]);

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

function normalizeBannerIds(bannerIds, { rejectDuplicates = false } = {}) {
  if (!Array.isArray(bannerIds)) {
    throw new Error("bannerIds must be an array.");
  }

  if (bannerIds.length > BANNER_TOGETHER_MAX_BANNER_IDS) {
    throw new Error(
      `An invite can contain at most ${BANNER_TOGETHER_MAX_BANNER_IDS} banner IDs.`
    );
  }

  const normalizedIds = [];
  const seenIds = new Set();

  bannerIds.forEach((bannerId) => {
    const normalizedId = validateIdentifier(
      bannerId,
      "Banner ID",
      MAX_BANNER_ID_LENGTH
    );

    if (seenIds.has(normalizedId)) {
      if (rejectDuplicates) {
        throw new Error("Invite banner IDs must be unique.");
      }

      return;
    }

    seenIds.add(normalizedId);
    normalizedIds.push(normalizedId);
  });

  return normalizedIds;
}

function normalizeCreatedAt(createdAt) {
  if (createdAt instanceof Date) {
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("createdAt must be a valid date.");
    }

    return createdAt.toISOString();
  }

  if (typeof createdAt !== "string") {
    throw new Error("createdAt must be an ISO date string.");
  }

  const parsedDate = new Date(createdAt);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString() !== createdAt
  ) {
    throw new Error("createdAt must be a canonical ISO date string.");
  }

  return createdAt;
}

function createPayload({ placeId, bannerIds, createdAt = new Date() }) {
  return {
    version: BANNER_TOGETHER_VERSION,
    placeId: validateIdentifier(placeId, "Place ID", MAX_PLACE_ID_LENGTH),
    bannerIds: normalizeBannerIds(bannerIds),
    createdAt: normalizeCreatedAt(createdAt),
  };
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

function base64UrlToBytes(encodedValue) {
  if (
    typeof encodedValue !== "string" ||
    encodedValue.length === 0 ||
    encodedValue.length > MAX_ENCODED_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(encodedValue) ||
    encodedValue.length % 4 === 1
  ) {
    throw new Error("Invite payload is not valid base64url data.");
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
    throw new Error("Invite payload has invalid base64url padding bits.");
  }

  const result = Uint8Array.from(bytes);

  if (bytesToBase64Url(result) !== encodedValue) {
    throw new Error("Invite payload is not canonical base64url data.");
  }

  return result;
}

async function readStreamBytes(readable, maximumBytes) {
  const reader = readable.getReader();
  const chunks = [];
  let totalLength = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalLength += chunk.byteLength;

      if (totalLength > maximumBytes) {
        await reader.cancel();
        throw new Error("Invite payload is too large.");
      }

      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });

  return bytes;
}

async function transformBytes(bytes, TransformConstructor) {
  const transform = new TransformConstructor("gzip");
  const writer = transform.writable.getWriter();
  const readPromise = readStreamBytes(
    transform.readable,
    MAX_SERIALIZED_BYTES
  );

  try {
    await writer.write(bytes);
    await writer.close();
    return await readPromise;
  } catch (error) {
    await writer.abort(error).catch(() => {});
    await readPromise.catch(() => {});
    throw error;
  }
}

async function encodePayload(payload) {
  const serializedPayload = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(serializedPayload);

  if (bytes.byteLength > MAX_SERIALIZED_BYTES) {
    throw new Error("Invite payload is too large.");
  }

  const rawPayload = `raw.${bytesToBase64Url(bytes)}`;

  if (
    BANNER_TOGETHER_HASH_PREFIX.length + rawPayload.length <=
    BANNER_TOGETHER_MAX_HASH_LENGTH
  ) {
    return rawPayload;
  }

  if (
    typeof globalThis.CompressionStream === "function" &&
    typeof globalThis.DecompressionStream === "function"
  ) {
    try {
      const compressedBytes = await transformBytes(
        bytes,
        globalThis.CompressionStream
      );

      const compressedPayload = `gzip.${bytesToBase64Url(compressedBytes)}`;

      if (
        compressedBytes.byteLength < bytes.byteLength &&
        BANNER_TOGETHER_HASH_PREFIX.length + compressedPayload.length <=
          BANNER_TOGETHER_MAX_HASH_LENGTH
      ) {
        return compressedPayload;
      }
    } catch {
      // The size error below is clearer than a browser compression failure.
    }
  }

  throw new Error(
    "This snapshot invite is too large to share reliably. Choose a more specific place."
  );
}

async function decodePayload(encodedPayload) {
  if (typeof encodedPayload !== "string") {
    throw new Error("Invite hash is invalid.");
  }

  const separatorIndex = encodedPayload.indexOf(".");

  if (separatorIndex <= 0 || separatorIndex === encodedPayload.length - 1) {
    throw new Error("Invite hash is missing its encoding prefix.");
  }

  const encoding = encodedPayload.slice(0, separatorIndex);
  const encodedBytes = encodedPayload.slice(separatorIndex + 1);
  let bytes = base64UrlToBytes(encodedBytes);

  if (encoding === "gzip") {
    if (typeof globalThis.DecompressionStream !== "function") {
      throw new Error("This browser cannot decompress the invite payload.");
    }

    try {
      bytes = await transformBytes(bytes, globalThis.DecompressionStream);
    } catch (error) {
      if (error?.message === "Invite payload is too large.") {
        throw error;
      }

      throw new Error("Invite payload contains invalid gzip data.");
    }
  } else if (encoding !== "raw") {
    throw new Error(`Unsupported invite encoding: ${encoding}.`);
  }

  if (bytes.byteLength > MAX_SERIALIZED_BYTES) {
    throw new Error("Invite payload is too large.");
  }

  let serializedPayload;

  try {
    serializedPayload = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Invite payload is not valid UTF-8.");
  }

  try {
    return JSON.parse(serializedPayload);
  } catch {
    throw new Error("Invite payload is not valid JSON.");
  }
}

function validateParsedPayload(payload, now) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invite payload must be an object.");
  }

  const payloadKeys = Object.keys(payload);

  if (
    payloadKeys.length !== PAYLOAD_KEYS.size ||
    payloadKeys.some((key) => !PAYLOAD_KEYS.has(key))
  ) {
    throw new Error("Invite payload contains unexpected fields.");
  }

  if (payload.version !== BANNER_TOGETHER_VERSION) {
    throw new Error(`Unsupported invite version: ${String(payload.version)}.`);
  }

  const normalizedPayload = {
    version: BANNER_TOGETHER_VERSION,
    placeId: validateIdentifier(
      payload.placeId,
      "Place ID",
      MAX_PLACE_ID_LENGTH
    ),
    bannerIds: normalizeBannerIds(payload.bannerIds, {
      rejectDuplicates: true,
    }),
    createdAt: normalizeCreatedAt(payload.createdAt),
  };
  const createdAtTimestamp = new Date(normalizedPayload.createdAt).getTime();

  if (createdAtTimestamp - now > BANNER_TOGETHER_FUTURE_TOLERANCE_MS) {
    throw new Error("Invite snapshot timestamp is in the future.");
  }

  if (now - createdAtTimestamp > BANNER_TOGETHER_MAX_AGE_MS) {
    throw new Error("Invite snapshot has expired.");
  }

  return normalizedPayload;
}

export async function createBannerTogetherInviteHash(options) {
  const payload = createPayload(options ?? {});
  const encodedPayload = await encodePayload(payload);
  return `${BANNER_TOGETHER_HASH_PREFIX}${encodedPayload}`;
}

export async function createBannerTogetherInviteUrl({
  origin,
  placeId,
  bannerIds,
  createdAt,
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

  const payloadOptions = { placeId, bannerIds };

  if (createdAt !== undefined) {
    payloadOptions.createdAt = createdAt;
  }

  const hash = await createBannerTogetherInviteHash(payloadOptions);
  const routePlaceId = encodeURIComponent(
    validateIdentifier(placeId, "Place ID", MAX_PLACE_ID_LENGTH)
  );

  return `${inviteOrigin}${BANNER_TOGETHER_ROUTE_PREFIX}${routePlaceId}${hash}`;
}

export async function parseBannerTogetherInviteHash(
  hash,
  { now = Date.now() } = {}
) {
  if (
    typeof hash !== "string" ||
    !hash.startsWith(BANNER_TOGETHER_HASH_PREFIX)
  ) {
    throw new Error("Invite hash has an invalid prefix.");
  }

  if (hash.length > BANNER_TOGETHER_MAX_HASH_LENGTH) {
    throw new Error("Invite hash is too large.");
  }

  if (!Number.isFinite(now)) {
    throw new Error("Invite validation time is invalid.");
  }

  const encodedPayload = hash.slice(BANNER_TOGETHER_HASH_PREFIX.length);
  const payload = await decodePayload(encodedPayload);
  return validateParsedPayload(payload, now);
}

export function getSharedTodoBanners(ownTodoBanners, invitedBannerIds) {
  if (!Array.isArray(ownTodoBanners) || !Array.isArray(invitedBannerIds)) {
    return [];
  }

  const invitedIdSet = new Set(invitedBannerIds);
  const includedIds = new Set();

  return ownTodoBanners.filter((banner) => {
    const bannerId = banner?.id;

    if (
      typeof bannerId !== "string" ||
      !invitedIdSet.has(bannerId) ||
      includedIds.has(bannerId)
    ) {
      return false;
    }

    includedIds.add(bannerId);
    return true;
  });
}
