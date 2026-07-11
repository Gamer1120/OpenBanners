import {
  BANNER_TOGETHER_HASH_PREFIX,
  BANNER_TOGETHER_MAX_AGE_MS,
  BANNER_TOGETHER_MAX_BANNER_IDS,
  BANNER_TOGETHER_MAX_HASH_LENGTH,
  createBannerTogetherInviteHash,
  createBannerTogetherInviteUrl,
  getSharedTodoBanners,
  parseBannerTogetherInviteHash,
} from "./bannerTogether";

const TEST_CREATED_AT = new Date().toISOString();

function bytesToBase64Url(bytes) {
  let binaryValue = "";

  bytes.forEach((byte) => {
    binaryValue += String.fromCharCode(byte);
  });

  return globalThis
    .btoa(binaryValue)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createRawHash(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return `${BANNER_TOGETHER_HASH_PREFIX}raw.${bytesToBase64Url(bytes)}`;
}

function createValidPayload(overrides = {}) {
  return {
    version: 1,
    placeId: "amsterdam",
    bannerIds: ["banner-one", "banner-two"],
    createdAt: TEST_CREATED_AT,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("creates and parses a UTF-8-safe place-scoped invite URL", async () => {
  const createdAt = TEST_CREATED_AT;
  const inviteUrl = await createBannerTogetherInviteUrl({
    origin: "https://openbanners.org",
    placeId: "東京 centrum",
    bannerIds: ["ирбис-3c44", "旗-🚩", "café-route"],
    createdAt,
  });
  const parsedUrl = new URL(inviteUrl);

  expect(parsedUrl.origin).toBe("https://openbanners.org");
  expect(decodeURIComponent(parsedUrl.pathname)).toBe("/together/東京 centrum");
  expect(parsedUrl.hash).toMatch(/^#banner-together=(?:raw|gzip)\./);
  await expect(parseBannerTogetherInviteHash(parsedUrl.hash)).resolves.toEqual({
    version: 1,
    placeId: "東京 centrum",
    bannerIds: ["ирбис-3c44", "旗-🚩", "café-route"],
    createdAt,
  });
});

test("falls back to an explicitly prefixed raw payload without compression streams", async () => {
  vi.stubGlobal("CompressionStream", undefined);
  vi.stubGlobal("DecompressionStream", undefined);

  const hash = await createBannerTogetherInviteHash({
    placeId: "utrecht",
    bannerIds: ["route-a"],
    createdAt: TEST_CREATED_AT,
  });

  expect(hash).toMatch(/^#banner-together=raw\./);
  await expect(parseBannerTogetherInviteHash(hash)).resolves.toEqual(
    createValidPayload({
      placeId: "utrecht",
      bannerIds: ["route-a"],
    })
  );
});

test("de-duplicates banner IDs while preserving their first-seen order", async () => {
  const hash = await createBannerTogetherInviteHash({
    placeId: "rotterdam",
    bannerIds: ["alpha", "beta", "alpha", "gamma", "beta"],
    createdAt: TEST_CREATED_AT,
  });

  await expect(parseBannerTogetherInviteHash(hash)).resolves.toMatchObject({
    placeId: "rotterdam",
    bannerIds: ["alpha", "beta", "gamma"],
  });
});

test("uses a canonical creation timestamp by default", async () => {
  const beforeCreation = Date.now();
  const hash = await createBannerTogetherInviteHash({
    placeId: "den-haag",
    bannerIds: [],
  });
  const invite = await parseBannerTogetherInviteHash(hash);
  const createdAt = new Date(invite.createdAt).getTime();

  expect(createdAt).toBeGreaterThanOrEqual(beforeCreation);
  expect(createdAt).toBeLessThanOrEqual(Date.now());
  expect(new Date(invite.createdAt).toISOString()).toBe(invite.createdAt);
});

test("never includes caller-provided auth or token fields", async () => {
  const hash = await createBannerTogetherInviteHash({
    placeId: "eindhoven",
    bannerIds: ["public-banner-id"],
    createdAt: TEST_CREATED_AT,
    accessToken: "access-token-must-not-leak",
    refreshToken: "refresh-token-must-not-leak",
    auth: { idToken: "id-token-must-not-leak" },
  });
  const invite = await parseBannerTogetherInviteHash(hash);

  expect(invite).toEqual({
    version: 1,
    placeId: "eindhoven",
    bannerIds: ["public-banner-id"],
    createdAt: TEST_CREATED_AT,
  });
  expect(JSON.stringify(invite)).not.toContain("token-must-not-leak");
});

test("rejects payloads that contain token-like or other unexpected fields", async () => {
  const payload = createValidPayload({
    accessToken: "not-allowed",
  });

  await expect(
    parseBannerTogetherInviteHash(createRawHash(payload))
  ).rejects.toThrow(/unexpected fields/i);
});

test.each([
  ["missing hash prefix", "#something-else=raw.abc", /prefix/i],
  ["missing encoding", `${BANNER_TOGETHER_HASH_PREFIX}abc`, /encoding/i],
  [
    "unknown encoding",
    `${BANNER_TOGETHER_HASH_PREFIX}brotli.abc`,
    /unsupported invite encoding/i,
  ],
  [
    "invalid base64url characters",
    `${BANNER_TOGETHER_HASH_PREFIX}raw.not+base64`,
    /base64url/i,
  ],
  [
    "invalid base64url length",
    `${BANNER_TOGETHER_HASH_PREFIX}raw.a`,
    /base64url/i,
  ],
  [
    "invalid JSON",
    `${BANNER_TOGETHER_HASH_PREFIX}raw.${bytesToBase64Url(
      new TextEncoder().encode("not JSON")
    )}`,
    /valid JSON/i,
  ],
])("rejects %s", async (_label, hash, expectedError) => {
  await expect(parseBannerTogetherInviteHash(hash)).rejects.toThrow(
    expectedError
  );
});

test("rejects an unknown payload version", async () => {
  const hash = createRawHash(createValidPayload({ version: 2 }));

  await expect(parseBannerTogetherInviteHash(hash)).rejects.toThrow(
    /unsupported invite version/i
  );
});

test.each([
  ["an empty place ID", { placeId: "" }, /place ID/i],
  ["a whitespace-padded place ID", { placeId: " amsterdam" }, /place ID/i],
  ["a too-long place ID", { placeId: "p".repeat(257) }, /too long/i],
  ["a non-array banner list", { bannerIds: "banner-one" }, /array/i],
  ["an empty banner ID", { bannerIds: [""] }, /banner ID/i],
  ["a too-long banner ID", { bannerIds: ["b".repeat(257)] }, /too long/i],
  ["duplicate serialized banner IDs", { bannerIds: ["same", "same"] }, /unique/i],
  ["an invalid timestamp", { createdAt: "yesterday" }, /createdAt/i],
  [
    "a non-canonical timestamp",
    { createdAt: "2026-07-11T09:30:00Z" },
    /canonical ISO/i,
  ],
])("rejects a payload with %s", async (_label, overrides, expectedError) => {
  const hash = createRawHash(createValidPayload(overrides));

  await expect(parseBannerTogetherInviteHash(hash)).rejects.toThrow(
    expectedError
  );
});

test("rejects an invite with more than the maximum number of banner IDs", async () => {
  const bannerIds = Array.from(
    { length: BANNER_TOGETHER_MAX_BANNER_IDS + 1 },
    (_value, index) => `banner-${index}`
  );
  const hash = createRawHash(createValidPayload({ bannerIds }));

  await expect(parseBannerTogetherInviteHash(hash)).rejects.toThrow(/too large/i);
  await expect(
    createBannerTogetherInviteHash({
      placeId: "amsterdam",
      bannerIds,
    })
  ).rejects.toThrow(
    new RegExp(`at most ${BANNER_TOGETHER_MAX_BANNER_IDS}`, "i")
  );
});

test("accepts exactly the maximum number of unique banner IDs", async () => {
  const bannerIds = Array.from(
    { length: BANNER_TOGETHER_MAX_BANNER_IDS },
    (_value, index) => `banner-${index}`
  );
  const hash = await createBannerTogetherInviteHash({
    placeId: "amsterdam",
    bannerIds,
    createdAt: TEST_CREATED_AT,
  });
  const invite = await parseBannerTogetherInviteHash(hash);

  expect(invite.bannerIds).toHaveLength(BANNER_TOGETHER_MAX_BANNER_IDS);
  expect(invite.bannerIds.at(-1)).toBe("banner-999");
});

test("keeps ordinary invites raw so older recipients do not need gzip support", async () => {
  const hash = await createBannerTogetherInviteHash({
    placeId: "amsterdam",
    bannerIds: ["banner-one", "banner-two"],
    createdAt: TEST_CREATED_AT,
  });

  expect(hash).toMatch(/^#banner-together=raw\./);

  vi.stubGlobal("DecompressionStream", undefined);
  await expect(parseBannerTogetherInviteHash(hash)).resolves.toMatchObject({
    placeId: "amsterdam",
    bannerIds: ["banner-one", "banner-two"],
  });
});

test("rejects stale and implausibly future snapshot timestamps", async () => {
  const now = Date.now();
  const expiredHash = createRawHash(
    createValidPayload({
      createdAt: new Date(now - BANNER_TOGETHER_MAX_AGE_MS - 1).toISOString(),
    })
  );
  const futureHash = createRawHash(
    createValidPayload({
      createdAt: new Date(now + 6 * 60 * 1000).toISOString(),
    })
  );

  await expect(
    parseBannerTogetherInviteHash(expiredHash, { now })
  ).rejects.toThrow(/expired/i);
  await expect(
    parseBannerTogetherInviteHash(futureHash, { now })
  ).rejects.toThrow(/future/i);
});

test("enforces a practical final hash size for high-entropy IDs", async () => {
  const bannerIds = Array.from({ length: BANNER_TOGETHER_MAX_BANNER_IDS }, () =>
    Array.from({ length: 5 }, () => crypto.randomUUID()).join("")
  );

  await expect(
    createBannerTogetherInviteHash({
      placeId: "amsterdam",
      bannerIds,
      createdAt: TEST_CREATED_AT,
    })
  ).rejects.toThrow(/too large to share reliably/i);

  await expect(
    parseBannerTogetherInviteHash(
      `${BANNER_TOGETHER_HASH_PREFIX}raw.${"a".repeat(
        BANNER_TOGETHER_MAX_HASH_LENGTH
      )}`
    )
  ).rejects.toThrow(/too large/i);
});

test("rejects invalid create arguments and origins", async () => {
  await expect(
    createBannerTogetherInviteUrl({
      origin: "javascript:alert(1)",
      placeId: "amsterdam",
      bannerIds: [],
    })
  ).rejects.toThrow(/valid HTTP or HTTPS origin/i);

  await expect(
    createBannerTogetherInviteHash({
      placeId: "amsterdam",
      bannerIds: [null],
    })
  ).rejects.toThrow(/banner ID must be a string/i);
});

test("returns shared todo records once in the user's original order", () => {
  const ownTodoBanners = [
    { id: "beta", title: "Beta" },
    { id: "alpha", title: "Alpha" },
    { id: "beta", title: "Duplicate Beta" },
    null,
    { title: "Missing ID" },
    { id: "gamma", title: "Gamma" },
  ];

  expect(
    getSharedTodoBanners(ownTodoBanners, ["alpha", "beta", "beta", "other"])
  ).toEqual([
    { id: "beta", title: "Beta" },
    { id: "alpha", title: "Alpha" },
  ]);
  expect(getSharedTodoBanners(null, ["alpha"])).toEqual([]);
  expect(getSharedTodoBanners(ownTodoBanners, null)).toEqual([]);
});
