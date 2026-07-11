import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BASE_PATH = "/_openbanners/banner-together/v3";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY_BYTES = 24 * 1024;
const MAX_ROOMS = 100;
const MAX_PARTICIPANTS = 8;
const MAX_EVENTS_PER_ROOM = 256;
const MAX_EVENT_BYTES_PER_ROOM = 512 * 1024;
const MAX_EVENT_BYTES_GLOBAL = 16 * 1024 * 1024;
const MAX_RATE_BUCKETS = 10_000;
const DEFAULT_ROOM_TTL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_PEER_INACTIVE_MS = 90 * 1000;
const DEFAULT_LONG_POLL_MS = 15 * 1000;
const DEFAULT_EVENT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) {
    return false;
  }

  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isCanonicalBase64Url(value, byteLength, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === byteLength && decoded.toString("base64url") === value;
}

function isRoomId(value) {
  return isCanonicalBase64Url(value, 16, ROOM_ID_PATTERN);
}

function isParticipantId(value) {
  return isCanonicalBase64Url(value, 16, PARTICIPANT_ID_PATTERN);
}

function isSecret(value) {
  return isCanonicalBase64Url(value, 32, SECRET_PATTERN);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("base64url");
}

function publicEvent(event) {
  const result = {
    id: event.id,
    type: event.type,
  };

  if (event.participantId) {
    result.participantId = event.participantId;
  }
  if (event.fromParticipantId) {
    result.fromParticipantId = event.fromParticipantId;
  }
  if (event.description) {
    result.description = event.description;
  }
  if (event.candidate) {
    result.candidate = event.candidate;
  }

  return result;
}

function writeJson(response, status, value, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

function writeNoContent(response) {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  response.writeHead(204, {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end();
}

function writeError(response, error) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : "internal_error";
  const message = error instanceof ApiError
    ? error.message
    : "The signaling service could not complete the request.";
  const headers = status === 429 ? { "Retry-After": "60" } : {};
  writeJson(response, status, { error: { code, message } }, headers);
}

async function readJson(request) {
  const contentType = request.headers["content-type"] || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new ApiError(415, "unsupported_media_type", "Use application/json.");
  }

  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "body_too_large", "The request body is too large.");
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      throw new ApiError(413, "body_too_large", "The request body is too large.");
    }
    chunks.push(chunk);
  }

  if (length === 0) {
    throw new ApiError(400, "invalid_json", "A JSON request body is required.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

function validateIdentityBody(value) {
  if (!hasExactKeys(value, [
    "version",
    "roomVerifier",
    "participantId",
    "participantVerifier",
  ])
    || value.version !== 3
    || !isSecret(value.roomVerifier)
    || !isParticipantId(value.participantId)
    || !isSecret(value.participantVerifier)
    || safeEqual(value.participantVerifier, value.roomVerifier)) {
    throw new ApiError(400, "invalid_request", "The room identity request is invalid.");
  }
  return value;
}

function isValidSdp(sdp) {
  if (typeof sdp !== "string" || sdp.length < 1
    || Buffer.byteLength(sdp) > 16 * 1024
    || sdp.includes("\0")) {
    return false;
  }
  const lines = sdp.split(/\r\n|\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines[0] === "v=0"
    && lines.every((line) => /^[a-z]=[^\r\n]*$/.test(line))
    && lines.some((line) => line.startsWith("o="))
    && lines.some((line) => line.startsWith("s="))
    && lines.some((line) => line.startsWith("t="))
    && lines.some((line) => line.startsWith("m="));
}

function isValidIceCandidate(candidate) {
  return candidate === "" || (
    Buffer.byteLength(candidate) <= 4096
    && !candidate.includes("\r")
    && !candidate.includes("\n")
    && /^candidate:[^\s]{1,256} \d{1,10} (?:udp|tcp) \d{1,10} [^\s]{1,256} \d{1,5} typ (?:host|srflx|prflx|relay)(?: .*)?$/i.test(candidate)
  );
}

function validateSignalBody(value) {
  if (!isPlainObject(value) || value.version !== 3
    || !isParticipantId(value.toParticipantId)) {
    throw new ApiError(400, "invalid_signal", "The WebRTC signal is invalid.");
  }

  const hasDescription = Object.hasOwn(value, "description");
  const hasCandidate = Object.hasOwn(value, "candidate");
  if (hasDescription === hasCandidate) {
    throw new ApiError(400, "invalid_signal", "Send one WebRTC description or ICE candidate.");
  }

  if (hasDescription) {
    if (!hasExactKeys(value, ["version", "toParticipantId", "description"])
      || !hasExactKeys(value.description, ["type", "sdp"])
      || !["offer", "answer"].includes(value.description.type)
      || !isValidSdp(value.description.sdp)) {
      throw new ApiError(400, "invalid_signal", "The WebRTC description is invalid.");
    }
    return {
      toParticipantId: value.toParticipantId,
      description: {
        type: value.description.type,
        sdp: value.description.sdp,
      },
    };
  }

  if (!hasExactKeys(value, ["version", "toParticipantId", "candidate"])
    || !hasExactKeys(value.candidate, [
      "candidate",
      "sdpMid",
      "sdpMLineIndex",
      "usernameFragment",
    ])
    || typeof value.candidate.candidate !== "string"
    || !isValidIceCandidate(value.candidate.candidate)
    || !(value.candidate.sdpMid === null
      || (typeof value.candidate.sdpMid === "string" && value.candidate.sdpMid.length <= 256))
    || !(value.candidate.sdpMLineIndex === null
      || (Number.isInteger(value.candidate.sdpMLineIndex)
        && value.candidate.sdpMLineIndex >= 0
        && value.candidate.sdpMLineIndex <= 65535))
    || !(value.candidate.usernameFragment === null
      || (typeof value.candidate.usernameFragment === "string"
        && value.candidate.usernameFragment.length > 0
        && value.candidate.usernameFragment.length <= 256))) {
    throw new ApiError(400, "invalid_signal", "The ICE candidate is invalid.");
  }

  return {
    toParticipantId: value.toParticipantId,
    candidate: {
      candidate: value.candidate.candidate,
      sdpMid: value.candidate.sdpMid,
      sdpMLineIndex: value.candidate.sdpMLineIndex,
      usernameFragment: value.candidate.usernameFragment,
    },
  };
}

function parseBearer(request) {
  const authorization = request.headers.authorization;
  const match = typeof authorization === "string"
    ? authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/)
    : null;
  if (!match || !isSecret(match[1])) {
    throw new ApiError(401, "unauthorized", "A valid participant token is required.");
  }
  return match[1];
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  const fetchSite = request.headers["sec-fetch-site"];

  if (fetchSite && fetchSite !== "same-origin") {
    throw new ApiError(403, "cross_origin_denied", "Cross-origin requests are not allowed.");
  }

  if (origin) {
    const forwardedProto = request.headers["x-forwarded-proto"];
    const protocol = forwardedProto === "https" ? "https" : "http";
    const host = request.headers["x-forwarded-host"] || request.headers.host;
    let actualOrigin;
    try {
      actualOrigin = new URL(origin).origin;
    } catch {
      throw new ApiError(403, "cross_origin_denied", "Cross-origin requests are not allowed.");
    }
    if (!host || actualOrigin !== `${protocol}://${host}`) {
      throw new ApiError(403, "cross_origin_denied", "Cross-origin requests are not allowed.");
    }
    return;
  }

  if (fetchSite !== "same-origin") {
    throw new ApiError(403, "cross_origin_denied", "Same-origin request metadata is required.");
  }
}

function roomResponse(room, participantId, participantToken) {
  return {
    version: 3,
    roomId: room.id,
    participantToken,
    expiresAt: new Date(room.expiresAt).toISOString(),
    peers: [...room.participants.keys()]
      .filter((id) => id !== participantId)
      .sort(),
  };
}

function eventsResponse(room, participantId, events) {
  return {
    version: 3,
    events: events.map(publicEvent),
    nextEventId: room.nextEventId,
    expiresAt: new Date(room.expiresAt).toISOString(),
    peers: [...room.participants.keys()]
      .filter((id) => id !== participantId)
      .sort(),
  };
}

export function createSignalingServer(options = {}) {
  const now = options.now || Date.now;
  const makeRandomBytes = options.randomBytes || randomBytes;
  const roomTtlMs = options.roomTtlMs || DEFAULT_ROOM_TTL_MS;
  const peerInactiveMs = options.peerInactiveMs || DEFAULT_PEER_INACTIVE_MS;
  const longPollMs = Math.min(options.longPollMs || DEFAULT_LONG_POLL_MS, DEFAULT_LONG_POLL_MS);
  const eventTtlMs = options.eventTtlMs || DEFAULT_EVENT_TTL_MS;
  const rooms = new Map();
  const rateBuckets = new Map();
  const ipSalt = makeRandomBytes(32);
  let totalEventBytes = 0;
  let eventOrder = 0;

  function hashClientIp(request) {
    const rawIp = String(request.headers["x-real-ip"] || request.socket.remoteAddress || "unknown");
    return createHash("sha256").update(ipSalt).update(rawIp).digest("base64url");
  }

  function takeRate(request, kind, maximum, windowMs) {
    const currentTime = now();
    const key = `${hashClientIp(request)}:${kind}`;
    if (!rateBuckets.has(key) && rateBuckets.size >= MAX_RATE_BUCKETS) {
      throw new ApiError(503, "signal_capacity", "The signaling service is at capacity.");
    }
    const cutoff = currentTime - windowMs;
    const timestamps = (rateBuckets.get(key) || []).filter((timestamp) => timestamp > cutoff);
    if (timestamps.length >= maximum) {
      rateBuckets.set(key, timestamps);
      throw new ApiError(429, "rate_limited", "Too many signaling requests were sent.");
    }
    timestamps.push(currentTime);
    rateBuckets.set(key, timestamps);
  }

  function removeOldestGlobalEvent() {
    let selectedRoom = null;
    let selectedEvent = null;
    for (const room of rooms.values()) {
      const candidate = room.events[0];
      if (candidate && (!selectedEvent || candidate._order < selectedEvent._order)) {
        selectedRoom = room;
        selectedEvent = candidate;
      }
    }
    if (!selectedRoom) {
      return false;
    }
    discardOldestEvent(selectedRoom);
    return true;
  }

  function discardOldestEvent(room) {
    const removed = room.events.shift();
    if (!removed) {
      return false;
    }
    room.eventBytes -= removed._bytes;
    totalEventBytes -= removed._bytes;
    room.discardedThrough = Math.max(room.discardedThrough, removed.id);
    return true;
  }

  function isEventFor(event, participantId) {
    return (!event._to || event._to === participantId)
      && (!event._except || event._except !== participantId);
  }

  function matchingEvents(room, participantId, after) {
    return room.events.filter((event) => event.id > after && isEventFor(event, participantId));
  }

  function finishWaiter(room, waiter, error = null) {
    if (!room.waiters.delete(waiter)) {
      return;
    }
    clearTimeout(waiter.timeout);
    waiter.response.off("close", waiter.onClose);
    if (error) {
      writeError(waiter.response, error);
      waiter.resolve();
      return;
    }
    const events = matchingEvents(room, waiter.participantId, waiter.after);
    writeJson(waiter.response, 200, eventsResponse(room, waiter.participantId, events));
    waiter.resolve();
  }

  function flushWaiters(room) {
    for (const waiter of [...room.waiters]) {
      if (waiter.after < room.discardedThrough) {
        finishWaiter(room, waiter, new ApiError(
          409,
          "events_expired",
          "The signaling cursor expired; reconnect to the listed peers.",
        ));
      } else if (matchingEvents(room, waiter.participantId, waiter.after).length > 0) {
        finishWaiter(room, waiter);
      }
    }
  }

  function appendEvent(room, value, routing = {}) {
    const event = {
      id: ++room.nextEventId,
      ...value,
      _to: routing.to || null,
      _except: routing.except || null,
      _order: ++eventOrder,
      _createdAt: now(),
    };
    event._bytes = Buffer.byteLength(JSON.stringify(publicEvent(event)));

    while (totalEventBytes + event._bytes > MAX_EVENT_BYTES_GLOBAL) {
      if (!removeOldestGlobalEvent()) {
        throw new ApiError(503, "signal_capacity", "The signaling service is at capacity.");
      }
    }

    room.events.push(event);
    room.eventBytes += event._bytes;
    totalEventBytes += event._bytes;

    while (room.events.length > MAX_EVENTS_PER_ROOM
      || room.eventBytes > MAX_EVENT_BYTES_PER_ROOM) {
      discardOldestEvent(room);
    }
    flushWaiters(room);
  }

  function destroyRoom(room, error = null) {
    rooms.delete(room.id);
    totalEventBytes -= room.eventBytes;
    room.eventBytes = 0;
    room.events = [];
    for (const waiter of [...room.waiters]) {
      finishWaiter(room, waiter, error || new ApiError(404, "room_not_found", "The room is unavailable."));
    }
  }

  function removeParticipant(room, participantId, reason = "peer-left") {
    const participant = room.participants.get(participantId);
    if (!participant) {
      return;
    }
    room.participants.delete(participantId);
    for (const waiter of [...room.waiters]) {
      if (waiter.participantId === participantId) {
        finishWaiter(room, waiter, new ApiError(401, "participant_inactive", "The participant is no longer active."));
      }
    }
    if (room.participants.size === 0) {
      destroyRoom(room);
      return;
    }
    appendEvent(room, { type: reason, participantId }, { except: participantId });
  }

  function cleanup() {
    const currentTime = now();
    for (const room of [...rooms.values()]) {
      if (room.expiresAt <= currentTime) {
        destroyRoom(room, new ApiError(410, "room_expired", "The room has expired."));
        continue;
      }
      while (room.events[0] && room.events[0]._createdAt + eventTtlMs <= currentTime) {
        discardOldestEvent(room);
      }
      flushWaiters(room);
      for (const [participantId, participant] of [...room.participants]) {
        if (participant.lastSeen + peerInactiveMs <= currentTime) {
          removeParticipant(room, participantId);
        }
      }
    }

    const quotaCutoff = currentTime - 10 * 60 * 1000;
    for (const [key, timestamps] of rateBuckets) {
      const active = timestamps.filter((timestamp) => timestamp > quotaCutoff);
      if (active.length === 0) {
        rateBuckets.delete(key);
      } else {
        rateBuckets.set(key, active);
      }
    }
  }

  function requireRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) {
      throw new ApiError(404, "room_not_found", "The room is unavailable.");
    }
    return room;
  }

  function authenticate(room, request) {
    const hash = tokenHash(parseBearer(request));
    for (const [participantId, participant] of room.participants) {
      if (safeEqual(hash, participant.tokenHash)) {
        participant.lastSeen = now();
        return { participantId, participant };
      }
    }
    throw new ApiError(401, "unauthorized", "A valid participant token is required.");
  }

  function closeParticipantWaiters(room, participantId) {
    for (const waiter of [...room.waiters]) {
      if (waiter.participantId === participantId) {
        finishWaiter(room, waiter, new ApiError(
          401,
          "participant_rejoined",
          "The participant token was rotated.",
        ));
      }
    }
  }

  function createParticipant(room, participantId, participantVerifierHash) {
    const participantToken = makeRandomBytes(32).toString("base64url");
    room.participantVerifierHashes.set(participantId, participantVerifierHash);
    room.participants.set(participantId, {
      tokenHash: tokenHash(participantToken),
      lastSeen: now(),
      eventFloor: room.nextEventId,
    });
    return participantToken;
  }

  function waitForEvents(request, response, room, participantId, after) {
    const effectiveAfter = Math.max(after, room.participants.get(participantId).eventFloor);
    if (effectiveAfter < room.discardedThrough) {
      throw new ApiError(409, "events_expired", "The signaling cursor expired; reconnect to the listed peers.");
    }

    const available = matchingEvents(room, participantId, effectiveAfter);
    if (available.length > 0 || longPollMs <= 0) {
      writeJson(response, 200, eventsResponse(room, participantId, available));
      return Promise.resolve();
    }

    for (const waiter of [...room.waiters]) {
      if (waiter.participantId === participantId) {
        finishWaiter(room, waiter);
      }
    }

    return new Promise((resolveWaiter) => {
      const waiter = {
        participantId,
        after: effectiveAfter,
        request,
        response,
        resolve: resolveWaiter,
        timeout: null,
        onClose: null,
      };
      waiter.onClose = () => {
        if (room.waiters.delete(waiter)) {
          clearTimeout(waiter.timeout);
          resolveWaiter();
        }
      };
      waiter.timeout = setTimeout(() => finishWaiter(room, waiter), longPollMs);
      response.on("close", waiter.onClose);
      room.waiters.add(waiter);
    });
  }

  async function handleRequest(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");

    const requestUrl = new URL(request.url, "http://localhost");
    if (request.method === "GET" && requestUrl.pathname === `${BASE_PATH}/health`) {
      writeJson(response, 200, { status: "ok", version: 3 });
      return;
    }

    assertSameOrigin(request);
    cleanup();
    takeRate(request, "all", 1200, 60 * 1000);

    const roomsPath = `${BASE_PATH}/rooms`;
    if (requestUrl.pathname === roomsPath) {
      if (request.method !== "POST") {
        throw new ApiError(405, "method_not_allowed", "This endpoint requires POST.");
      }
      takeRate(request, "create", 10, 10 * 60 * 1000);
      const body = validateIdentityBody(await readJson(request));
      const participantVerifierHash = tokenHash(body.participantVerifier);
      const existingRoom = [...rooms.values()].find((room) => (
        safeEqual(room.verifier, body.roomVerifier)
      ));
      if (existingRoom) {
        const creatorVerifierHash = existingRoom.participantVerifierHashes.get(
          existingRoom.creatorParticipantId,
        );
        if (body.participantId !== existingRoom.creatorParticipantId
          || !creatorVerifierHash
          || !safeEqual(participantVerifierHash, creatorVerifierHash)) {
          throw new ApiError(
            409,
            "room_identity_conflict",
            "That room verifier belongs to a different creator identity.",
          );
        }
        closeParticipantWaiters(existingRoom, body.participantId);
        const participantToken = createParticipant(
          existingRoom,
          body.participantId,
          participantVerifierHash,
        );
        appendEvent(existingRoom, {
          type: "peer-rejoined",
          participantId: body.participantId,
        }, { except: body.participantId });
        writeJson(
          response,
          200,
          roomResponse(existingRoom, body.participantId, participantToken),
        );
        return;
      }
      if (rooms.size >= MAX_ROOMS) {
        throw new ApiError(503, "room_capacity", "The signaling service is at room capacity.");
      }
      let roomId;
      do {
        roomId = makeRandomBytes(16).toString("base64url");
      } while (rooms.has(roomId));
      const room = {
        id: roomId,
        verifier: body.roomVerifier,
        creatorParticipantId: body.participantId,
        expiresAt: now() + roomTtlMs,
        participants: new Map(),
        participantVerifierHashes: new Map(),
        events: [],
        eventBytes: 0,
        discardedThrough: 0,
        nextEventId: 0,
        waiters: new Set(),
      };
      rooms.set(roomId, room);
      const participantToken = createParticipant(
        room,
        body.participantId,
        participantVerifierHash,
      );
      writeJson(response, 201, roomResponse(room, body.participantId, participantToken));
      return;
    }

    const roomRoute = requestUrl.pathname.match(new RegExp(
      `^${BASE_PATH}/rooms/([A-Za-z0-9_-]{22})/(join|events|signals|participants/me)$`,
    ));
    if (!roomRoute) {
      throw new ApiError(404, "not_found", "The signaling endpoint does not exist.");
    }

    const [, roomId, action] = roomRoute;
    if (!isRoomId(roomId)) {
      throw new ApiError(404, "room_not_found", "The room is unavailable.");
    }
    const room = requireRoom(roomId);

    if (action === "join") {
      if (request.method !== "POST") {
        throw new ApiError(405, "method_not_allowed", "This endpoint requires POST.");
      }
      takeRate(request, "join", 120, 10 * 60 * 1000);
      const body = validateIdentityBody(await readJson(request));
      if (!safeEqual(body.roomVerifier, room.verifier)) {
        throw new ApiError(404, "room_not_found", "The room is unavailable.");
      }
      const participantVerifierHash = tokenHash(body.participantVerifier);
      const knownVerifierHash = room.participantVerifierHashes.get(body.participantId);
      const isRejoin = Boolean(knownVerifierHash);
      if (knownVerifierHash && !safeEqual(participantVerifierHash, knownVerifierHash)) {
        throw new ApiError(
          409,
          "participant_identity_conflict",
          "That participant ID belongs to a different identity.",
        );
      }
      if (!isRejoin && room.participantVerifierHashes.size >= MAX_PARTICIPANTS) {
        throw new ApiError(409, "room_full", "The room already has eight participant identities.");
      }
      if (room.participants.has(body.participantId)) {
        closeParticipantWaiters(room, body.participantId);
      }
      const participantToken = createParticipant(
        room,
        body.participantId,
        participantVerifierHash,
      );
      appendEvent(room, {
        type: isRejoin ? "peer-rejoined" : "peer-joined",
        participantId: body.participantId,
      }, { except: body.participantId });
      writeJson(response, 200, roomResponse(room, body.participantId, participantToken));
      return;
    }

    const { participantId } = authenticate(room, request);

    if (action === "events") {
      if (request.method !== "GET") {
        throw new ApiError(405, "method_not_allowed", "This endpoint requires GET.");
      }
      if ([...requestUrl.searchParams.keys()].some((key) => key !== "after")
        || requestUrl.searchParams.getAll("after").length !== 1
        || !/^\d+$/.test(requestUrl.searchParams.get("after") || "")) {
        throw new ApiError(400, "invalid_cursor", "A non-negative event cursor is required.");
      }
      const after = Number(requestUrl.searchParams.get("after"));
      if (!Number.isSafeInteger(after)) {
        throw new ApiError(400, "invalid_cursor", "The event cursor is invalid.");
      }
      await waitForEvents(request, response, room, participantId, after);
      return;
    }

    if (action === "signals") {
      if (request.method !== "POST") {
        throw new ApiError(405, "method_not_allowed", "This endpoint requires POST.");
      }
      takeRate(request, "signal", 900, 60 * 1000);
      const signal = validateSignalBody(await readJson(request));
      if (signal.toParticipantId === participantId) {
        throw new ApiError(400, "invalid_signal", "A participant cannot signal itself.");
      }
      if (!room.participants.has(signal.toParticipantId)) {
        throw new ApiError(404, "peer_not_found", "The destination participant is unavailable.");
      }
      appendEvent(room, {
        type: "signal",
        fromParticipantId: participantId,
        ...(signal.description ? { description: signal.description } : {}),
        ...(signal.candidate ? { candidate: signal.candidate } : {}),
      }, { to: signal.toParticipantId });
      writeNoContent(response);
      return;
    }

    if (request.method !== "DELETE") {
      throw new ApiError(405, "method_not_allowed", "This endpoint requires DELETE.");
    }
    removeParticipant(room, participantId);
    writeNoContent(response);
  }

  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      writeError(response, error);
    });
  });

  const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  const signaling = {
    server,
    cleanup,
    async listen(port = 8787, host = "127.0.0.1") {
      await new Promise((resolveListen, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          resolveListen();
        });
      });
      return server.address();
    },
    async close() {
      clearInterval(cleanupTimer);
      for (const room of [...rooms.values()]) {
        destroyRoom(room, new ApiError(503, "server_stopping", "The signaling service is restarting."));
      }
      if (!server.listening) {
        return;
      }
      await new Promise((resolveClose, reject) => {
        server.close((error) => error ? reject(error) : resolveClose());
      });
    },
  };

  if (options.exposeStateForTests === true) {
    signaling.inspectStateForTests = () => [...rooms.values()].map((room) => ({
      roomId: room.id,
      participantVerifierHashes: [...room.participantVerifierHashes].map(
        ([participantId, participantVerifierHash]) => ({
          participantId,
          participantVerifierHash,
        }),
      ),
    }));
  }

  return signaling;
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const signaling = createSignalingServer();
  await signaling.listen(8787, "127.0.0.1");
  process.stdout.write("Banner Together signaling listening on 127.0.0.1:8787\n");

  const shutdown = async () => {
    await signaling.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
