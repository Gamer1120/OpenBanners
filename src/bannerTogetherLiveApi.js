import {
  BANNER_TOGETHER_LIVE_VERSION,
  validateBannerTogetherLiveParticipantId,
  validateBannerTogetherLiveParticipantToken,
  validateBannerTogetherLiveParticipantVerifier,
  validateBannerTogetherLiveRoomId,
  validateBannerTogetherLiveRoomVerifier,
} from "./bannerTogetherLiveCrypto";

export const BANNER_TOGETHER_LIVE_API_BASE_PATH =
  "/_openbanners/banner-together/v3/rooms";

const MAX_EVENT_ID = Number.MAX_SAFE_INTEGER;
const MAX_PEERS = 7;
const MAX_SDP_LENGTH = 16 * 1024;
const MAX_CANDIDATE_LENGTH = 4096;

export class BannerTogetherLiveApiError extends Error {
  constructor(message, { code = "LIVE_ROOM_REQUEST_FAILED", status = null } = {}) {
    super(message);
    this.name = "BannerTogetherLiveApiError";
    this.code = code;
    this.status = status;
  }
}

function invalidResponse(message) {
  return new BannerTogetherLiveApiError(message, {
    code: "INVALID_LIVE_ROOM_RESPONSE",
  });
}

function assertExactKeys(value, expectedKeys, label, errorFactory = Error) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new errorFactory(`${label} must be an object.`);
  }

  const actualKeys = Object.keys(value);

  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => !expectedKeys.includes(key))
  ) {
    throw new errorFactory(`${label} contains unexpected fields.`);
  }

  return value;
}

function normalizeResponseValue(normalizer, label) {
  try {
    return normalizer();
  } catch (error) {
    if (error instanceof BannerTogetherLiveApiError) {
      throw error;
    }

    throw invalidResponse(`${label} is invalid.`);
  }
}

function normalizeCanonicalDate(value, label) {
  if (typeof value !== "string") {
    throw invalidResponse(`${label} must be an ISO date string.`);
  }

  const parsedDate = new Date(value);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString() !== value
  ) {
    throw invalidResponse(`${label} must be a canonical ISO date string.`);
  }

  return value;
}

function normalizeEventId(value, { allowZero = false } = {}) {
  const minimum = allowZero ? 0 : 1;

  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_EVENT_ID) {
    throw new Error(`Live room event ID must be at least ${minimum}.`);
  }

  return value;
}

function getRoomPath(roomId, suffix = "") {
  return `${BANNER_TOGETHER_LIVE_API_BASE_PATH}/${encodeURIComponent(
    validateBannerTogetherLiveRoomId(roomId)
  )}${suffix}`;
}

function normalizeIdentity(roomVerifier, participantId, participantVerifier) {
  const normalizedRoomVerifier =
    validateBannerTogetherLiveRoomVerifier(roomVerifier);
  const normalizedParticipantVerifier =
    validateBannerTogetherLiveParticipantVerifier(participantVerifier);

  if (normalizedRoomVerifier === normalizedParticipantVerifier) {
    throw new Error(
      "Room and participant verifiers must be independently generated."
    );
  }

  return {
    roomVerifier: normalizedRoomVerifier,
    participantId: validateBannerTogetherLiveParticipantId(participantId),
    participantVerifier: normalizedParticipantVerifier,
  };
}

function getErrorFallback(status) {
  if (status === 400) {
    return ["LIVE_ROOM_INVALID_REQUEST", "The live room request was invalid."];
  }

  if (status === 401 || status === 403) {
    return ["LIVE_ROOM_ACCESS_DENIED", "This browser cannot access that live room."];
  }

  if (status === 404) {
    return ["LIVE_ROOM_NOT_FOUND", "This live room does not exist or has expired."];
  }

  if (status === 409) {
    return ["LIVE_ROOM_EVENTS_EXPIRED", "Live room signaling events expired."];
  }

  if (status === 410) {
    return ["LIVE_ROOM_GONE", "This live room has ended."];
  }

  if (status === 429) {
    return ["LIVE_ROOM_RATE_LIMITED", "Too many live room requests were made."];
  }

  return ["LIVE_ROOM_REQUEST_FAILED", "The live room service request failed."];
}

async function readOptionalError(response) {
  try {
    const payload = await response.json();

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {};
    }

    const nested = payload.error;
    return nested && typeof nested === "object" && !Array.isArray(nested)
      ? nested
      : payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    return {};
  }
}

async function throwResponseError(response) {
  const [fallbackCode, fallbackMessage] = getErrorFallback(response.status);
  const payload = await readOptionalError(response);

  throw new BannerTogetherLiveApiError(
    typeof payload.message === "string" && payload.message
      ? payload.message
      : fallbackMessage,
    {
      code:
        typeof payload.code === "string" && payload.code
          ? payload.code
          : fallbackCode,
      status: response.status,
    }
  );
}

async function liveFetch(
  path,
  { method = "GET", participantToken = null, body = null, signal = null } = {}
) {
  const headers = new Headers({ Accept: "application/json" });

  if (participantToken !== null) {
    headers.set(
      "Authorization",
      `Bearer ${validateBannerTogetherLiveParticipantToken(participantToken)}`
    );
  }

  if (body !== null) {
    headers.set("Content-Type", "application/json");
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

    throw new BannerTogetherLiveApiError(
      "The live room signaling service could not be reached.",
      { code: "LIVE_ROOM_NETWORK_ERROR" }
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

    throw invalidResponse(`${label} was not valid JSON.`);
  }
}

function normalizePeers(value) {
  if (!Array.isArray(value) || value.length > MAX_PEERS) {
    throw invalidResponse("Live room peers must be a bounded array.");
  }

  const peers = value.map((participantId) =>
    normalizeResponseValue(
      () => validateBannerTogetherLiveParticipantId(participantId),
      "Live room peer ID"
    )
  );

  if (new Set(peers).size !== peers.length) {
    throw invalidResponse("Live room peers must be unique.");
  }

  return peers;
}

function normalizeJoinResponse(payload, expectedRoomId = null) {
  try {
    assertExactKeys(
      payload,
      [
        "version",
        "roomId",
        "participantToken",
        "expiresAt",
        "peers",
      ],
      "Live room join response",
      BannerTogetherLiveApiError
    );
  } catch (error) {
    if (error instanceof BannerTogetherLiveApiError) {
      throw invalidResponse(error.message);
    }

    throw error;
  }

  if (payload.version !== BANNER_TOGETHER_LIVE_VERSION) {
    throw invalidResponse("Live room join response has an unsupported version.");
  }

  const roomId = normalizeResponseValue(
    () => validateBannerTogetherLiveRoomId(payload.roomId),
    "Live room join response roomId"
  );

  if (expectedRoomId !== null && roomId !== expectedRoomId) {
    throw invalidResponse("Live room response belongs to a different room.");
  }

  return {
    version: BANNER_TOGETHER_LIVE_VERSION,
    roomId,
    participantToken: normalizeResponseValue(
      () =>
        validateBannerTogetherLiveParticipantToken(payload.participantToken),
      "Live room participant token"
    ),
    expiresAt: normalizeCanonicalDate(payload.expiresAt, "Live room expiresAt"),
    peers: normalizePeers(payload.peers),
  };
}

function hasRequiredSdpLines(sdp) {
  const lines = sdp.split(/\r?\n/);
  return (
    !sdp.includes("\u0000") &&
    lines.every((line, index) =>
      line === "" && index === lines.length - 1
        ? true
        : /^[a-z]=[^\u0000\r\n]*$/.test(line)
    ) &&
    lines[0] === "v=0" &&
    lines.some((line) => line.startsWith("o=")) &&
    lines.some((line) => line.startsWith("s=")) &&
    lines.some((line) => line.startsWith("t=")) &&
    lines.some((line) => line.startsWith("m="))
  );
}

export function validateBannerTogetherLiveDescription(description) {
  assertExactKeys(
    description,
    ["type", "sdp"],
    "Live room session description"
  );

  if (description.type !== "offer" && description.type !== "answer") {
    throw new Error("Live room description type must be offer or answer.");
  }

  if (
    typeof description.sdp !== "string" ||
    description.sdp.length === 0 ||
    new TextEncoder().encode(description.sdp).byteLength > MAX_SDP_LENGTH ||
    !hasRequiredSdpLines(description.sdp)
  ) {
    throw new Error("Live room session description SDP is invalid.");
  }

  return { type: description.type, sdp: description.sdp };
}

export function validateBannerTogetherLiveIceCandidate(candidate) {
  assertExactKeys(
    candidate,
    ["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"],
    "Live room ICE candidate"
  );

  if (
    typeof candidate.candidate !== "string" ||
    new TextEncoder().encode(candidate.candidate).byteLength >
      MAX_CANDIDATE_LENGTH ||
    candidate.candidate.includes("\r") ||
    candidate.candidate.includes("\n") ||
    (candidate.candidate !== "" &&
      !/^candidate:[^\s]{1,256} \d{1,10} (?:udp|tcp) \d{1,10} [^\s]{1,256} \d{1,5} typ (?:host|srflx|prflx|relay)(?: .*)?$/i.test(
        candidate.candidate
      ))
  ) {
    throw new Error("Live room ICE candidate string is invalid.");
  }

  if (
    candidate.sdpMid !== null &&
    (typeof candidate.sdpMid !== "string" ||
      candidate.sdpMid.length > 256)
  ) {
    throw new Error("Live room ICE candidate sdpMid is invalid.");
  }

  if (
    candidate.sdpMLineIndex !== null &&
    (!Number.isInteger(candidate.sdpMLineIndex) ||
      candidate.sdpMLineIndex < 0 ||
      candidate.sdpMLineIndex > 65535)
  ) {
    throw new Error("Live room ICE candidate m-line index is invalid.");
  }

  if (
    candidate.usernameFragment !== null &&
    (typeof candidate.usernameFragment !== "string" ||
      candidate.usernameFragment.length === 0 ||
      candidate.usernameFragment.length > 256)
  ) {
    throw new Error("Live room ICE candidate username fragment is invalid.");
  }

  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}

function normalizeSignalEvent(event) {
  const hasDescription = Object.prototype.hasOwnProperty.call(
    event,
    "description"
  );
  const hasCandidate = Object.prototype.hasOwnProperty.call(event, "candidate");

  if (hasDescription === hasCandidate) {
    throw invalidResponse("Live room signal event has invalid content.");
  }

  try {
    assertExactKeys(
      event,
      hasDescription
        ? ["id", "type", "fromParticipantId", "description"]
        : ["id", "type", "fromParticipantId", "candidate"],
      "Live room signal event",
      BannerTogetherLiveApiError
    );
  } catch (error) {
    throw invalidResponse(error.message);
  }
  const normalized = {
    id: normalizeResponseValue(
      () => normalizeEventId(event.id),
      "Live room signal event ID"
    ),
    type: "signal",
    fromParticipantId: normalizeResponseValue(
      () => validateBannerTogetherLiveParticipantId(event.fromParticipantId),
      "Live room signal sender"
    ),
  };

  try {
    if (hasDescription) {
      normalized.description = validateBannerTogetherLiveDescription(
        event.description
      );
    } else {
      normalized.candidate = validateBannerTogetherLiveIceCandidate(
        event.candidate
      );
    }
  } catch {
    throw invalidResponse("Live room signal event payload is invalid.");
  }

  return normalized;
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw invalidResponse("Live room event must be an object.");
  }

  if (event.type === "signal") {
    return normalizeSignalEvent(event);
  }

  if (
    event.type !== "peer-joined" &&
    event.type !== "peer-rejoined" &&
    event.type !== "peer-left"
  ) {
    throw invalidResponse("Live room event type is invalid.");
  }

  try {
    assertExactKeys(
      event,
      ["id", "type", "participantId"],
      "Live room presence event",
      BannerTogetherLiveApiError
    );
  } catch (error) {
    throw invalidResponse(error.message);
  }

  return {
    id: normalizeResponseValue(
      () => normalizeEventId(event.id),
      "Live room presence event ID"
    ),
    type: event.type,
    participantId: normalizeResponseValue(
      () => validateBannerTogetherLiveParticipantId(event.participantId),
      "Live room presence participant ID"
    ),
  };
}

function normalizePollResponse(payload, after) {
  try {
    assertExactKeys(
      payload,
      ["version", "events", "nextEventId", "expiresAt", "peers"],
      "Live room event response",
      BannerTogetherLiveApiError
    );
  } catch (error) {
    throw invalidResponse(error.message);
  }

  if (payload.version !== BANNER_TOGETHER_LIVE_VERSION) {
    throw invalidResponse("Live room event response has an unsupported version.");
  }

  if (!Array.isArray(payload.events) || payload.events.length > 256) {
    throw invalidResponse("Live room events must be a bounded array.");
  }

  const events = payload.events.map(normalizeEvent);
  let previousId = after;

  events.forEach((event) => {
    if (event.id <= previousId) {
      throw invalidResponse("Live room events are not strictly ordered.");
    }

    previousId = event.id;
  });

  const nextEventId = normalizeResponseValue(
    () => normalizeEventId(payload.nextEventId, { allowZero: true }),
    "Live room next event ID"
  );

  if (nextEventId < previousId) {
    throw invalidResponse("Live room next event ID precedes its events.");
  }

  return {
    version: BANNER_TOGETHER_LIVE_VERSION,
    events,
    nextEventId,
    expiresAt: normalizeCanonicalDate(payload.expiresAt, "Live room expiresAt"),
    peers: normalizePeers(payload.peers),
  };
}

export async function createBannerTogetherLiveRoom({
  roomVerifier,
  participantId,
  participantVerifier,
  signal = null,
}) {
  const identity = normalizeIdentity(
    roomVerifier,
    participantId,
    participantVerifier
  );
  const response = await liveFetch(BANNER_TOGETHER_LIVE_API_BASE_PATH, {
    method: "POST",
    signal,
    body: {
      version: BANNER_TOGETHER_LIVE_VERSION,
      ...identity,
    },
  });

  if (!response.ok) {
    await throwResponseError(response);
  }

  return normalizeJoinResponse(
    await readJsonResponse(response, "Create live room response")
  );
}

export async function joinBannerTogetherLiveRoom({
  roomId,
  roomVerifier,
  participantId,
  participantVerifier,
  participantToken = null,
  signal = null,
}) {
  const normalizedRoomId = validateBannerTogetherLiveRoomId(roomId);
  const identity = normalizeIdentity(
    roomVerifier,
    participantId,
    participantVerifier
  );
  const response = await liveFetch(getRoomPath(normalizedRoomId, "/join"), {
    method: "POST",
    participantToken,
    signal,
    body: {
      version: BANNER_TOGETHER_LIVE_VERSION,
      ...identity,
    },
  });

  if (!response.ok) {
    await throwResponseError(response);
  }

  return normalizeJoinResponse(
    await readJsonResponse(response, "Join live room response"),
    normalizedRoomId
  );
}

export async function pollBannerTogetherLiveEvents({
  roomId,
  participantToken,
  after = 0,
  signal = null,
}) {
  const normalizedAfter = normalizeEventId(after, { allowZero: true });
  const response = await liveFetch(
    `${getRoomPath(roomId, "/events")}?after=${normalizedAfter}`,
    { participantToken, signal }
  );

  if (!response.ok) {
    await throwResponseError(response);
  }

  return normalizePollResponse(
    await readJsonResponse(response, "Live room events response"),
    normalizedAfter
  );
}

async function sendSignal({
  roomId,
  participantToken,
  toParticipantId,
  payload,
  signal,
}) {
  const response = await liveFetch(getRoomPath(roomId, "/signals"), {
    method: "POST",
    participantToken,
    signal,
    body: {
      version: BANNER_TOGETHER_LIVE_VERSION,
      toParticipantId: validateBannerTogetherLiveParticipantId(
        toParticipantId
      ),
      ...payload,
    },
  });

  if (!response.ok) {
    await throwResponseError(response);
  }

  return { sent: true };
}

export function sendBannerTogetherLiveDescription({
  roomId,
  participantToken,
  toParticipantId,
  description,
  signal = null,
}) {
  return sendSignal({
    roomId,
    participantToken,
    toParticipantId,
    signal,
    payload: {
      description: validateBannerTogetherLiveDescription(description),
    },
  });
}

export function sendBannerTogetherLiveIceCandidate({
  roomId,
  participantToken,
  toParticipantId,
  candidate,
  signal = null,
}) {
  return sendSignal({
    roomId,
    participantToken,
    toParticipantId,
    signal,
    payload: {
      candidate: validateBannerTogetherLiveIceCandidate(candidate),
    },
  });
}

export async function leaveBannerTogetherLiveRoom({
  roomId,
  participantToken,
  signal = null,
}) {
  const response = await liveFetch(
    getRoomPath(roomId, "/participants/me"),
    { method: "DELETE", participantToken, signal }
  );

  if (!response.ok) {
    await throwResponseError(response);
  }

  return { left: true };
}
