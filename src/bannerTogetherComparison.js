export const BANNER_TOGETHER_COMPARISON_ROLES = Object.freeze([
  "creator",
  "recipient",
]);

export const BANNER_TOGETHER_COMPARISON_STATUSES = Object.freeze([
  "todo",
  "done",
  "hidden",
  "unlisted",
]);

export const BANNER_TOGETHER_COMPARISON_STATUS_OPTIONS = Object.freeze([
  Object.freeze({ value: "todo", label: "To do" }),
  Object.freeze({ value: "done", label: "Done" }),
  Object.freeze({ value: "hidden", label: "Hide" }),
  Object.freeze({ value: "unlisted", label: "Not listed" }),
]);

export const BANNER_TOGETHER_COMPARISON_PRESET_IDS = Object.freeze({
  BOTH_TODO: "both-todo",
  CREATOR_TODO_ONLY: "creator-todo-only",
  CREATOR_TODO_NOT_RECIPIENT_HIDDEN:
    "creator-todo-not-recipient-hidden",
  RECIPIENT_TODO_ONLY: "recipient-todo-only",
});

export const BANNER_TOGETHER_DEFAULT_COMPARISON_PRESET_ID =
  BANNER_TOGETHER_COMPARISON_PRESET_IDS.BOTH_TODO;

const MAX_COMPARISON_MASK =
  2 **
    (BANNER_TOGETHER_COMPARISON_STATUSES.length *
      BANNER_TOGETHER_COMPARISON_STATUSES.length) -
  1;
const CLAUSE_KEYS = new Set(["creator", "recipient"]);
const LIST_KEYS = new Set(["todo", "done", "hidden", "blacklist", "hide"]);

function validateViewerRole(viewerRole) {
  if (!BANNER_TOGETHER_COMPARISON_ROLES.includes(viewerRole)) {
    throw new Error(`Unsupported Banner Together viewer role: ${viewerRole}.`);
  }

  return viewerRole;
}

function validateBannerId(bannerId) {
  if (
    typeof bannerId !== "string" ||
    bannerId.length === 0 ||
    bannerId.trim() !== bannerId ||
    /[\u0000-\u001f\u007f]/.test(bannerId)
  ) {
    throw new Error("Banner Together membership contains an invalid banner ID.");
  }

  return bannerId;
}

export function normalizeBannerTogetherComparisonStatus(status) {
  if (status === "blacklist" || status === "hide") {
    return "hidden";
  }

  if (BANNER_TOGETHER_COMPARISON_STATUSES.includes(status)) {
    return status;
  }

  throw new Error(`Unsupported Banner Together list status: ${String(status)}.`);
}

export function getBannerTogetherComparisonStatusLabel(status) {
  const normalizedStatus = normalizeBannerTogetherComparisonStatus(status);
  return BANNER_TOGETHER_COMPARISON_STATUS_OPTIONS.find(
    (option) => option.value === normalizedStatus
  ).label;
}

function addMembership(index, bannerId, status) {
  const normalizedBannerId = validateBannerId(bannerId);
  const normalizedStatus = normalizeBannerTogetherComparisonStatus(status);

  if (normalizedStatus === "unlisted") {
    throw new Error(
      "Unlisted is derived from missing membership and cannot be stored explicitly."
    );
  }

  const existingStatus = index.get(normalizedBannerId);

  if (existingStatus && existingStatus !== normalizedStatus) {
    throw new Error(
      `Banner ${normalizedBannerId} appears in more than one Banner Together list.`
    );
  }

  index.set(normalizedBannerId, normalizedStatus);
}

export function createBannerTogetherMembershipIndex(entries = []) {
  let normalizedEntries;

  if (entries instanceof Map) {
    normalizedEntries = [...entries.entries()];
  } else if (Array.isArray(entries)) {
    normalizedEntries = entries.map((entry) => {
      if (Array.isArray(entry) && entry.length === 2) {
        return entry;
      }

      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        return [entry.id, entry.status ?? entry.listType];
      }

      throw new Error("Banner Together membership entries are invalid.");
    });
  } else if (entries && typeof entries === "object") {
    normalizedEntries = Object.entries(entries);
  } else {
    throw new Error("Banner Together memberships must be entries or an object.");
  }

  const index = new Map();

  normalizedEntries.forEach(([bannerId, status]) => {
    addMembership(index, bannerId, status);
  });

  return index;
}

export function createBannerTogetherMembershipIndexFromLists(lists = {}) {
  if (!lists || typeof lists !== "object" || Array.isArray(lists)) {
    throw new Error("Banner Together lists must be an object.");
  }

  const unexpectedKey = Object.keys(lists).find((key) => !LIST_KEYS.has(key));

  if (unexpectedKey) {
    throw new Error(`Unsupported Banner Together list: ${unexpectedKey}.`);
  }

  const index = new Map();

  Object.entries(lists).forEach(([status, banners]) => {
    if (!Array.isArray(banners)) {
      throw new Error(`Banner Together ${status} memberships must be an array.`);
    }

    banners.forEach((banner) => {
      const bannerId = typeof banner === "string" ? banner : banner?.id;
      addMembership(index, bannerId, status);
    });
  });

  return index;
}

export function getBannerTogetherMembershipStatus(membershipIndex, bannerId) {
  if (!(membershipIndex instanceof Map)) {
    throw new Error("Banner Together membership index must be a Map.");
  }

  const normalizedBannerId = validateBannerId(bannerId);
  return membershipIndex.get(normalizedBannerId) ?? "unlisted";
}

function normalizeStatusSelection(statuses, side) {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new Error(
      `Each Banner Together clause needs at least one ${side} status.`
    );
  }

  const selectedStatuses = new Set(
    statuses.map(normalizeBannerTogetherComparisonStatus)
  );

  return BANNER_TOGETHER_COMPARISON_STATUSES.filter((status) =>
    selectedStatuses.has(status)
  );
}

function normalizeClause(clause) {
  if (!clause || typeof clause !== "object" || Array.isArray(clause)) {
    throw new Error("Banner Together comparison clauses must be objects.");
  }

  const clauseKeys = Object.keys(clause);

  if (
    clauseKeys.length !== CLAUSE_KEYS.size ||
    clauseKeys.some((key) => !CLAUSE_KEYS.has(key))
  ) {
    throw new Error(
      "Banner Together comparison clauses require creator and recipient statuses."
    );
  }

  return {
    creator: normalizeStatusSelection(clause.creator, "creator"),
    recipient: normalizeStatusSelection(clause.recipient, "recipient"),
  };
}

export function getBannerTogetherComparisonPairBit(
  creatorStatus,
  recipientStatus
) {
  const normalizedCreatorStatus =
    normalizeBannerTogetherComparisonStatus(creatorStatus);
  const normalizedRecipientStatus =
    normalizeBannerTogetherComparisonStatus(recipientStatus);
  const creatorIndex = BANNER_TOGETHER_COMPARISON_STATUSES.indexOf(
    normalizedCreatorStatus
  );
  const recipientIndex = BANNER_TOGETHER_COMPARISON_STATUSES.indexOf(
    normalizedRecipientStatus
  );

  return 2 **
    (creatorIndex * BANNER_TOGETHER_COMPARISON_STATUSES.length +
      recipientIndex);
}

export function createBannerTogetherComparisonMask(clauses) {
  if (!Array.isArray(clauses) || clauses.length === 0) {
    throw new Error("Choose at least one Banner Together comparison clause.");
  }

  return clauses.reduce((mask, clause) => {
    const normalizedClause = normalizeClause(clause);

    normalizedClause.creator.forEach((creatorStatus) => {
      normalizedClause.recipient.forEach((recipientStatus) => {
        mask |= getBannerTogetherComparisonPairBit(
          creatorStatus,
          recipientStatus
        );
      });
    });

    return mask;
  }, 0);
}

function validateComparisonMask(mask) {
  if (!Number.isInteger(mask) || mask <= 0 || mask > MAX_COMPARISON_MASK) {
    throw new Error("Banner Together comparison mask is invalid.");
  }

  return mask;
}

export function canonicalizeBannerTogetherComparisonClauses(clauses) {
  const mask = createBannerTogetherComparisonMask(clauses);

  return BANNER_TOGETHER_COMPARISON_STATUSES.flatMap((creatorStatus) => {
    const recipientStatuses = BANNER_TOGETHER_COMPARISON_STATUSES.filter(
      (recipientStatus) =>
        Boolean(
          mask &
            getBannerTogetherComparisonPairBit(
              creatorStatus,
              recipientStatus
            )
        )
    );

    return recipientStatuses.length > 0
      ? [{ creator: [creatorStatus], recipient: recipientStatuses }]
      : [];
  });
}

export function bannerTogetherComparisonMaskMatches(
  mask,
  creatorStatus,
  recipientStatus
) {
  return Boolean(
    validateComparisonMask(mask) &
      getBannerTogetherComparisonPairBit(creatorStatus, recipientStatus)
  );
}

const PRESET_CLAUSES = Object.freeze({
  [BANNER_TOGETHER_COMPARISON_PRESET_IDS.BOTH_TODO]: Object.freeze([
    Object.freeze({
      creator: Object.freeze(["todo"]),
      recipient: Object.freeze(["todo"]),
    }),
  ]),
  [BANNER_TOGETHER_COMPARISON_PRESET_IDS.CREATOR_TODO_ONLY]: Object.freeze([
    Object.freeze({
      creator: Object.freeze(["todo"]),
      recipient: Object.freeze(["unlisted"]),
    }),
  ]),
  [BANNER_TOGETHER_COMPARISON_PRESET_IDS.CREATOR_TODO_NOT_RECIPIENT_HIDDEN]:
    Object.freeze([
      Object.freeze({
        creator: Object.freeze(["todo"]),
        recipient: Object.freeze(["todo", "done", "unlisted"]),
      }),
    ]),
  [BANNER_TOGETHER_COMPARISON_PRESET_IDS.RECIPIENT_TODO_ONLY]: Object.freeze([
    Object.freeze({
      creator: Object.freeze(["unlisted"]),
      recipient: Object.freeze(["todo"]),
    }),
  ]),
});

const PRESET_LABELS = Object.freeze({
  creator: Object.freeze({
    [BANNER_TOGETHER_COMPARISON_PRESET_IDS.BOTH_TODO]: "Both to do",
    [BANNER_TOGETHER_COMPARISON_PRESET_IDS.CREATOR_TODO_ONLY]:
      "My to-do only",
    [BANNER_TOGETHER_COMPARISON_PRESET_IDS.CREATOR_TODO_NOT_RECIPIENT_HIDDEN]:
      "My to-do, not hidden by them",
    [BANNER_TOGETHER_COMPARISON_PRESET_IDS.RECIPIENT_TODO_ONLY]:
      "Their to-do only",
  }),
  recipient: Object.freeze({
    [BANNER_TOGETHER_COMPARISON_PRESET_IDS.BOTH_TODO]: "Both to do",
    [BANNER_TOGETHER_COMPARISON_PRESET_IDS.CREATOR_TODO_ONLY]:
      "Inviter's to-do only",
    [BANNER_TOGETHER_COMPARISON_PRESET_IDS.CREATOR_TODO_NOT_RECIPIENT_HIDDEN]:
      "Inviter's to-do, not hidden by me",
    [BANNER_TOGETHER_COMPARISON_PRESET_IDS.RECIPIENT_TODO_ONLY]:
      "My to-do only",
  }),
});

function cloneClauses(clauses) {
  return clauses.map((clause) => ({
    creator: [...clause.creator],
    recipient: [...clause.recipient],
  }));
}

export function getBannerTogetherComparisonPresetClauses(presetId) {
  const clauses = PRESET_CLAUSES[presetId];

  if (!clauses) {
    throw new Error(`Unsupported Banner Together preset: ${presetId}.`);
  }

  return cloneClauses(clauses);
}

export function getBannerTogetherComparisonPresetOptions(viewerRole) {
  const normalizedViewerRole = validateViewerRole(viewerRole);

  return Object.values(BANNER_TOGETHER_COMPARISON_PRESET_IDS).map(
    (presetId) => ({
      id: presetId,
      label: PRESET_LABELS[normalizedViewerRole][presetId],
      clauses: getBannerTogetherComparisonPresetClauses(presetId),
    })
  );
}

export function getBannerTogetherComparisonRoleLabels(viewerRole) {
  const normalizedViewerRole = validateViewerRole(viewerRole);

  return normalizedViewerRole === "creator"
    ? { creator: "Mine", recipient: "Theirs" }
    : { creator: "Inviter", recipient: "Mine" };
}

export function findBannerTogetherComparisonPresetId(clauses) {
  const comparisonMask = createBannerTogetherComparisonMask(clauses);

  return (
    Object.values(BANNER_TOGETHER_COMPARISON_PRESET_IDS).find(
      (presetId) =>
        createBannerTogetherComparisonMask(PRESET_CLAUSES[presetId]) ===
        comparisonMask
    ) ?? null
  );
}

function normalizeMemberships(memberships) {
  if (memberships === undefined || memberships === null) {
    return new Map();
  }

  return createBannerTogetherMembershipIndex(memberships);
}

function mergeBannerMetadata(existingBanner, nextBanner) {
  if (!existingBanner) {
    return Object.fromEntries(
      Object.entries(nextBanner).filter(([_key, value]) => value !== undefined)
    );
  }

  const mergedBanner = { ...existingBanner };

  Object.entries(nextBanner).forEach(([key, value]) => {
    if (value !== undefined) {
      mergedBanner[key] = value;
    }
  });

  return mergedBanner;
}

function compareResultTitles(resultA, resultB) {
  const titleA =
    typeof resultA.banner.title === "string" && resultA.banner.title
      ? resultA.banner.title
      : resultA.id;
  const titleB =
    typeof resultB.banner.title === "string" && resultB.banner.title
      ? resultB.banner.title
      : resultB.id;
  const titleComparison = titleA.localeCompare(titleB, undefined, {
    sensitivity: "base",
  });

  return titleComparison || resultA.id.localeCompare(resultB.id);
}

export function evaluateBannerTogetherComparison({
  catalogBanners,
  creatorMemberships,
  recipientMemberships,
  clauses,
}) {
  if (!Array.isArray(catalogBanners)) {
    throw new Error("Banner Together catalog must be an array.");
  }

  const comparisonMask = createBannerTogetherComparisonMask(clauses);
  const canonicalClauses = canonicalizeBannerTogetherComparisonClauses(clauses);
  const creatorIndex = normalizeMemberships(creatorMemberships);
  const recipientIndex = normalizeMemberships(recipientMemberships);
  const catalogById = new Map();

  catalogBanners.forEach((banner) => {
    if (!banner || typeof banner !== "object" || Array.isArray(banner)) {
      throw new Error("Banner Together catalog entries must be banner objects.");
    }

    const bannerId = validateBannerId(banner.id);
    catalogById.set(
      bannerId,
      mergeBannerMetadata(catalogById.get(bannerId), banner)
    );
  });

  const missingCatalogIds = new Set();

  [...creatorIndex.keys(), ...recipientIndex.keys()].forEach((bannerId) => {
    if (!catalogById.has(bannerId)) {
      missingCatalogIds.add(bannerId);
    }
  });

  const results = [...catalogById.entries()]
    .map(([bannerId, banner]) => {
      const creatorStatus = getBannerTogetherMembershipStatus(
        creatorIndex,
        bannerId
      );
      const recipientStatus = getBannerTogetherMembershipStatus(
        recipientIndex,
        bannerId
      );

      return {
        id: bannerId,
        banner,
        creatorStatus,
        recipientStatus,
      };
    })
    .filter((result) =>
      bannerTogetherComparisonMaskMatches(
        comparisonMask,
        result.creatorStatus,
        result.recipientStatus
      )
    )
    .sort(compareResultTitles);

  return {
    comparisonMask,
    clauses: canonicalClauses,
    results,
    missingCatalogCount: missingCatalogIds.size,
  };
}
