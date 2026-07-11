import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BASE_PATH, createSignalingServer } from "./banner-together-signal.mjs";

const verifier = (value = 1) => Buffer.alloc(32, value).toString("base64url");
const participantVerifier = (value = 101) => verifier(value);
const participantId = (value) => Buffer.alloc(16, value).toString("base64url");
const base64UrlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function nonCanonicalTrailingBits(value) {
  const lastIndex = base64UrlAlphabet.indexOf(value.at(-1));
  const changed = `${value.slice(0, -1)}${base64UrlAlphabet[lastIndex + 1]}`;
  assert.deepEqual(Buffer.from(changed, "base64url"), Buffer.from(value, "base64url"));
  assert.notEqual(Buffer.from(changed, "base64url").toString("base64url"), changed);
  return changed;
}
const exampleSdp = [
  "v=0",
  "o=- 461173305144951682 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "a=mid:0",
  "a=sctp-port:5000",
  "",
].join("\r\n");

async function startService(options = {}) {
  const signaling = createSignalingServer({ longPollMs: 30, ...options });
  const address = await signaling.listen(0);
  const origin = `http://127.0.0.1:${address.port}`;

  async function request(path, requestOptions = {}) {
    const headers = {
      Origin: requestOptions.origin === undefined ? origin : requestOptions.origin,
      "Sec-Fetch-Site": requestOptions.fetchSite || "same-origin",
      ...requestOptions.headers,
    };
    if (requestOptions.token) {
      headers.Authorization = `Bearer ${requestOptions.token}`;
    }
    let body;
    if (Object.hasOwn(requestOptions, "json")) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(requestOptions.json);
    } else if (requestOptions.body !== undefined) {
      body = requestOptions.body;
    }
    const response = await fetch(`${origin}${path}`, {
      method: requestOptions.method || "GET",
      headers,
      body,
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  }

  return { signaling, origin, request };
}

async function createRoom(
  request,
  id = participantId(1),
  roomVerifier = verifier(),
  identityVerifier = participantVerifier(),
) {
  const result = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier,
      participantId: id,
      participantVerifier: identityVerifier,
    },
  });
  assert.equal(result.status, 201);
  return result.body;
}

async function joinRoom(
  request,
  roomId,
  id,
  roomVerifier = verifier(),
  identityVerifier = participantVerifier(),
) {
  const result = await request(`${BASE_PATH}/rooms/${roomId}/join`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier,
      participantId: id,
      participantVerifier: identityVerifier,
    },
  });
  assert.equal(result.status, 200);
  return result.body;
}

test("health is public but room requests require same-origin metadata", async (t) => {
  const { signaling, request } = await startService();
  t.after(() => signaling.close());

  const health = await request(`${BASE_PATH}/health`, {
    origin: null,
    headers: { Origin: undefined, "Sec-Fetch-Site": undefined },
  });
  assert.deepEqual(health.body, { status: "ok", version: 3 });
  assert.equal(health.headers.get("cache-control"), "no-store");

  const denied = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    origin: "https://attacker.example",
    fetchSite: "cross-site",
    json: {
      version: 3,
      roomVerifier: verifier(),
      participantId: participantId(1),
      participantVerifier: participantVerifier(),
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "cross_origin_denied");
});

test("creates an ephemeral room and retains only the participant verifier hash", async (t) => {
  const identityVerifier = participantVerifier(77);
  const { signaling, request } = await startService({ exposeStateForTests: true });
  t.after(() => signaling.close());

  const created = await createRoom(
    request,
    participantId(1),
    verifier(),
    identityVerifier,
  );
  assert.equal(created.version, 3);
  assert.match(created.roomId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(created.participantToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(created.peers, []);
  assert.equal("roomVerifier" in created, false);
  assert.equal("participantVerifier" in created, false);
  assert.equal(Date.parse(created.expiresAt) - Date.now() > 3.9 * 60 * 60 * 1000, true);

  const state = signaling.inspectStateForTests();
  const identity = state[0].participantVerifierHashes[0];
  assert.equal(identity.participantId, participantId(1));
  assert.equal(
    identity.participantVerifierHash,
    createHash("sha256").update(identityVerifier).digest("base64url"),
  );
  assert.notEqual(identity.participantVerifierHash, identityVerifier);
  assert.equal(JSON.stringify(state).includes(identityVerifier), false);

  const malformed = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: verifier(2),
      participantId: participantId(2),
      participantVerifier: participantVerifier(3),
      bannerIds: ["must-not-be-accepted"],
    },
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "invalid_request");

  const missingParticipantVerifier = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: verifier(3),
      participantId: participantId(3),
    },
  });
  assert.equal(missingParticipantVerifier.status, 400);
  assert.equal(missingParticipantVerifier.body.error.code, "invalid_request");

  const reusedRoomVerifier = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: verifier(4),
      participantId: participantId(4),
      participantVerifier: verifier(4),
    },
  });
  assert.equal(reusedRoomVerifier.status, 400);
  assert.equal(reusedRoomVerifier.body.error.code, "invalid_request");
});

test("a lost create response retries the same room and rotates its token", async (t) => {
  const { signaling, request } = await startService({ exposeStateForTests: true });
  t.after(() => signaling.close());
  const creatorId = participantId(1);
  const roomIdentityVerifier = verifier(44);
  const creatorVerifier = participantVerifier(45);
  const body = {
    version: 3,
    roomVerifier: roomIdentityVerifier,
    participantId: creatorId,
    participantVerifier: creatorVerifier,
  };

  const first = await request(`${BASE_PATH}/rooms`, { method: "POST", json: body });
  assert.equal(first.status, 201);
  const retry = await request(`${BASE_PATH}/rooms`, { method: "POST", json: body });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.roomId, first.body.roomId);
  assert.notEqual(retry.body.participantToken, first.body.participantToken);
  assert.equal(signaling.inspectStateForTests().length, 1);

  const oldToken = await request(`${BASE_PATH}/rooms/${first.body.roomId}/events?after=0`, {
    token: first.body.participantToken,
  });
  assert.equal(oldToken.status, 401);

  const conflict = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      ...body,
      participantVerifier: participantVerifier(46),
    },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "room_identity_conflict");

  const differentCreator = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      ...body,
      participantId: participantId(2),
    },
  });
  assert.equal(differentCreator.status, 409);
  assert.equal(differentCreator.body.error.code, "room_identity_conflict");
  assert.equal(signaling.inspectStateForTests().length, 1);
});

test("rejects noncanonical base64url identities before they can poison peer events", async (t) => {
  const { signaling, request } = await startService();
  t.after(() => signaling.close());
  const canonicalParticipantId = participantId(0);
  const malformedParticipantId = nonCanonicalTrailingBits(canonicalParticipantId);
  assert.equal(malformedParticipantId, "AAAAAAAAAAAAAAAAAAAAAB");

  const badParticipant = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: verifier(1),
      participantId: malformedParticipantId,
      participantVerifier: participantVerifier(1),
    },
  });
  assert.equal(badParticipant.status, 400);
  assert.equal(badParticipant.body.error.code, "invalid_request");

  const badRoomVerifier = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: nonCanonicalTrailingBits(verifier(2)),
      participantId: participantId(2),
      participantVerifier: participantVerifier(2),
    },
  });
  assert.equal(badRoomVerifier.status, 400);

  const badParticipantVerifier = await request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: verifier(3),
      participantId: participantId(3),
      participantVerifier: nonCanonicalTrailingBits(participantVerifier(3)),
    },
  });
  assert.equal(badParticipantVerifier.status, 400);

  const created = await createRoom(request, participantId(4), verifier(4));
  const guestId = participantId(5);
  await joinRoom(request, created.roomId, guestId, verifier(4), participantVerifier(5));
  const badDestination = await request(`${BASE_PATH}/rooms/${created.roomId}/signals`, {
    method: "POST",
    token: created.participantToken,
    json: {
      version: 3,
      toParticipantId: nonCanonicalTrailingBits(guestId),
      description: { type: "offer", sdp: exampleSdp },
    },
  });
  assert.equal(badDestination.status, 400);
  assert.equal(badDestination.body.error.code, "invalid_signal");
});

test("joins peers and exposes monotonic presence events", async (t) => {
  const { signaling, request } = await startService();
  t.after(() => signaling.close());
  const creatorId = participantId(1);
  const guestId = participantId(2);
  const created = await createRoom(request, creatorId);

  const wrongVerifier = await request(`${BASE_PATH}/rooms/${created.roomId}/join`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: verifier(9),
      participantId: guestId,
      participantVerifier: participantVerifier(2),
    },
  });
  assert.equal(wrongVerifier.status, 404);

  const joined = await joinRoom(request, created.roomId, guestId);
  assert.deepEqual(joined.peers, [creatorId]);

  const events = await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=0`, {
    token: created.participantToken,
  });
  assert.equal(events.status, 200);
  assert.deepEqual(events.body.events, [{
    id: 1,
    type: "peer-joined",
    participantId: guestId,
  }]);
  assert.equal(events.body.nextEventId, 1);
  assert.deepEqual(events.body.peers, [guestId]);
});

test("delivers valid descriptions and ICE candidates only to their destination", async (t) => {
  const { signaling, request } = await startService({ longPollMs: 15 });
  t.after(() => signaling.close());
  const creatorId = participantId(1);
  const guestId = participantId(2);
  const created = await createRoom(request, creatorId);
  const joined = await joinRoom(request, created.roomId, guestId);

  const descriptionResult = await request(`${BASE_PATH}/rooms/${created.roomId}/signals`, {
    method: "POST",
    token: created.participantToken,
    json: {
      version: 3,
      toParticipantId: guestId,
      description: { type: "offer", sdp: exampleSdp },
    },
  });
  assert.equal(descriptionResult.status, 204);

  const guestEvents = await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=0`, {
    token: joined.participantToken,
  });
  assert.deepEqual(guestEvents.body.events, [{
    id: 2,
    type: "signal",
    fromParticipantId: creatorId,
    description: { type: "offer", sdp: exampleSdp },
  }]);

  const creatorEvents = await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=1`, {
    token: created.participantToken,
  });
  assert.deepEqual(creatorEvents.body.events, []);
  assert.equal(creatorEvents.body.nextEventId, 2);

  const candidate = {
    candidate: "candidate:842163049 1 udp 1677734910 192.0.2.1 60769 typ srflx raddr 0.0.0.0 rport 0",
    sdpMid: "0",
    sdpMLineIndex: 0,
    usernameFragment: "example",
  };
  const candidateResult = await request(`${BASE_PATH}/rooms/${created.roomId}/signals`, {
    method: "POST",
    token: joined.participantToken,
    json: { version: 3, toParticipantId: creatorId, candidate },
  });
  assert.equal(candidateResult.status, 204);
  const candidateEvents = await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=2`, {
    token: created.participantToken,
  });
  assert.deepEqual(candidateEvents.body.events[0].candidate, candidate);
});

test("wakes a bounded long poll when a directed signal arrives", async (t) => {
  const { signaling, request } = await startService({ longPollMs: 100 });
  t.after(() => signaling.close());
  const creatorId = participantId(1);
  const guestId = participantId(2);
  const created = await createRoom(request, creatorId);
  const joined = await joinRoom(request, created.roomId, guestId);

  const pendingEvents = request(`${BASE_PATH}/rooms/${created.roomId}/events?after=0`, {
    token: joined.participantToken,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  await request(`${BASE_PATH}/rooms/${created.roomId}/signals`, {
    method: "POST",
    token: created.participantToken,
    json: {
      version: 3,
      toParticipantId: guestId,
      description: { type: "offer", sdp: exampleSdp },
    },
  });

  const events = await pendingEvents;
  assert.equal(events.status, 200);
  assert.equal(events.body.events.length, 1);
  assert.equal(events.body.events[0].fromParticipantId, creatorId);
});

test("rejects generic payloads and strings disguised as WebRTC signals", async (t) => {
  const { signaling, request } = await startService();
  t.after(() => signaling.close());
  const created = await createRoom(request);
  const guestId = participantId(2);
  await joinRoom(request, created.roomId, guestId);
  const path = `${BASE_PATH}/rooms/${created.roomId}/signals`;

  for (const json of [
    { version: 3, toParticipantId: guestId, data: { banners: ["secret"] } },
    {
      version: 3,
      toParticipantId: guestId,
      description: { type: "offer", sdp: JSON.stringify({ banners: ["secret"] }) },
    },
    {
      version: 3,
      toParticipantId: guestId,
      candidate: {
        candidate: "banner-list-data",
        sdpMid: null,
        sdpMLineIndex: null,
        usernameFragment: null,
      },
    },
    {
      version: 3,
      toParticipantId: guestId,
      description: {
        type: "offer",
        sdp: `${exampleSdp}a=x:${"é".repeat(9000)}\r\n`,
      },
    },
    {
      version: 3,
      toParticipantId: guestId,
      candidate: {
        candidate: "candidate:1 1 udp 1 192.0.2.1 10000 typ host\n",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "example",
      },
    },
    {
      version: 3,
      toParticipantId: guestId,
      candidate: {
        candidate: `candidate:1 1 udp 1 192.0.2.1 10000 typ host x ${"é".repeat(
          3000
        )}`,
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "example",
      },
    },
  ]) {
    const result = await request(path, {
      method: "POST",
      token: created.participantToken,
      json,
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "invalid_signal");
  }
});

test("a lost join response can retry while a wrong participant verifier is rejected", async (t) => {
  const { signaling, request } = await startService();
  t.after(() => signaling.close());
  const creatorId = participantId(1);
  const guestId = participantId(2);
  const created = await createRoom(request, creatorId);
  const guestVerifier = participantVerifier(2);
  const firstJoin = await joinRoom(
    request,
    created.roomId,
    guestId,
    verifier(),
    guestVerifier,
  );
  const hijack = await request(`${BASE_PATH}/rooms/${created.roomId}/join`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: verifier(),
      participantId: guestId,
      participantVerifier: participantVerifier(3),
    },
  });
  assert.equal(hijack.status, 409);
  assert.equal(hijack.body.error.code, "participant_identity_conflict");

  const secondJoin = await joinRoom(
    request,
    created.roomId,
    guestId,
    verifier(),
    guestVerifier,
  );
  assert.notEqual(firstJoin.participantToken, secondJoin.participantToken);

  const oldToken = await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=0`, {
    token: firstJoin.participantToken,
  });
  assert.equal(oldToken.status, 401);

  const leave = await request(`${BASE_PATH}/rooms/${created.roomId}/participants/me`, {
    method: "DELETE",
    token: secondJoin.participantToken,
  });
  assert.equal(leave.status, 204);

  const events = await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=1`, {
    token: created.participantToken,
  });
  assert.deepEqual(events.body.events.map((event) => event.type), ["peer-rejoined", "peer-left"]);
});

test("limits rooms to eight participant identities", async (t) => {
  const { signaling, request } = await startService();
  t.after(() => signaling.close());
  const created = await createRoom(request, participantId(1));
  for (let value = 2; value <= 8; value += 1) {
    await joinRoom(request, created.roomId, participantId(value));
  }
  const full = await request(`${BASE_PATH}/rooms/${created.roomId}/join`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: verifier(),
      participantId: participantId(9),
      participantVerifier: participantVerifier(9),
    },
  });
  assert.equal(full.status, 409);
  assert.equal(full.body.error.code, "room_full");
});

test("enforces per-IP creation quotas and the global room cap", async (t) => {
  const first = await startService();
  t.after(() => first.signaling.close());
  for (let value = 1; value <= 10; value += 1) {
    await createRoom(first.request, participantId(value), verifier(value));
  }
  const rateLimited = await first.request(`${BASE_PATH}/rooms`, {
    method: "POST",
    json: {
      version: 3,
      roomVerifier: verifier(11),
      participantId: participantId(11),
      participantVerifier: participantVerifier(111),
    },
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.error.code, "rate_limited");

  const second = await startService();
  t.after(() => second.signaling.close());
  for (let value = 1; value <= 100; value += 1) {
    const created = await second.request(`${BASE_PATH}/rooms`, {
      method: "POST",
      headers: { "X-Real-IP": `192.0.2.${value}` },
      json: {
        version: 3,
        roomVerifier: verifier((value % 250) + 1),
        participantId: participantId((value % 250) + 1),
        participantVerifier: participantVerifier(value + 120),
      },
    });
    assert.equal(created.status, 201);
  }
  const atCapacity = await second.request(`${BASE_PATH}/rooms`, {
    method: "POST",
    headers: { "X-Real-IP": "198.51.100.1" },
    json: {
      version: 3,
      roomVerifier: verifier(250),
      participantId: participantId(250),
      participantVerifier: participantVerifier(249),
    },
  });
  assert.equal(atCapacity.status, 503);
  assert.equal(atCapacity.body.error.code, "room_capacity");
});

test("bounds the monotonic event log and rejects expired cursors", async (t) => {
  const { signaling, request } = await startService();
  t.after(() => signaling.close());
  const creatorId = participantId(1);
  const guestId = participantId(2);
  const created = await createRoom(request, creatorId);
  const joined = await joinRoom(request, created.roomId, guestId);
  const path = `${BASE_PATH}/rooms/${created.roomId}/signals`;

  for (let value = 0; value < 257; value += 1) {
    const sent = await request(path, {
      method: "POST",
      token: created.participantToken,
      json: {
        version: 3,
        toParticipantId: guestId,
        candidate: {
          candidate: `candidate:${value + 1} 1 udp 1677734910 192.0.2.1 60769 typ host`,
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: "example",
        },
      },
    });
    assert.equal(sent.status, 204);
  }

  const expired = await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=0`, {
    token: joined.participantToken,
  });
  assert.equal(expired.status, 409);
  assert.equal(expired.body.error.code, "events_expired");
});

test("expires rooms and removes inactive peers without persisting state", async (t) => {
  let currentTime = 1_000_000;
  const { signaling, request } = await startService({
    now: () => currentTime,
    roomTtlMs: 1000,
    peerInactiveMs: 100,
    longPollMs: 5,
  });
  t.after(() => signaling.close());
  const creatorId = participantId(1);
  const guestId = participantId(2);
  const created = await createRoom(request, creatorId);
  await joinRoom(request, created.roomId, guestId);

  currentTime += 50;
  await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=1`, {
    token: created.participantToken,
  });
  currentTime += 51;
  signaling.cleanup();
  const left = await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=1`, {
    token: created.participantToken,
  });
  assert.equal(left.body.events[0].type, "peer-left");
  assert.equal(left.body.events[0].participantId, guestId);

  currentTime += 1000;
  signaling.cleanup();
  const expired = await request(`${BASE_PATH}/rooms/${created.roomId}/events?after=2`, {
    token: created.participantToken,
  });
  assert.equal(expired.status, 404);

  const source = await readFile(new URL("./banner-together-signal.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:fs|writeFile|createWriteStream|database/i);
});
