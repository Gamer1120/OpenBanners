import { webcrypto } from "node:crypto";
import {
  BANNER_TOGETHER_LIVE_API_BASE_PATH,
  BannerTogetherLiveApiError,
  createBannerTogetherLiveRoom,
  joinBannerTogetherLiveRoom,
  leaveBannerTogetherLiveRoom,
  pollBannerTogetherLiveEvents,
  sendBannerTogetherLiveDescription,
  sendBannerTogetherLiveIceCandidate,
} from "./bannerTogetherLiveApi";
import {
  createBannerTogetherLiveParticipantIdentity,
  createBannerTogetherLiveSecrets,
} from "./bannerTogetherLiveCrypto";

const ROOM_ID = "AAECAwQFBgcICQoLDA0ODw";
const PARTICIPANT_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const REMOTE_PARTICIPANT_ID = "AQIDBAUGBwgJCgsMDQ4PEA";
const EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const BANNERGRESS_ACCESS_TOKEN = "bannergress-access-token-must-not-leak";
const BANNERGRESS_REFRESH_TOKEN = "bannergress-refresh-token-must-not-leak";
const SDP = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "",
].join("\r\n");
const CANDIDATE = {
  candidate: "candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
  usernameFragment: "example",
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function serializeFetchCalls() {
  return global.fetch.mock.calls
    .map(([url, options]) =>
      JSON.stringify({
        url,
        method: options.method,
        headers: [...new Headers(options.headers).entries()],
        body: options.body,
      })
    )
    .join("\n");
}

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

test("uses only strict same-origin signaling requests without room secrets or Bannergress tokens", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  const joinIdentity = createBannerTogetherLiveParticipantIdentity();
  const roomResponse = {
    version: 3,
    roomId: ROOM_ID,
    participantToken: PARTICIPANT_TOKEN,
    expiresAt: EXPIRES_AT,
    peers: [],
  };

  global.fetch
    .mockResolvedValueOnce(jsonResponse(roomResponse, 201))
    .mockResolvedValueOnce(
      jsonResponse({ ...roomResponse, peers: [secrets.participantId] })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        version: 3,
        events: [
          {
            id: 1,
            type: "peer-joined",
            participantId: REMOTE_PARTICIPANT_ID,
          },
          {
            id: 2,
            type: "signal",
            fromParticipantId: REMOTE_PARTICIPANT_ID,
            description: { type: "offer", sdp: SDP },
          },
        ],
        nextEventId: 2,
        expiresAt: EXPIRES_AT,
        peers: [REMOTE_PARTICIPANT_ID],
      })
    )
    .mockResolvedValueOnce(emptyResponse())
    .mockResolvedValueOnce(emptyResponse())
    .mockResolvedValueOnce(emptyResponse());

  await expect(
    createBannerTogetherLiveRoom({
      roomVerifier: secrets.roomVerifier,
      participantId: secrets.participantId,
      participantVerifier: secrets.participantVerifier,
    })
  ).resolves.toMatchObject({ roomId: ROOM_ID, peers: [] });
  await expect(
    joinBannerTogetherLiveRoom({
      roomId: ROOM_ID,
      roomVerifier: secrets.roomVerifier,
      participantId: joinIdentity.participantId,
      participantVerifier: joinIdentity.participantVerifier,
    })
  ).resolves.toMatchObject({ peers: [secrets.participantId] });
  await expect(
    pollBannerTogetherLiveEvents({
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
    })
  ).resolves.toMatchObject({ nextEventId: 2 });
  await expect(
    sendBannerTogetherLiveDescription({
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
      toParticipantId: REMOTE_PARTICIPANT_ID,
      description: { type: "offer", sdp: SDP },
    })
  ).resolves.toEqual({ sent: true });
  await expect(
    sendBannerTogetherLiveIceCandidate({
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
      toParticipantId: REMOTE_PARTICIPANT_ID,
      candidate: CANDIDATE,
    })
  ).resolves.toEqual({ sent: true });
  await expect(
    leaveBannerTogetherLiveRoom({
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
    })
  ).resolves.toEqual({ left: true });

  expect(global.fetch).toHaveBeenCalledTimes(6);
  global.fetch.mock.calls.forEach(([url, options]) => {
    expect(url).toMatch(new RegExp(`^${BANNER_TOGETHER_LIVE_API_BASE_PATH}`));
    expect(url).not.toMatch(/^https?:/);
    expect(options).toMatchObject({
      credentials: "omit",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  const serializedCalls = serializeFetchCalls();
  expect(serializedCalls).not.toContain(secrets.roomSecret);
  expect(serializedCalls).not.toContain(BANNERGRESS_ACCESS_TOKEN);
  expect(serializedCalls).not.toContain(BANNERGRESS_REFRESH_TOKEN);
  expect(serializedCalls).toContain(secrets.roomVerifier);
  expect(serializedCalls).toContain(secrets.participantVerifier);

  const descriptionBody = JSON.parse(global.fetch.mock.calls[3][1].body);
  expect(descriptionBody).toEqual({
    version: 3,
    toParticipantId: REMOTE_PARTICIPANT_ID,
    description: { type: "offer", sdp: SDP },
  });
  const candidateBody = JSON.parse(global.fetch.mock.calls[4][1].body);
  expect(candidateBody).toEqual({
    version: 3,
    toParticipantId: REMOTE_PARTICIPANT_ID,
    candidate: CANDIDATE,
  });
});

test("sends the old participant token only for an authenticated rejoin", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  global.fetch.mockResolvedValueOnce(
    jsonResponse({
      version: 3,
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
      expiresAt: EXPIRES_AT,
      peers: [],
    })
  );

  await joinBannerTogetherLiveRoom({
    roomId: ROOM_ID,
    roomVerifier: secrets.roomVerifier,
    participantId: secrets.participantId,
    participantVerifier: secrets.participantVerifier,
    participantToken: PARTICIPANT_TOKEN,
  });

  expect(
    new Headers(global.fetch.mock.calls[0][1].headers).get("Authorization")
  ).toBe(`Bearer ${PARTICIPANT_TOKEN}`);
});

test("rejects malformed service events and cross-room responses", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  global.fetch
    .mockResolvedValueOnce(
      jsonResponse({
        version: 3,
        roomId: REMOTE_PARTICIPANT_ID,
        participantToken: PARTICIPANT_TOKEN,
        expiresAt: EXPIRES_AT,
        peers: [],
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        version: 3,
        events: [
          {
            id: 1,
            type: "signal",
            fromParticipantId: REMOTE_PARTICIPANT_ID,
            description: { type: "offer", sdp: "not-sdp" },
          },
        ],
        nextEventId: 1,
        expiresAt: EXPIRES_AT,
        peers: [REMOTE_PARTICIPANT_ID],
      })
    );

  await expect(
    joinBannerTogetherLiveRoom({
      roomId: ROOM_ID,
      roomVerifier: secrets.roomVerifier,
      participantId: secrets.participantId,
      participantVerifier: secrets.participantVerifier,
    })
  ).rejects.toMatchObject({ code: "INVALID_LIVE_ROOM_RESPONSE" });
  await expect(
    pollBannerTogetherLiveEvents({
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
    })
  ).rejects.toMatchObject({ code: "INVALID_LIVE_ROOM_RESPONSE" });
});

test("preserves AbortError from fetch and response parsing", async () => {
  const secrets = await createBannerTogetherLiveSecrets();
  const fetchAbort = new DOMException("aborted", "AbortError");
  const parseAbort = new DOMException("aborted", "AbortError");
  global.fetch
    .mockRejectedValueOnce(fetchAbort)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(parseAbort),
    });

  await expect(
    createBannerTogetherLiveRoom({
      roomVerifier: secrets.roomVerifier,
      participantId: secrets.participantId,
      participantVerifier: secrets.participantVerifier,
    })
  ).rejects.toBe(fetchAbort);
  await expect(
    pollBannerTogetherLiveEvents({
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
    })
  ).rejects.toBe(parseAbort);
});

test("maps strict service errors without exposing arbitrary response shapes", async () => {
  global.fetch.mockResolvedValueOnce(
    jsonResponse(
      { error: { code: "events_expired", message: "Cursor expired." } },
      409
    )
  );

  const error = await pollBannerTogetherLiveEvents({
    roomId: ROOM_ID,
    participantToken: PARTICIPANT_TOKEN,
  }).catch((caughtError) => caughtError);

  expect(error).toBeInstanceOf(BannerTogetherLiveApiError);
  expect(error).toMatchObject({
    code: "events_expired",
    status: 409,
    message: "Cursor expired.",
  });
});

test("rejects equal room and participant verifiers before fetch", async () => {
  const secrets = await createBannerTogetherLiveSecrets();

  await expect(
    createBannerTogetherLiveRoom({
      roomVerifier: secrets.roomVerifier,
      participantId: secrets.participantId,
      participantVerifier: secrets.roomVerifier,
    })
  ).rejects.toThrow(/independently generated/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("rejects signal payloads that exceed byte limits or contain newlines", () => {
  expect(() =>
    sendBannerTogetherLiveDescription({
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
      toParticipantId: REMOTE_PARTICIPANT_ID,
      description: {
        type: "offer",
        sdp: `${SDP}a=x:${"é".repeat(9000)}\r\n`,
      },
    })
  ).toThrow(/SDP is invalid/i);
  expect(() =>
    sendBannerTogetherLiveIceCandidate({
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
      toParticipantId: REMOTE_PARTICIPANT_ID,
      candidate: {
        ...CANDIDATE,
        candidate: `${CANDIDATE.candidate}\n`,
      },
    })
  ).toThrow(/candidate string is invalid/i);
  expect(global.fetch).not.toHaveBeenCalled();
});
