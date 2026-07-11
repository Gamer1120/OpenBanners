import {
  leaveBannerTogetherLiveRoom,
  pollBannerTogetherLiveEvents,
  sendBannerTogetherLiveDescription,
  sendBannerTogetherLiveIceCandidate,
} from "./bannerTogetherLiveApi";
import {
  validateBannerTogetherLiveEncryptedEnvelope,
  validateBannerTogetherLiveParticipantId,
  validateBannerTogetherLiveParticipantToken,
  validateBannerTogetherLiveRoomId,
  validateBannerTogetherLiveSequence,
} from "./bannerTogetherLiveCrypto";

export const BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL =
  "openbanners-banner-together-live-v1";
export const BANNER_TOGETHER_LIVE_MAX_MESSAGE_BYTES = 768 * 1024;
export const BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH = 12 * 1024;
export const BANNER_TOGETHER_LIVE_REASSEMBLY_TIMEOUT_MS = 30 * 1000;
export const BANNER_TOGETHER_LIVE_RTC_CONFIGURATION = Object.freeze({
  iceServers: Object.freeze([
    Object.freeze({
      urls: Object.freeze([
        "stun:stun.cloudflare.com:3478",
        "stun:stun.l.google.com:19302",
      ]),
    }),
  ]),
  iceCandidatePoolSize: 2,
});

const APPLICATION_MESSAGE_VERSION = 1;
const CHUNK_FRAME_VERSION = 1;
const MESSAGE_ID_BYTES = 12;
const MAX_CHUNK_COUNT = Math.ceil(
  (Math.ceil(BANNER_TOGETHER_LIVE_MAX_MESSAGE_BYTES / 3) * 4) /
    BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH
);
const MAX_ENCODED_MESSAGE_LENGTH =
  Math.ceil(BANNER_TOGETHER_LIVE_MAX_MESSAGE_BYTES / 3) * 4;
const MAX_ACTIVE_REASSEMBLIES = 32;
const MAX_ACTIVE_REASSEMBLIES_PER_PARTICIPANT = 2;
const MAX_REMOTE_PEERS = 7;
const MAX_REASSEMBLY_ENCODED_BYTES_PER_PARTICIPANT =
  MAX_ENCODED_MESSAGE_LENGTH;
const MAX_REASSEMBLY_ENCODED_BYTES =
  MAX_REASSEMBLY_ENCODED_BYTES_PER_PARTICIPANT * MAX_REMOTE_PEERS;
const MAX_PENDING_ICE_CANDIDATES = 64;
const MAX_PENDING_ICE_BYTES = 128 * 1024;
const RECEIVE_RATE_WINDOW_MS = 10 * 1000;
const MAX_RECEIVE_FRAMES_PER_WINDOW = 256;
const MAX_RECEIVE_BYTES_PER_WINDOW = 2 * MAX_ENCODED_MESSAGE_LENGTH;
const MAX_COMPLETE_MESSAGES_PER_WINDOW = 16;
const MAX_INVALID_FRAMES_PER_WINDOW = 8;
const MAX_PENDING_SNAPSHOT_CALLBACKS = 4;
const MAX_BUFFERED_AMOUNT = 256 * 1024;
const BUFFER_DRAIN_TIMEOUT_MS = 5000;
const RECONNECT_DELAY_MS = 1000;
const DISCONNECTED_RECOVERY_DELAY_MS = 5000;
const MAX_ICE_RESTART_ATTEMPTS = 3;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

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
  let result = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const combined = (first << 16) | (second << 8) | third;

    result += BASE64URL_ALPHABET[(combined >> 18) & 63];
    result += BASE64URL_ALPHABET[(combined >> 12) & 63];

    if (hasSecond) {
      result += BASE64URL_ALPHABET[(combined >> 6) & 63];
    }

    if (hasThird) {
      result += BASE64URL_ALPHABET[combined & 63];
    }
  }

  return result;
}

function base64UrlToBytes(value, label, maximumBytes) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil(maximumBytes / 3) * 4 ||
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

function createMessageId() {
  const bytes = new Uint8Array(MESSAGE_ID_BYTES);

  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Live room message chunking requires Web Crypto.");
  }

  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function validateMessageId(messageId) {
  const bytes = base64UrlToBytes(
    messageId,
    "Live room message ID",
    MESSAGE_ID_BYTES
  );

  if (bytes.byteLength !== MESSAGE_ID_BYTES) {
    throw new Error("Live room message ID has an invalid length.");
  }

  return messageId;
}

export function validateBannerTogetherLiveApplicationMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("Live room application message must be an object.");
  }

  if (message.type === "snapshot") {
    assertExactKeys(
      message,
      ["version", "type", "participantId", "sequence", "envelope"],
      "Live room snapshot message"
    );
  } else if (message.type === "snapshot-cleared") {
    assertExactKeys(
      message,
      ["version", "type", "participantId", "sequence"],
      "Live room snapshot withdrawal"
    );
  } else {
    throw new Error("Live room application message type is invalid.");
  }

  if (message.version !== APPLICATION_MESSAGE_VERSION) {
    throw new Error("Live room application message version is unsupported.");
  }

  const normalized = {
    version: APPLICATION_MESSAGE_VERSION,
    type: message.type,
    participantId: validateBannerTogetherLiveParticipantId(
      message.participantId
    ),
    sequence: validateBannerTogetherLiveSequence(message.sequence),
  };

  if (message.type === "snapshot") {
    normalized.envelope =
      validateBannerTogetherLiveEncryptedEnvelope(message.envelope);
  }

  return normalized;
}

export function chunkBannerTogetherLiveMessage(
  message,
  { messageId = createMessageId() } = {}
) {
  const normalizedMessage =
    validateBannerTogetherLiveApplicationMessage(message);
  const serializedBytes = new TextEncoder().encode(
    JSON.stringify(normalizedMessage)
  );

  if (serializedBytes.byteLength > BANNER_TOGETHER_LIVE_MAX_MESSAGE_BYTES) {
    throw new Error("Live room application message is too large.");
  }

  const encodedMessage = bytesToBase64Url(serializedBytes);
  const count = Math.max(
    1,
    Math.ceil(encodedMessage.length / BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH)
  );

  if (count > MAX_CHUNK_COUNT) {
    throw new Error("Live room application message needs too many chunks.");
  }

  const normalizedMessageId = validateMessageId(messageId);

  return Array.from({ length: count }, (_value, index) =>
    JSON.stringify({
      version: CHUNK_FRAME_VERSION,
      type: "chunk",
      messageId: normalizedMessageId,
      index,
      count,
      data: encodedMessage.slice(
        index * BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH,
        (index + 1) * BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH
      ),
    })
  );
}

function parseChunkFrame(serializedFrame) {
  if (
    typeof serializedFrame !== "string" ||
    serializedFrame.length > BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH + 512
  ) {
    throw new Error("Live room chunk frame has an invalid size.");
  }

  let frame;

  try {
    frame = JSON.parse(serializedFrame);
  } catch {
    throw new Error("Live room chunk frame is not valid JSON.");
  }

  assertExactKeys(
    frame,
    ["version", "type", "messageId", "index", "count", "data"],
    "Live room chunk frame"
  );

  if (frame.version !== CHUNK_FRAME_VERSION || frame.type !== "chunk") {
    throw new Error("Live room chunk frame version or type is invalid.");
  }

  validateMessageId(frame.messageId);

  if (
    !Number.isInteger(frame.count) ||
    frame.count < 1 ||
    frame.count > MAX_CHUNK_COUNT ||
    !Number.isInteger(frame.index) ||
    frame.index < 0 ||
    frame.index >= frame.count
  ) {
    throw new Error("Live room chunk position is invalid.");
  }

  if (
    typeof frame.data !== "string" ||
    frame.data.length === 0 ||
    frame.data.length > BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(frame.data)
  ) {
    throw new Error("Live room chunk data is invalid.");
  }

  if (
    frame.index < frame.count - 1 &&
    frame.data.length !== BANNER_TOGETHER_LIVE_CHUNK_DATA_LENGTH
  ) {
    throw new Error("A non-final live room chunk has an invalid size.");
  }

  return frame;
}

export class BannerTogetherLiveMessageReassembler {
  constructor() {
    this.assemblies = new Map();
    this.totalEncodedLength = 0;
  }

  deleteAssembly(key) {
    const assembly = this.assemblies.get(key);

    if (assembly) {
      this.totalEncodedLength -= assembly.encodedLength;
      this.assemblies.delete(key);
    }
  }

  purge(now = Date.now()) {
    this.assemblies.forEach((assembly, key) => {
      if (assembly.expiresAt <= now) {
        this.deleteAssembly(key);
      }
    });
  }

  clearParticipant(participantId) {
    const normalizedParticipantId =
      validateBannerTogetherLiveParticipantId(participantId);

    this.assemblies.forEach((_assembly, key) => {
      if (key.startsWith(`${normalizedParticipantId}:`)) {
        this.deleteAssembly(key);
      }
    });
  }

  clear() {
    this.assemblies.clear();
    this.totalEncodedLength = 0;
  }

  getParticipantUsage(participantId) {
    let assemblyCount = 0;
    let encodedLength = 0;

    this.assemblies.forEach((assembly) => {
      if (assembly.participantId === participantId) {
        assemblyCount += 1;
        encodedLength += assembly.encodedLength;
      }
    });

    return { assemblyCount, encodedLength };
  }

  push(serializedFrame, { participantId, now = Date.now() }) {
    const normalizedParticipantId =
      validateBannerTogetherLiveParticipantId(participantId);
    const frame = parseChunkFrame(serializedFrame);
    this.purge(now);
    const key = `${normalizedParticipantId}:${frame.messageId}`;
    let assembly = this.assemblies.get(key);

    if (!assembly) {
      const participantUsage = this.getParticipantUsage(
        normalizedParticipantId
      );

      if (
        participantUsage.assemblyCount >=
        MAX_ACTIVE_REASSEMBLIES_PER_PARTICIPANT
      ) {
        throw new Error(
          "A live room peer has too many messages being reassembled."
        );
      }

      if (this.assemblies.size >= MAX_ACTIVE_REASSEMBLIES) {
        throw new Error("Too many live room messages are being reassembled.");
      }

      assembly = {
        participantId: normalizedParticipantId,
        count: frame.count,
        chunks: new Map(),
        encodedLength: 0,
        expiresAt: now + BANNER_TOGETHER_LIVE_REASSEMBLY_TIMEOUT_MS,
      };
      this.assemblies.set(key, assembly);
    } else if (assembly.count !== frame.count) {
      this.deleteAssembly(key);
      throw new Error("Live room chunk count changed during reassembly.");
    }

    const existingChunk = assembly.chunks.get(frame.index);

    if (existingChunk !== undefined && existingChunk !== frame.data) {
      this.deleteAssembly(key);
      throw new Error("Conflicting duplicate live room chunk received.");
    }

    if (existingChunk === undefined) {
      const participantUsage = this.getParticipantUsage(
        normalizedParticipantId
      );

      if (
        participantUsage.encodedLength + frame.data.length >
        MAX_REASSEMBLY_ENCODED_BYTES_PER_PARTICIPANT
      ) {
        this.deleteAssembly(key);
        throw new Error("A live room peer exceeded its reassembly quota.");
      }

      if (
        this.totalEncodedLength + frame.data.length >
        MAX_REASSEMBLY_ENCODED_BYTES
      ) {
        this.deleteAssembly(key);
        throw new Error("Live room reassembly memory limit was reached.");
      }

      assembly.chunks.set(frame.index, frame.data);
      assembly.encodedLength += frame.data.length;
      this.totalEncodedLength += frame.data.length;
    }

    if (assembly.encodedLength > MAX_ENCODED_MESSAGE_LENGTH) {
      this.deleteAssembly(key);
      throw new Error("Reassembled live room message is too large.");
    }

    if (assembly.chunks.size !== assembly.count) {
      return null;
    }

    const encodedMessage = Array.from(
      { length: assembly.count },
      (_value, index) => assembly.chunks.get(index)
    ).join("");
    this.deleteAssembly(key);
    const serializedBytes = base64UrlToBytes(
      encodedMessage,
      "Live room application message",
      BANNER_TOGETHER_LIVE_MAX_MESSAGE_BYTES
    );
    let serializedMessage;

    try {
      serializedMessage = new TextDecoder("utf-8", { fatal: true }).decode(
        serializedBytes
      );
    } catch {
      throw new Error("Live room application message is not valid UTF-8.");
    }

    let message;

    try {
      message = JSON.parse(serializedMessage);
    } catch {
      throw new Error("Live room application message is not valid JSON.");
    }

    const normalizedMessage =
      validateBannerTogetherLiveApplicationMessage(message);

    if (normalizedMessage.participantId !== normalizedParticipantId) {
      throw new Error("Live room message claimed a different participant.");
    }

    return normalizedMessage;
  }
}

function normalizeParticipantIds(participantIds, ownParticipantId) {
  if (
    !Array.isArray(participantIds) ||
    participantIds.length > MAX_REMOTE_PEERS
  ) {
    throw new Error("Initial live room peers must be a bounded array.");
  }

  const normalized = participantIds.map((participantId) =>
    validateBannerTogetherLiveParticipantId(participantId)
  );

  if (
    normalized.includes(ownParticipantId) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error("Initial live room peers must be unique remote participants.");
  }

  return normalized;
}

function defaultPeerConnectionFactory(configuration) {
  if (typeof globalThis.RTCPeerConnection !== "function") {
    throw new Error("This browser does not support WebRTC peer connections.");
  }

  return new globalThis.RTCPeerConnection(configuration);
}

function normalizeCandidate(candidate) {
  const value = typeof candidate.toJSON === "function"
    ? candidate.toJSON()
    : candidate;

  return {
    candidate: value.candidate,
    sdpMid: value.sdpMid ?? null,
    sdpMLineIndex: value.sdpMLineIndex ?? null,
    usernameFragment: value.usernameFragment ?? null,
  };
}

function normalizeDescription(description) {
  return { type: description.type, sdp: description.sdp };
}

function waitForDelay(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    let settled = false;
    let timeout;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function waitForChannelBuffer(channel) {
  if (channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
    return Promise.resolve();
  }

  if (typeof channel.addEventListener !== "function") {
    return Promise.resolve();
  }

  channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      channel.removeEventListener?.("bufferedamountlow", handleLow);
      reject(new Error("Live room data channel stayed congested."));
    }, BUFFER_DRAIN_TIMEOUT_MS);
    const handleLow = () => {
      clearTimeout(timeout);
      resolve();
    };

    channel.addEventListener("bufferedamountlow", handleLow, { once: true });
  });
}

async function sendFrames(channel, frames) {
  if (channel.readyState !== "open") {
    return false;
  }

  for (const frame of frames) {
    await waitForChannelBuffer(channel);

    if (channel.readyState !== "open") {
      return false;
    }

    channel.send(frame);
  }

  return true;
}

const DEFAULT_SIGNALING = Object.freeze({
  pollEvents: pollBannerTogetherLiveEvents,
  sendDescription: sendBannerTogetherLiveDescription,
  sendIceCandidate: sendBannerTogetherLiveIceCandidate,
  leaveRoom: leaveBannerTogetherLiveRoom,
});

export class BannerTogetherPeerMeshSession {
  // Callbacks report participant state, validated snapshots (or envelope:null
  // withdrawals), running/reconnect-required/closed session state, and errors.
  constructor({
    roomId,
    participantId,
    participantToken,
    initialPeers = [],
    onParticipantState = () => {},
    onSnapshot = () => {},
    onSessionState = () => {},
    onError = () => {},
    peerConnectionFactory = defaultPeerConnectionFactory,
    signaling = DEFAULT_SIGNALING,
  }) {
    this.roomId = validateBannerTogetherLiveRoomId(roomId);
    this.participantId =
      validateBannerTogetherLiveParticipantId(participantId);
    this.participantToken =
      validateBannerTogetherLiveParticipantToken(participantToken);
    this.initialPeers = normalizeParticipantIds(
      initialPeers,
      this.participantId
    );

    if (
      typeof onParticipantState !== "function" ||
      typeof onSnapshot !== "function" ||
      typeof onSessionState !== "function" ||
      typeof onError !== "function" ||
      typeof peerConnectionFactory !== "function"
    ) {
      throw new Error("Live room session callbacks and peer factory must be functions.");
    }

    ["pollEvents", "sendDescription", "sendIceCandidate", "leaveRoom"].forEach(
      (method) => {
        if (typeof signaling?.[method] !== "function") {
          throw new Error(`Live room signaling ${method} must be a function.`);
        }
      }
    );

    this.onParticipantState = onParticipantState;
    this.onSnapshot = onSnapshot;
    this.onSessionState = onSessionState;
    this.onError = onError;
    this.peerConnectionFactory = peerConnectionFactory;
    this.signaling = signaling;
    this.peers = new Map();
    this.participantStates = new Map();
    this.receivedSequences = new Map();
    this.deliveryRecoveryAttempts = new Map();
    this.reassembler = new BannerTogetherLiveMessageReassembler();
    this.latestPublishedMessage = null;
    this.lastPublishedSequence = 0;
    this.running = false;
    this.closing = false;
    this.lifetimeController = null;
    this.pollPromise = null;
    this.sessionState = "idle";
  }

  start({ after = 0 } = {}) {
    if (this.running) {
      return this;
    }

    if (!Number.isSafeInteger(after) || after < 0) {
      throw new Error("Live room event cursor must be a non-negative integer.");
    }

    this.running = true;
    this.closing = false;
    this.lifetimeController = new AbortController();
    this.setSessionState("running");
    this.initialPeers.forEach((participantId) => {
      this.ensurePeer(participantId);
    });
    this.pollPromise = this.pollLoop(after);
    return this;
  }

  getParticipantStates() {
    return [...this.participantStates.entries()]
      .map(([participantId, state]) => ({ participantId, state }))
      .sort((first, second) =>
        first.participantId.localeCompare(second.participantId)
      );
  }

  async publishSnapshot({ sequence, envelope }) {
    return this.publishMessage({
      version: APPLICATION_MESSAGE_VERSION,
      type: "snapshot",
      participantId: this.participantId,
      sequence,
      envelope,
    });
  }

  async clearPublishedSnapshot({ sequence }) {
    return this.publishMessage({
      version: APPLICATION_MESSAGE_VERSION,
      type: "snapshot-cleared",
      participantId: this.participantId,
      sequence,
    });
  }

  async publishMessage(message) {
    if (!this.running || this.closing) {
      throw new Error("Live room session is not running.");
    }

    const normalized = validateBannerTogetherLiveApplicationMessage(message);

    if (normalized.participantId !== this.participantId) {
      throw new Error("A live room session can publish only its own snapshot.");
    }

    if (normalized.sequence <= this.lastPublishedSequence) {
      throw new Error("Live room snapshot sequence must increase.");
    }

    const frames = chunkBannerTogetherLiveMessage(normalized);
    this.lastPublishedSequence = normalized.sequence;
    this.latestPublishedMessage = normalized;
    const results = await Promise.all(
      [...this.peers.entries()].map(async ([participantId, peer]) => {
        if (!peer.channel || peer.channel.readyState !== "open") {
          return { participantId, status: "pending" };
        }

        try {
          const sent = await sendFrames(peer.channel, frames);

          if (sent) {
            this.deliveryRecoveryAttempts.set(participantId, 0);
          }

          return {
            participantId,
            status: sent ? "sent" : "pending",
          };
        } catch (error) {
          this.recoverPeerAfterDeliveryFailure(peer, error);
          return { participantId, status: "failed" };
        }
      })
    );

    return {
      sentTo: results
        .filter((result) => result.status === "sent")
        .map((result) => result.participantId),
      pendingTo: results
        .filter((result) => result.status === "pending")
        .map((result) => result.participantId),
      failedTo: results
        .filter((result) => result.status === "failed")
        .map((result) => result.participantId),
    };
  }

  reportError(error) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));

    try {
      this.onError(normalizedError);
    } catch {
      // A consumer callback must not tear down transport processing.
    }
  }

  setSessionState(state, error = null) {
    if (this.sessionState === state && error === null) {
      return;
    }

    this.sessionState = state;

    try {
      this.onSessionState({ state, error });
    } catch (callbackError) {
      this.reportError(callbackError);
    }
  }

  setParticipantState(participantId, state) {
    if (this.participantStates.get(participantId) === state) {
      return;
    }

    this.participantStates.set(participantId, state);

    try {
      this.onParticipantState({ participantId, state });
    } catch (error) {
      this.reportError(error);
    }
  }

  ensurePeer(participantId, { replace = false } = {}) {
    const normalizedParticipantId =
      validateBannerTogetherLiveParticipantId(participantId);

    if (normalizedParticipantId === this.participantId) {
      throw new Error("A live room session cannot connect to itself.");
    }

    if (replace) {
      this.removePeer(normalizedParticipantId, "left", {
        clearReceivedSequence: true,
      });
    }

    const existing = this.peers.get(normalizedParticipantId);

    if (existing) {
      return existing;
    }

    if (this.peers.size >= MAX_REMOTE_PEERS) {
      throw new Error("A live room cannot connect more than seven remote peers.");
    }

    const peerConnection = this.peerConnectionFactory(
      BANNER_TOGETHER_LIVE_RTC_CONFIGURATION
    );
    const peer = {
      participantId: normalizedParticipantId,
      connection: peerConnection,
      channel: null,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      pendingCandidateBytes: 0,
      restartAttempts: 0,
      restartTimer: null,
      removed: false,
      quarantined: false,
      receiveWindowStartedAt: Date.now(),
      receivedFrameCount: 0,
      receivedFrameBytes: 0,
      completedMessageCount: 0,
      invalidFrameCount: 0,
      pendingSnapshotCallbacks: 0,
      snapshotQueue: Promise.resolve(),
    };
    this.peers.set(normalizedParticipantId, peer);
    this.setParticipantState(normalizedParticipantId, "connecting");

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !this.running || this.closing) {
        return;
      }

      this.signaling
        .sendIceCandidate({
          roomId: this.roomId,
          participantToken: this.participantToken,
          toParticipantId: normalizedParticipantId,
          candidate: normalizeCandidate(event.candidate),
          signal: this.lifetimeController.signal,
        })
        .catch((error) => {
          if (error?.name !== "AbortError") {
            this.reportError(error);
          }
        });
    };
    peerConnection.ondatachannel = (event) => {
      if (event.channel?.label !== BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL) {
        event.channel?.close?.();
        this.reportError(new Error("An unexpected live room data channel was rejected."));
        return;
      }

      this.attachDataChannel(peer, event.channel);
    };
    peerConnection.onconnectionstatechange = () => {
      const connectionState = peerConnection.connectionState;

      if (connectionState === "failed" || connectionState === "disconnected") {
        this.setParticipantState(normalizedParticipantId, "disconnected");
        this.schedulePeerRecovery(peer, connectionState === "failed");
      } else if (
        connectionState === "connected" &&
        peer.channel?.readyState === "open"
      ) {
        this.markPeerConnected(peer);
      }
    };

    return peer;
  }

  attachDataChannel(peer, channel) {
    if (peer.quarantined) {
      channel.close?.();
      return;
    }

    if (peer.channel && peer.channel !== channel) {
      peer.channel.close?.();
    }

    peer.channel = channel;
    channel.onopen = () => {
      this.markPeerConnected(peer);

      if (this.latestPublishedMessage) {
        sendFrames(
          channel,
          chunkBannerTogetherLiveMessage(this.latestPublishedMessage)
        )
          .then((sent) => {
            if (sent) {
              this.deliveryRecoveryAttempts.set(peer.participantId, 0);
            }
          })
          .catch((error) =>
            this.recoverPeerAfterDeliveryFailure(peer, error)
          );
      }
    };
    channel.onclose = () => {
      if (!this.closing && this.peers.has(peer.participantId)) {
        this.setParticipantState(peer.participantId, "disconnected");
        this.schedulePeerRecovery(peer, false);
      }
    };
    channel.onerror = () => {
      this.reportError(new Error("A live room data channel failed."));
    };
    channel.onmessage = (event) => {
      this.handleIncomingData(peer, event.data);
    };

    if (channel.readyState === "open") {
      channel.onopen();
    }
  }

  markPeerConnected(peer) {
    if (
      peer.connection.connectionState !== "connected" ||
      peer.channel?.readyState !== "open"
    ) {
      return;
    }

    clearTimeout(peer.restartTimer);
    peer.restartTimer = null;
    peer.restartAttempts = 0;
    this.setParticipantState(peer.participantId, "connected");
  }

  quarantinePeer(peer, message) {
    if (peer.quarantined) {
      return;
    }

    peer.quarantined = true;
    clearTimeout(peer.restartTimer);
    peer.restartTimer = null;
    peer.channel?.close?.();
    peer.connection.close?.();
    this.reassembler.clearParticipant(peer.participantId);
    this.setParticipantState(peer.participantId, "disconnected");
    this.reportError(new Error(message));
  }

  recoverPeerAfterDeliveryFailure(peer, error) {
    this.reportError(error);

    if (
      this.closing ||
      !this.running ||
      peer.removed ||
      this.peers.get(peer.participantId) !== peer
    ) {
      return;
    }

    const attempts =
      (this.deliveryRecoveryAttempts.get(peer.participantId) ?? 0) + 1;
    this.deliveryRecoveryAttempts.set(peer.participantId, attempts);

    if (attempts > MAX_ICE_RESTART_ATTEMPTS) {
      this.quarantinePeer(
        peer,
        "A live room peer repeatedly rejected snapshot delivery."
      );
      return;
    }

    const participantId = peer.participantId;
    this.removePeer(participantId, "disconnected");
    const replacementPeer = this.ensurePeer(participantId);

    if (this.participantId < participantId) {
      this.sendRecoveryOfferWithRetry(replacementPeer);
    }
  }

  async sendRecoveryOfferWithRetry(peer) {
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (
        this.closing ||
        !this.running ||
        this.peers.get(peer.participantId) !== peer
      ) {
        return;
      }

      try {
        await this.offerPeer(peer.participantId);
        return;
      } catch (error) {
        if (
          error?.name === "AbortError" ||
          this.closing ||
          !this.running ||
          this.peers.get(peer.participantId) !== peer
        ) {
          return;
        }

        if (error?.code === "peer_not_found") {
          await this.removePeerAfterSnapshots(peer.participantId);
          return;
        }

        lastError = error;
        const retryable =
          error?.code === "LIVE_ROOM_NETWORK_ERROR" ||
          error?.status === 429 ||
          (Number.isInteger(error?.status) && error.status >= 500);

        if (!retryable || attempt === 2) {
          break;
        }

        await waitForDelay(
          RECONNECT_DELAY_MS,
          this.lifetimeController.signal
        );

        if (
          this.closing ||
          !this.running ||
          this.peers.get(peer.participantId) !== peer
        ) {
          return;
        }
      }
    }

    if (
      lastError &&
      !this.closing &&
      this.running &&
      this.peers.get(peer.participantId) === peer
    ) {
      this.reportError(lastError);
      this.running = false;
      this.setSessionState("reconnect-required", lastError);
      this.lifetimeController.abort();
    }
  }

  handleIncomingData(peer, data) {
    if (peer.quarantined) {
      return;
    }

    const now = Date.now();

    if (now - peer.receiveWindowStartedAt >= RECEIVE_RATE_WINDOW_MS) {
      peer.receiveWindowStartedAt = now;
      peer.receivedFrameCount = 0;
      peer.receivedFrameBytes = 0;
      peer.completedMessageCount = 0;
      peer.invalidFrameCount = 0;
    }

    const frameBytes =
      typeof data === "string"
        ? new TextEncoder().encode(data).byteLength
        : MAX_RECEIVE_BYTES_PER_WINDOW + 1;
    peer.receivedFrameCount += 1;
    peer.receivedFrameBytes += frameBytes;

    if (
      peer.receivedFrameCount > MAX_RECEIVE_FRAMES_PER_WINDOW ||
      peer.receivedFrameBytes > MAX_RECEIVE_BYTES_PER_WINDOW
    ) {
      this.quarantinePeer(
        peer,
        "A live room peer exceeded the data rate limit."
      );
      return;
    }

    let message;

    try {
      message = this.reassembler.push(data, {
        participantId: peer.participantId,
        now,
      });
    } catch (error) {
      peer.invalidFrameCount += 1;

      if (peer.invalidFrameCount >= MAX_INVALID_FRAMES_PER_WINDOW) {
        this.quarantinePeer(
          peer,
          "A live room peer sent too many invalid data frames."
        );
      } else if (peer.invalidFrameCount === 1) {
        this.reportError(error);
      }
      return;
    }

    if (!message) {
      return;
    }

    peer.completedMessageCount += 1;

    if (
      peer.completedMessageCount > MAX_COMPLETE_MESSAGES_PER_WINDOW ||
      peer.pendingSnapshotCallbacks >= MAX_PENDING_SNAPSHOT_CALLBACKS
    ) {
      this.quarantinePeer(
        peer,
        "A live room peer sent snapshots faster than they could be processed."
      );
      return;
    }

    const previousSequence =
      this.receivedSequences.get(peer.participantId) ?? 0;

    if (message.sequence <= previousSequence) {
      return;
    }

    this.receivedSequences.set(peer.participantId, message.sequence);
    const callbackValue = {
      participantId: message.participantId,
      sequence: message.sequence,
      envelope: message.type === "snapshot" ? message.envelope : null,
    };
    peer.pendingSnapshotCallbacks += 1;
    peer.snapshotQueue = peer.snapshotQueue
      .then(async () => {
        if (this.peers.get(peer.participantId) === peer && !peer.quarantined) {
          await this.onSnapshot(callbackValue);
        }
      })
      .catch((error) => this.reportError(error))
      .finally(() => {
        peer.pendingSnapshotCallbacks -= 1;
      });
  }

  schedulePeerRecovery(peer, immediate) {
    if (
      this.closing ||
      !this.running ||
      peer.removed ||
      peer.quarantined ||
      this.participantId > peer.participantId ||
      peer.restartTimer !== null
    ) {
      return;
    }

    if (peer.restartAttempts >= MAX_ICE_RESTART_ATTEMPTS) {
      this.reportError(
        new Error("The live room peer connection could not be restored.")
      );
      return;
    }

    peer.restartTimer = setTimeout(() => {
      peer.restartTimer = null;

      if (
        this.closing ||
        !this.running ||
        this.peers.get(peer.participantId) !== peer ||
        (peer.connection.connectionState !== "failed" &&
          peer.connection.connectionState !== "disconnected" &&
          peer.channel?.readyState !== "closed")
      ) {
        return;
      }

      peer.restartAttempts += 1;
      this.offerPeer(peer.participantId, { iceRestart: true })
        .catch((error) => this.reportError(error))
        .finally(() => {
          if (
            this.peers.get(peer.participantId) === peer &&
            !peer.quarantined &&
            (peer.connection.connectionState === "failed" ||
              peer.connection.connectionState === "disconnected" ||
              peer.channel?.readyState === "closed")
          ) {
            this.schedulePeerRecovery(peer, false);
          }
        });
    }, immediate ? 0 : DISCONNECTED_RECOVERY_DELAY_MS);
  }

  async offerPeer(participantId, { iceRestart = false } = {}) {
    const peer = this.ensurePeer(participantId);

    if (!peer.channel || peer.channel.readyState === "closed") {
      this.attachDataChannel(
        peer,
        peer.connection.createDataChannel(
          BANNER_TOGETHER_LIVE_DATA_CHANNEL_LABEL,
          { ordered: true }
        )
      );
    }

    if (iceRestart) {
      peer.connection.restartIce?.();
    }

    if (
      peer.connection.signalingState === "have-local-offer" &&
      peer.connection.localDescription?.type === "offer"
    ) {
      await this.signaling.sendDescription({
        roomId: this.roomId,
        participantToken: this.participantToken,
        toParticipantId: participantId,
        description: normalizeDescription(peer.connection.localDescription),
        signal: this.lifetimeController.signal,
      });
      return;
    }

    peer.makingOffer = true;

    try {
      const offer = await peer.connection.createOffer(
        iceRestart ? { iceRestart: true } : undefined
      );

      if (peer.connection.signalingState !== "stable") {
        return;
      }

      await peer.connection.setLocalDescription(offer);
      await this.signaling.sendDescription({
        roomId: this.roomId,
        participantToken: this.participantToken,
        toParticipantId: participantId,
        description: normalizeDescription(
          peer.connection.localDescription ?? offer
        ),
        signal: this.lifetimeController.signal,
      });
    } finally {
      peer.makingOffer = false;
    }
  }

  async handleDescription(participantId, description) {
    const peer = this.ensurePeer(participantId);

    if (peer.quarantined) {
      return;
    }

    const offerCollision =
      description.type === "offer" &&
      (peer.makingOffer || peer.connection.signalingState !== "stable");
    const polite = this.participantId > participantId;
    peer.ignoreOffer = !polite && offerCollision;

    if (peer.ignoreOffer) {
      return;
    }

    if (offerCollision && peer.connection.signalingState !== "stable") {
      await peer.connection.setLocalDescription({ type: "rollback" });
    }

    await peer.connection.setRemoteDescription(description);

    const pendingCandidates = peer.pendingCandidates.splice(0);
    peer.pendingCandidateBytes = 0;

    for (const candidate of pendingCandidates) {
      await peer.connection.addIceCandidate(candidate);
    }

    if (description.type === "offer") {
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      await this.signaling.sendDescription({
        roomId: this.roomId,
        participantToken: this.participantToken,
        toParticipantId: participantId,
        description: normalizeDescription(
          peer.connection.localDescription ?? answer
        ),
        signal: this.lifetimeController.signal,
      });
    }
  }

  async handleCandidate(participantId, candidate) {
    const peer = this.ensurePeer(participantId);

    if (peer.quarantined) {
      return;
    }

    if (peer.ignoreOffer) {
      return;
    }

    if (!peer.connection.remoteDescription) {
      const candidateBytes = new TextEncoder().encode(
        JSON.stringify(candidate)
      ).byteLength;

      if (
        peer.pendingCandidates.length >= MAX_PENDING_ICE_CANDIDATES ||
        peer.pendingCandidateBytes + candidateBytes > MAX_PENDING_ICE_BYTES
      ) {
        this.removePeer(participantId, "disconnected");
        throw new Error("Too many ICE candidates arrived before an offer.");
      }

      peer.pendingCandidates.push(candidate);
      peer.pendingCandidateBytes += candidateBytes;
      return;
    }

    await peer.connection.addIceCandidate(candidate);
  }

  async handleEvent(event) {
    if (event.type === "peer-left") {
      if (event.participantId !== this.participantId) {
        await this.peers.get(event.participantId)?.snapshotQueue;
        this.removePeer(event.participantId, "left");
      }
      return;
    }

    if (event.type === "peer-joined" || event.type === "peer-rejoined") {
      if (event.participantId !== this.participantId) {
        if (event.type === "peer-rejoined") {
          await this.peers.get(event.participantId)?.snapshotQueue;
        }

        this.ensurePeer(event.participantId, {
          replace: event.type === "peer-rejoined",
        });
        await this.offerPeer(event.participantId);
      }
      return;
    }

    if (event.type === "signal" && event.fromParticipantId !== this.participantId) {
      if (event.description) {
        await this.handleDescription(
          event.fromParticipantId,
          event.description
        );
      } else {
        await this.handleCandidate(event.fromParticipantId, event.candidate);
      }
    }
  }

  async removePeerAfterSnapshots(participantId) {
    const peer = this.peers.get(participantId);

    if (!peer) {
      this.removePeer(participantId, "left");
      return;
    }

    await peer.snapshotQueue;

    if (this.peers.get(participantId) === peer) {
      this.removePeer(participantId, "left");
    }
  }

  async reconcilePeers(participantIds) {
    const activePeers = new Set(
      participantIds.filter((participantId) => participantId !== this.participantId)
    );

    activePeers.forEach((participantId) => this.ensurePeer(participantId));
    await Promise.all(
      [...this.peers.keys()]
        .filter((participantId) => !activePeers.has(participantId))
        .map((participantId) =>
          this.removePeerAfterSnapshots(participantId)
        )
    );
  }

  async pollLoop(after) {
    let cursor = after;

    while (this.running && !this.closing) {
      let response;

      try {
        response = await this.signaling.pollEvents({
          roomId: this.roomId,
          participantToken: this.participantToken,
          after: cursor,
          signal: this.lifetimeController.signal,
        });
      } catch (error) {
        if (error?.name === "AbortError" || this.closing || !this.running) {
          return;
        }

        this.reportError(error);

        if (
          error?.status === 401 ||
          error?.status === 403 ||
          error?.status === 404 ||
          error?.status === 409 ||
          error?.status === 410
        ) {
          this.running = false;
          this.setSessionState("reconnect-required", error);
          return;
        }

        await waitForDelay(
          RECONNECT_DELAY_MS,
          this.lifetimeController.signal
        );
        continue;
      }

      for (const event of response.events) {
        await this.handleEventWithPolicy(event);
        cursor = Math.max(cursor, event.id);

        if (!this.running || this.closing) {
          return;
        }
      }

      cursor = response.nextEventId;

      try {
        await this.reconcilePeers(response.peers);
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  async handleEventWithPolicy(event) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.handleEvent(event);
        return;
      } catch (error) {
        if (error?.name === "AbortError" || this.closing || !this.running) {
          return;
        }

        if (error?.code === "peer_not_found") {
          const participantId =
            event.participantId ?? event.fromParticipantId;

          if (participantId && participantId !== this.participantId) {
            await this.removePeerAfterSnapshots(participantId);
          }
          return;
        }

        if (
          error?.status === 401 ||
          error?.status === 403 ||
          error?.status === 410
        ) {
          this.reportError(error);
          this.running = false;
          this.setSessionState("reconnect-required", error);
          return;
        }

        const retryable =
          error?.code === "LIVE_ROOM_NETWORK_ERROR" ||
          error?.status === 429 ||
          (Number.isInteger(error?.status) && error.status >= 500);

        if (retryable && attempt < 2) {
          await waitForDelay(
            RECONNECT_DELAY_MS,
            this.lifetimeController.signal
          );
          continue;
        }

        this.reportError(error);
        return;
      }
    }
  }

  removePeer(
    participantId,
    finalState = "disconnected",
    { clearReceivedSequence = finalState === "left" } = {}
  ) {
    const peer = this.peers.get(participantId);

    if (peer) {
      clearTimeout(peer.restartTimer);
      peer.removed = true;
      peer.channel?.close?.();
      peer.connection.close?.();
      this.peers.delete(participantId);
    }

    this.reassembler.clearParticipant(participantId);

    if (clearReceivedSequence) {
      this.receivedSequences.delete(participantId);
    }

    if (finalState === "left") {
      this.deliveryRecoveryAttempts.delete(participantId);
    }

    this.setParticipantState(participantId, finalState);
  }

  async close({ notifyServer = true } = {}) {
    if (this.closing) {
      await this.pollPromise?.catch(() => {});
      return;
    }

    const wasRunning = this.running;
    this.closing = true;
    this.running = false;
    this.lifetimeController?.abort();
    this.peers.forEach((_peer, participantId) => {
      this.removePeer(participantId, "left");
    });
    this.reassembler.clear();
    await this.pollPromise?.catch((error) => this.reportError(error));

    if (notifyServer && wasRunning) {
      try {
        await this.signaling.leaveRoom({
          roomId: this.roomId,
          participantToken: this.participantToken,
        });
      } catch (error) {
        if (error?.name !== "AbortError") {
          this.reportError(error);
        }
      }
    }

    this.setSessionState("closed");
  }
}

export function createBannerTogetherPeerMeshSession(options) {
  return new BannerTogetherPeerMeshSession(options);
}
