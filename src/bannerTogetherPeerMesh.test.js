import { webcrypto } from "node:crypto";
import {
  BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH,
  BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL,
  BANNER_TOGETHER_LIVE_REASSEMBLY_TIMEOUT_MS,
  BANNER_TOGETHER_LIVE_RTC_CONFIGURATION,
  BannerTogetherLiveMessageReassembler,
  chunkBannerTogetherLiveMessage,
  createBannerTogetherPeerMeshSession,
} from "./bannerTogetherPeerMesh";

function base64Url(byteLength, fill) {
  return Buffer.from(new Uint8Array(byteLength).fill(fill)).toString(
    "base64url"
  );
}

const ROOM_ID = base64Url(16, 1);
const PARTICIPANT_A = base64Url(16, 2);
const PARTICIPANT_B = base64Url(16, 3);
const PARTICIPANT_TOKEN = base64Url(32, 4);
const MESSAGE_ID = base64Url(12, 5);
const SDP = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "",
].join("\r\n");

function createEnvelope(ciphertextBytes = 32) {
  return {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: base64Url(12, 6),
    ciphertext: base64Url(ciphertextBytes, 7),
  };
}

class FakeDataChannel {
  constructor(label) {
    this.label = label;
    this.readyState = "connecting";
    this.bufferedAmount = 0;
    this.sent = [];
    this.closed = false;
  }

  send(value) {
    if (this.sendError) {
      throw this.sendError;
    }

    this.sent.push(value);
  }

  open() {
    this.readyState = "open";
    this.onopen?.();
  }

  receive(value) {
    this.onmessage?.({ data: value });
  }

  close() {
    this.readyState = "closed";
    this.closed = true;
    this.onclose?.();
  }
}

class FakePeerConnection {
  constructor(configuration) {
    this.configuration = configuration;
    this.signalingState = "stable";
    this.connectionState = "new";
    this.localDescription = null;
    this.remoteDescription = null;
    this.channels = [];
    this.addedCandidates = [];
    this.offerOptions = [];
    this.restartIceCalls = 0;
    this.closed = false;
  }

  createDataChannel(label) {
    const channel = new FakeDataChannel(label);
    this.channels.push(channel);
    return channel;
  }

  async createOffer(options) {
    this.offerOptions.push(options);
    return { type: "offer", sdp: SDP };
  }

  async createAnswer() {
    return { type: "answer", sdp: SDP };
  }

  async setLocalDescription(description) {
    if (description.type === "rollback") {
      this.localDescription = null;
      this.signalingState = "stable";
      return;
    }

    this.localDescription = description;
    this.signalingState =
      description.type === "offer" ? "have-local-offer" : "stable";
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this.signalingState =
      description.type === "offer" ? "have-remote-offer" : "stable";
  }

  async addIceCandidate(candidate) {
    this.addedCandidates.push(candidate);
  }

  restartIce() {
    this.restartIceCalls += 1;
  }

  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
}

function createPeerFactory() {
  const connections = [];
  const factory = vi.fn((configuration) => {
    const connection = new FakePeerConnection(configuration);
    connections.push(connection);
    return connection;
  });

  return { factory, connections };
}

function createPollSequence(responses) {
  let index = 0;

  return vi.fn(({ signal }) => {
    if (index < responses.length) {
      const response = responses[index];
      index += 1;
      return Promise.resolve(response);
    }

    return new Promise((_resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }

      signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true }
      );
    });
  });
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for peer session state.");
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("chunks and reassembles a large encrypted snapshot out of order", () => {
  const message = {
    version: 1,
    type: "snapshot",
    participantId: PARTICIPANT_A,
    sequence: 8,
    envelope: createEnvelope(500 * 1024),
  };
  const frames = chunkBannerTogetherLiveMessage(message, {
    messageId: MESSAGE_ID,
  });
  const reassembler = new BannerTogetherLiveMessageReassembler();
  let result = null;

  expect(frames.length).toBeGreaterThan(50);
  frames.forEach((frame) => {
    expect(new TextEncoder().encode(frame).byteLength).toBeLessThan(
      BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH + 512
    );
  });
  [...frames].reverse().forEach((frame) => {
    result = reassembler.push(frame, { participantId: PARTICIPANT_A });
  });

  expect(result).toEqual(message);
});

test("bounds partial reassembly and rejects cross-participant claims", () => {
  const message = {
    version: 1,
    type: "snapshot-cleared",
    participantId: PARTICIPANT_A,
    sequence: 2,
  };
  const frames = chunkBannerTogetherLiveMessage(message, {
    messageId: MESSAGE_ID,
  });
  const reassembler = new BannerTogetherLiveMessageReassembler();

  expect(() =>
    reassembler.push(frames[0], { participantId: PARTICIPANT_B })
  ).toThrow(/different participant/i);

  const largeFrames = chunkBannerTogetherLiveMessage(
    {
      version: 1,
      type: "snapshot",
      participantId: PARTICIPANT_A,
      sequence: 3,
      envelope: createEnvelope(32 * 1024),
    },
    { messageId: MESSAGE_ID }
  );
  const partial = new BannerTogetherLiveMessageReassembler();
  expect(
    partial.push(largeFrames[0], {
      participantId: PARTICIPANT_A,
      now: 100,
    })
  ).toBeNull();
  partial.purge(100 + BANNER_TOGETHER_LIVE_REASSEMBLY_TIMEOUT_MS);
  expect(partial.assemblies.size).toBe(0);
  expect(partial.totalEncodedLength).toBe(0);
});

test("one peer cannot consume another peer's reassembly capacity", () => {
  const reassembler = new BannerTogetherLiveMessageReassembler();
  const firstAttackerFrames = chunkBannerTogetherLiveMessage(
    {
      version: 1,
      type: "snapshot",
      participantId: PARTICIPANT_A,
      sequence: 1,
      envelope: createEnvelope(500 * 1024),
    },
    { messageId: base64Url(12, 10) }
  );
  const secondAttackerFrames = chunkBannerTogetherLiveMessage(
    {
      version: 1,
      type: "snapshot",
      participantId: PARTICIPANT_A,
      sequence: 2,
      envelope: createEnvelope(500 * 1024),
    },
    { messageId: base64Url(12, 11) }
  );

  firstAttackerFrames.slice(0, -1).forEach((frame) => {
    expect(
      reassembler.push(frame, { participantId: PARTICIPANT_A })
    ).toBeNull();
  });

  let quotaError = null;

  for (const frame of secondAttackerFrames) {
    try {
      reassembler.push(frame, { participantId: PARTICIPANT_A });
    } catch (error) {
      quotaError = error;
      break;
    }
  }

  expect(quotaError).toBeInstanceOf(Error);
  expect(quotaError.message).toMatch(/peer exceeded its reassembly quota/i);

  const innocentMessage = {
    version: 1,
    type: "snapshot-cleared",
    participantId: PARTICIPANT_B,
    sequence: 1,
  };
  const innocentFrames = chunkBannerTogetherLiveMessage(innocentMessage, {
    messageId: base64Url(12, 12),
  });
  let result = null;

  innocentFrames.forEach((frame) => {
    result = reassembler.push(frame, { participantId: PARTICIPANT_B });
  });

  expect(result).toEqual(innocentMessage);
  expect(
    [...reassembler.assemblies.values()].every(
      (assembly) => assembly.participantId === PARTICIPANT_A
    )
  ).toBe(true);
});

test("an existing participant offers to a joined peer using STUN only", async () => {
  const { factory, connections } = createPeerFactory();
  const signaling = {
    pollEvents: createPollSequence([
      {
        events: [
          { id: 1, type: "peer-joined", participantId: PARTICIPANT_B },
        ],
        nextEventId: 1,
        peers: [PARTICIPANT_B],
      },
    ]),
    sendDescription: vi.fn().mockResolvedValue({ sent: true }),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const participantStates = [];
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    participantToken: PARTICIPANT_TOKEN,
    onParticipantState: (state) => participantStates.push(state),
    peerConnectionFactory: factory,
    signaling,
  });

  session.start();
  await waitUntil(() => signaling.sendDescription.mock.calls.length === 1);

  expect(signaling.sendDescription).toHaveBeenCalledWith(
    expect.objectContaining({
      roomId: ROOM_ID,
      participantToken: PARTICIPANT_TOKEN,
      toParticipantId: PARTICIPANT_B,
      description: { type: "offer", sdp: SDP },
    })
  );
  expect(connections).toHaveLength(1);
  expect(connections[0].channels[0].label).toBe(
    BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL
  );
  expect(connections[0].configuration).toBe(
    BANNER_TOGETHER_LIVE_RTC_CONFIGURATION
  );
  expect(
    connections[0].configuration.iceServers.flatMap((server) => server.urls)
  ).toEqual(expect.not.arrayContaining([expect.stringMatching(/^turns?:/)]));
  expect(participantStates).toContainEqual({
    participantId: PARTICIPANT_B,
    state: "connecting",
  });

  await session.close();
  expect(signaling.leaveRoom).toHaveBeenCalledWith({
    roomId: ROOM_ID,
    participantToken: PARTICIPANT_TOKEN,
  });
  expect(connections[0].closed).toBe(true);
});

test("answers offers and exchanges monotonic snapshot and withdrawal messages", async () => {
  const { factory, connections } = createPeerFactory();
  const onSnapshot = vi.fn();
  const signaling = {
    pollEvents: createPollSequence([
      {
        events: [
          {
            id: 1,
            type: "signal",
            fromParticipantId: PARTICIPANT_A,
            description: { type: "offer", sdp: SDP },
          },
        ],
        nextEventId: 1,
        peers: [PARTICIPANT_A],
      },
    ]),
    sendDescription: vi.fn().mockResolvedValue({ sent: true }),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_B,
    participantToken: PARTICIPANT_TOKEN,
    initialPeers: [PARTICIPANT_A],
    onSnapshot,
    peerConnectionFactory: factory,
    signaling,
  });

  session.start();
  await waitUntil(() => signaling.sendDescription.mock.calls.length === 1);
  expect(signaling.sendDescription).toHaveBeenCalledWith(
    expect.objectContaining({
      toParticipantId: PARTICIPANT_A,
      description: { type: "answer", sdp: SDP },
    })
  );
  expect(connections[0].remoteDescription).toEqual({
    type: "offer",
    sdp: SDP,
  });

  const incomingChannel = new FakeDataChannel(
    BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL
  );
  connections[0].ondatachannel({ channel: incomingChannel });
  incomingChannel.open();

  const remoteSnapshot = {
    version: 1,
    type: "snapshot",
    participantId: PARTICIPANT_A,
    sequence: 5,
    envelope: createEnvelope(),
  };
  chunkBannerTogetherLiveMessage(remoteSnapshot, {
    messageId: MESSAGE_ID,
  }).forEach((frame) => incomingChannel.receive(frame));
  chunkBannerTogetherLiveMessage(remoteSnapshot, {
    messageId: base64Url(12, 8),
  }).forEach((frame) => incomingChannel.receive(frame));
  const withdrawal = {
    version: 1,
    type: "snapshot-cleared",
    participantId: PARTICIPANT_A,
    sequence: 6,
  };
  chunkBannerTogetherLiveMessage(withdrawal, {
    messageId: base64Url(12, 9),
  }).forEach((frame) => incomingChannel.receive(frame));
  await session.peers.get(PARTICIPANT_A).snapshotQueue;

  expect(onSnapshot).toHaveBeenCalledTimes(2);
  expect(onSnapshot).toHaveBeenNthCalledWith(1, {
    participantId: PARTICIPANT_A,
    sequence: 5,
    envelope: remoteSnapshot.envelope,
  });
  expect(onSnapshot).toHaveBeenNthCalledWith(2, {
    participantId: PARTICIPANT_A,
    sequence: 6,
    envelope: null,
  });

  await session.publishSnapshot({
    sequence: 1,
    envelope: createEnvelope(),
  });
  await session.clearPublishedSnapshot({ sequence: 2 });
  expect(incomingChannel.sent.length).toBeGreaterThanOrEqual(2);
  await expect(
    session.clearPublishedSnapshot({ sequence: 2 })
  ).rejects.toThrow(/increase/i);

  await session.close({ notifyServer: false });
});

test("commits explicit sharing even when one open channel fails mid-send", async () => {
  const { factory, connections } = createPeerFactory();
  const onError = vi.fn();
  const signaling = {
    pollEvents: createPollSequence([]),
    sendDescription: vi.fn().mockResolvedValue({ sent: true }),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    participantToken: PARTICIPANT_TOKEN,
    initialPeers: [PARTICIPANT_B],
    onError,
    peerConnectionFactory: factory,
    signaling,
  });

  session.start();
  const channel = new FakeDataChannel(BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL);
  connections[0].ondatachannel({ channel });
  channel.open();
  channel.sendError = new Error("channel closed during send");
  const envelope = createEnvelope();

  await expect(
    session.publishSnapshot({ sequence: 1, envelope })
  ).resolves.toEqual({
    sentTo: [],
    pendingTo: [],
    failedTo: [PARTICIPANT_B],
  });
  expect(session.latestPublishedMessage).toEqual({
    version: 1,
    type: "snapshot",
    participantId: PARTICIPANT_A,
    sequence: 1,
    envelope,
  });
  expect(onError).toHaveBeenCalledWith(channel.sendError);
  await waitUntil(() => signaling.sendDescription.mock.calls.length === 1);
  expect(connections).toHaveLength(2);
  expect(connections[0].closed).toBe(true);
  await session.close({ notifyServer: false });
});

test("bounds recovery-offer retries before requiring a session rejoin", async () => {
  vi.useFakeTimers();

  try {
    const { factory, connections } = createPeerFactory();
    const networkError = Object.assign(new Error("Signaling unavailable."), {
      code: "LIVE_ROOM_NETWORK_ERROR",
    });
    const signaling = {
      pollEvents: createPollSequence([]),
      sendDescription: vi.fn().mockRejectedValue(networkError),
      sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
      leaveRoom: vi.fn().mockResolvedValue({ left: true }),
    };
    const onSessionState = vi.fn();
    const session = createBannerTogetherPeerMeshSession({
      roomId: ROOM_ID,
      participantId: PARTICIPANT_A,
      participantToken: PARTICIPANT_TOKEN,
      initialPeers: [PARTICIPANT_B],
      onSessionState,
      peerConnectionFactory: factory,
      signaling,
    });

    session.start();
    const channel = new FakeDataChannel(
      BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL
    );
    connections[0].ondatachannel({ channel });
    channel.open();
    channel.sendError = new Error("snapshot send failed");

    await session.clearPublishedSnapshot({ sequence: 1 });
    await vi.advanceTimersByTimeAsync(2000);

    expect(signaling.sendDescription).toHaveBeenCalledTimes(3);
    expect(session.running).toBe(false);
    expect(onSessionState).toHaveBeenLastCalledWith({
      state: "reconnect-required",
      error: networkError,
    });
    await session.close({ notifyServer: false });
  } finally {
    vi.useRealTimers();
  }
});

test.each(["reconcile", "peer-not-found"])(
  "%s removal waits for the pending snapshot callback before left",
  async (removalMode) => {
    const { factory, connections } = createPeerFactory();
    const peerNotFound = Object.assign(new Error("Peer left."), {
      code: "peer_not_found",
      status: 404,
    });
    const signaling = {
      pollEvents: createPollSequence([]),
      sendDescription:
        removalMode === "peer-not-found"
          ? vi.fn().mockRejectedValue(peerNotFound)
          : vi.fn().mockResolvedValue({ sent: true }),
      sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
      leaveRoom: vi.fn().mockResolvedValue({ left: true }),
    };
    const order = [];
    let finishSnapshot;
    const session = createBannerTogetherPeerMeshSession({
      roomId: ROOM_ID,
      participantId: PARTICIPANT_A,
      participantToken: PARTICIPANT_TOKEN,
      initialPeers: [PARTICIPANT_B],
      onSnapshot: () =>
        new Promise((resolve) => {
          finishSnapshot = () => {
            order.push("snapshot-finished");
            resolve();
          };
        }),
      onParticipantState: ({ state }) => {
        if (state === "left") {
          order.push("left");
        }
      },
      peerConnectionFactory: factory,
      signaling,
    });

    session.start();
    const channel = new FakeDataChannel(
      BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL
    );
    connections[0].ondatachannel({ channel });
    channel.open();
    chunkBannerTogetherLiveMessage(
      {
        version: 1,
        type: "snapshot",
        participantId: PARTICIPANT_B,
        sequence: 1,
        envelope: createEnvelope(),
      },
      { messageId: MESSAGE_ID }
    ).forEach((frame) => channel.receive(frame));
    await waitUntil(() => typeof finishSnapshot === "function");

    const removal =
      removalMode === "reconcile"
        ? session.reconcilePeers([])
        : session.handleEventWithPolicy({
            id: 1,
            type: "peer-joined",
            participantId: PARTICIPANT_B,
          });
    await Promise.resolve();
    expect(order).toEqual([]);

    finishSnapshot();
    await removal;
    expect(order).toEqual(["snapshot-finished", "left"]);
    await session.close({ notifyServer: false });
  }
);

test("rejoin replaces the stale peer and creates a new offer deterministically", async () => {
  const { factory, connections } = createPeerFactory();
  const participantStates = [];
  const signaling = {
    pollEvents: createPollSequence([
      {
        events: [
          {
            id: 1,
            type: "peer-rejoined",
            participantId: PARTICIPANT_B,
          },
        ],
        nextEventId: 1,
        peers: [PARTICIPANT_B],
      },
    ]),
    sendDescription: vi.fn().mockResolvedValue({ sent: true }),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    participantToken: PARTICIPANT_TOKEN,
    initialPeers: [PARTICIPANT_B],
    onParticipantState: (state) => participantStates.push(state),
    peerConnectionFactory: factory,
    signaling,
  });

  session.start();
  session.receivedSequences.set(PARTICIPANT_B, 99);
  await waitUntil(() => signaling.sendDescription.mock.calls.length === 1);

  expect(connections).toHaveLength(2);
  expect(connections[0].closed).toBe(true);
  expect(connections[1].channels).toHaveLength(1);
  expect(session.receivedSequences.has(PARTICIPANT_B)).toBe(false);
  expect(participantStates).toEqual([
    { participantId: PARTICIPANT_B, state: "connecting" },
    { participantId: PARTICIPANT_B, state: "left" },
    { participantId: PARTICIPANT_B, state: "connecting" },
  ]);
  await session.close({ notifyServer: false });
});

test("a peer-left signaling race does not stop polling the room", async () => {
  const { factory } = createPeerFactory();
  const pollEvents = createPollSequence([
    {
      events: [
        { id: 1, type: "peer-joined", participantId: PARTICIPANT_B },
      ],
      nextEventId: 1,
      peers: [PARTICIPANT_B],
    },
    { events: [], nextEventId: 1, peers: [] },
  ]);
  const peerNotFound = Object.assign(new Error("Peer left."), {
    code: "peer_not_found",
    status: 404,
  });
  const signaling = {
    pollEvents,
    sendDescription: vi.fn().mockRejectedValue(peerNotFound),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    participantToken: PARTICIPANT_TOKEN,
    peerConnectionFactory: factory,
    signaling,
  });

  session.start();
  await waitUntil(() => pollEvents.mock.calls.length >= 3);

  expect(session.running).toBe(true);
  expect(session.getParticipantStates()).toEqual([
    { participantId: PARTICIPANT_B, state: "left" },
  ]);
  await session.close({ notifyServer: false });
});

test("bounds ICE candidates received before the remote description", async () => {
  const { factory, connections } = createPeerFactory();
  const signaling = {
    pollEvents: createPollSequence([]),
    sendDescription: vi.fn().mockResolvedValue({ sent: true }),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    participantToken: PARTICIPANT_TOKEN,
    initialPeers: [PARTICIPANT_B],
    peerConnectionFactory: factory,
    signaling,
  });
  const candidate = {
    candidate: "candidate:1 1 udp 1 192.0.2.1 10000 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
    usernameFragment: "test",
  };

  session.start();

  for (let index = 0; index < 64; index += 1) {
    await session.handleCandidate(PARTICIPANT_B, candidate);
  }

  await expect(
    session.handleCandidate(PARTICIPANT_B, candidate)
  ).rejects.toThrow(/too many ICE candidates/i);
  expect(connections[0].closed).toBe(true);
  expect(session.peers.has(PARTICIPANT_B)).toBe(false);
  await session.close({ notifyServer: false });
});

test("reports when an expired participant token requires a UI rejoin", async () => {
  const { factory } = createPeerFactory();
  const expired = Object.assign(new Error("Participant became inactive."), {
    code: "participant_inactive",
    status: 401,
  });
  const signaling = {
    pollEvents: vi.fn().mockRejectedValue(expired),
    sendDescription: vi.fn().mockResolvedValue({ sent: true }),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const onSessionState = vi.fn();
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    participantToken: PARTICIPANT_TOKEN,
    onSessionState,
    peerConnectionFactory: factory,
    signaling,
  });

  session.start();
  await waitUntil(() => session.running === false);

  expect(onSessionState).toHaveBeenNthCalledWith(1, {
    state: "running",
    error: null,
  });
  expect(onSessionState).toHaveBeenNthCalledWith(2, {
    state: "reconnect-required",
    error: expired,
  });
  await session.close({ notifyServer: false });
});

test("quarantines invalid data-frame floods without unbounded UI errors", async () => {
  const { factory, connections } = createPeerFactory();
  const onError = vi.fn();
  const signaling = {
    pollEvents: createPollSequence([]),
    sendDescription: vi.fn().mockResolvedValue({ sent: true }),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    participantToken: PARTICIPANT_TOKEN,
    initialPeers: [PARTICIPANT_B],
    onError,
    peerConnectionFactory: factory,
    signaling,
  });
  const channel = new FakeDataChannel(BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL);

  session.start();
  connections[0].ondatachannel({ channel });
  channel.open();

  for (let index = 0; index < 8; index += 1) {
    channel.receive("not-json");
  }

  expect(session.peers.get(PARTICIPANT_B).quarantined).toBe(true);
  expect(channel.closed).toBe(true);
  expect(onError).toHaveBeenCalledTimes(2);
  await session.close({ notifyServer: false });
});

test("quarantines a peer that outruns serialized snapshot processing", async () => {
  const { factory, connections } = createPeerFactory();
  const signaling = {
    pollEvents: createPollSequence([]),
    sendDescription: vi.fn().mockResolvedValue({ sent: true }),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    participantToken: PARTICIPANT_TOKEN,
    initialPeers: [PARTICIPANT_B],
    onSnapshot: () => new Promise(() => {}),
    peerConnectionFactory: factory,
    signaling,
  });
  const channel = new FakeDataChannel(BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL);

  session.start();
  connections[0].ondatachannel({ channel });
  channel.open();

  for (let sequence = 1; sequence <= 5; sequence += 1) {
    chunkBannerTogetherLiveMessage(
      {
        version: 1,
        type: "snapshot",
        participantId: PARTICIPANT_B,
        sequence,
        envelope: createEnvelope(),
      },
      { messageId: base64Url(12, 20 + sequence) }
    ).forEach((frame) => channel.receive(frame));
  }

  expect(session.peers.get(PARTICIPANT_B).quarantined).toBe(true);
  expect(channel.closed).toBe(true);
  await session.close({ notifyServer: false });
});

test("the deterministic initiator restarts failed ICE with a bounded offer", async () => {
  const { factory, connections } = createPeerFactory();
  const signaling = {
    pollEvents: createPollSequence([]),
    sendDescription: vi.fn().mockResolvedValue({ sent: true }),
    sendIceCandidate: vi.fn().mockResolvedValue({ sent: true }),
    leaveRoom: vi.fn().mockResolvedValue({ left: true }),
  };
  const session = createBannerTogetherPeerMeshSession({
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    participantToken: PARTICIPANT_TOKEN,
    initialPeers: [PARTICIPANT_B],
    peerConnectionFactory: factory,
    signaling,
  });

  session.start();
  connections[0].connectionState = "failed";
  connections[0].onconnectionstatechange();
  await waitUntil(() => signaling.sendDescription.mock.calls.length === 1);

  expect(connections[0].restartIceCalls).toBe(1);
  expect(connections[0].offerOptions).toContainEqual({ iceRestart: true });
  await session.close({ notifyServer: false });
});
