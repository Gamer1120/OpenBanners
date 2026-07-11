export const BANNER_TOGETHER_GROUP_STATUSES = Object.freeze([
  "todo",
  "done",
  "hidden",
  "unlisted",
]);

export const BANNER_TOGETHER_GROUP_STATUS_OPTIONS = Object.freeze([
  Object.freeze({ value: "todo", label: "To do" }),
  Object.freeze({ value: "done", label: "Done" }),
  Object.freeze({ value: "hidden", label: "Hide" }),
  Object.freeze({ value: "unlisted", label: "Not listed" }),
]);

export const BANNER_TOGETHER_GROUP_PRESET_IDS = Object.freeze({
  EVERYONE_TODO: "everyone-todo",
  MY_TODO_OTHERS_UNLISTED: "my-todo-others-unlisted",
  MY_TODO_NOBODY_ELSE_HIDDEN: "my-todo-nobody-else-hidden",
  AT_LEAST_TWO_TODO: "at-least-two-todo",
});

export const BANNER_TOGETHER_GROUP_DEFAULT_PRESET_ID =
  BANNER_TOGETHER_GROUP_PRESET_IDS.EVERYONE_TODO;

const MAX_PARTICIPANTS = 8;
const MAX_PARTICIPANT_ID_LENGTH = 128;
const MAX_PARTICIPANT_LABEL_LENGTH = 100;
const LIST_KEYS = new Set(["todo", "done", "hidden", "hide", "blacklist"]);
const ALL_STATUSES = [...BANNER_TOGETHER_GROUP_STATUSES];
const NOT_HIDDEN_STATUSES = BANNER_TOGETHER_GROUP_STATUSES.filter(
  (status) => status !== "hidden"
);

const PRESET_LABELS = Object.freeze({
  [BANNER_TOGETHER_GROUP_PRESET_IDS.EVERYONE_TODO]: "Everyone to-do",
  [BANNER_TOGETHER_GROUP_PRESET_IDS.MY_TODO_OTHERS_UNLISTED]:
    "My to-do, everyone else not listed",
  [BANNER_TOGETHER_GROUP_PRESET_IDS.MY_TODO_NOBODY_ELSE_HIDDEN]:
    "My to-do, nobody else hidden",
  [BANNER_TOGETHER_GROUP_PRESET_IDS.AT_LEAST_TWO_TODO]:
    "At least two to-do",
});

function validateIdentifier(value, kind, maxLength) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`Banner Together ${kind} is invalid.`);
  }

  return value;
}

function validateBannerId(bannerId) {
  return validateIdentifier(bannerId, "banner ID", 256);
}

function validateParticipantId(participantId) {
  return validateIdentifier(
    participantId,
    "participant ID",
    MAX_PARTICIPANT_ID_LENGTH
  );
}

function validateParticipantLabel(label) {
  return validateIdentifier(
    label,
    "participant label",
    MAX_PARTICIPANT_LABEL_LENGTH
  );
}

export function normalizeBannerTogetherGroupStatus(status) {
  if (status === "blacklist" || status === "hide") {
    return "hidden";
  }

  if (BANNER_TOGETHER_GROUP_STATUSES.includes(status)) {
    return status;
  }

  throw new Error(`Unsupported Banner Together list status: ${String(status)}.`);
}

function readBannerId(banner) {
  return validateBannerId(typeof banner === "string" ? banner : banner?.id);
}

function normalizeParticipantLists(lists = {}) {
  if (!lists || typeof lists !== "object" || Array.isArray(lists)) {
    throw new Error("Banner Together participant lists must be an object.");
  }

  const unexpectedKey = Object.keys(lists).find((key) => !LIST_KEYS.has(key));

  if (unexpectedKey) {
    throw new Error(`Unsupported Banner Together list: ${unexpectedKey}.`);
  }

  const memberships = new Map();

  Object.entries(lists).forEach(([listType, banners]) => {
    if (!Array.isArray(banners)) {
      throw new Error(
        `Banner Together ${listType} memberships must be an array.`
      );
    }

    const normalizedStatus = normalizeBannerTogetherGroupStatus(listType);

    banners.forEach((banner) => {
      const bannerId = readBannerId(banner);

      if (memberships.has(bannerId)) {
        throw new Error(
          `Banner ${bannerId} appears more than once in a participant's lists.`
        );
      }

      memberships.set(bannerId, normalizedStatus);
    });
  });

  return {
    todo: [...memberships.entries()]
      .filter(([_bannerId, status]) => status === "todo")
      .map(([bannerId]) => bannerId)
      .sort(),
    done: [...memberships.entries()]
      .filter(([_bannerId, status]) => status === "done")
      .map(([bannerId]) => bannerId)
      .sort(),
    hidden: [...memberships.entries()]
      .filter(([_bannerId, status]) => status === "hidden")
      .map(([bannerId]) => bannerId)
      .sort(),
  };
}

function normalizeParticipantDescriptors(participants) {
  if (!Array.isArray(participants)) {
    throw new Error("Banner Together participants must be an array.");
  }

  if (participants.length < 2 || participants.length > MAX_PARTICIPANTS) {
    throw new Error(
      `Banner Together rooms require 2 to ${MAX_PARTICIPANTS} participants.`
    );
  }

  const participantIds = new Set();

  return participants.map((participant) => {
    if (!participant || typeof participant !== "object" || Array.isArray(participant)) {
      throw new Error("Banner Together participants must be objects.");
    }

    const id = validateParticipantId(participant.id);

    if (participantIds.has(id)) {
      throw new Error(`Duplicate Banner Together participant ID: ${id}.`);
    }

    participantIds.add(id);

    return {
      id,
      label: validateParticipantLabel(participant.label),
    };
  });
}

export function normalizeBannerTogetherGroupParticipantIdentities(
  participants
) {
  return normalizeParticipantDescriptors(participants);
}

export function normalizeBannerTogetherGroupParticipants(participants) {
  const normalizedDescriptors = normalizeParticipantDescriptors(participants);

  return normalizedDescriptors.map((participant, index) => ({
    ...participant,
    lists: normalizeParticipantLists(participants[index].lists),
  }));
}

function normalizeLocalParticipantId(participants, localParticipantId) {
  const normalizedId = validateParticipantId(localParticipantId);

  if (!participants.some((participant) => participant.id === normalizedId)) {
    throw new Error(
      "The local Banner Together participant is not in this room."
    );
  }

  return normalizedId;
}

function normalizeStatusSelection(statuses, participantLabel) {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new Error(
      `Choose at least one status for Banner Together participant ${participantLabel}.`
    );
  }

  const selectedStatuses = new Set(
    statuses.map(normalizeBannerTogetherGroupStatus)
  );

  return BANNER_TOGETHER_GROUP_STATUSES.filter((status) =>
    selectedStatuses.has(status)
  );
}

export function normalizeBannerTogetherGroupClauses(participants, clauses) {
  const normalizedParticipants = normalizeParticipantDescriptors(participants);
  const participantIds = new Set(
    normalizedParticipants.map((participant) => participant.id)
  );

  if (!Array.isArray(clauses) || clauses.length === 0) {
    throw new Error("Choose at least one Banner Together comparison alternative.");
  }

  return clauses.map((clause) => {
    if (!clause || typeof clause !== "object" || Array.isArray(clause)) {
      throw new Error("Banner Together comparison alternatives must be objects.");
    }

    const statuses = clause.participantStatuses;

    if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) {
      throw new Error(
        "Each Banner Together alternative requires participant statuses."
      );
    }

    const statusIds = Object.keys(statuses);
    const unexpectedId = statusIds.find((id) => !participantIds.has(id));
    const missingParticipant = normalizedParticipants.find(
      (participant) => !Object.prototype.hasOwnProperty.call(statuses, participant.id)
    );

    if (unexpectedId) {
      throw new Error(
        `Unknown Banner Together participant in comparison: ${unexpectedId}.`
      );
    }

    if (missingParticipant || statusIds.length !== normalizedParticipants.length) {
      throw new Error(
        `Comparison alternative is missing participant ${
          missingParticipant?.label ?? "statuses"
        }.`
      );
    }

    return {
      participantStatuses: Object.fromEntries(
        normalizedParticipants.map((participant) => [
          participant.id,
          normalizeStatusSelection(
            statuses[participant.id],
            participant.label
          ),
        ])
      ),
    };
  });
}

function createParticipantStatuses(participants, getStatuses) {
  return {
    participantStatuses: Object.fromEntries(
      participants.map((participant) => [
        participant.id,
        [...getStatuses(participant)],
      ])
    ),
  };
}

function createPresetClauses(presetId, participants, localParticipantId) {
  switch (presetId) {
    case BANNER_TOGETHER_GROUP_PRESET_IDS.EVERYONE_TODO:
      return [createParticipantStatuses(participants, () => ["todo"])];
    case BANNER_TOGETHER_GROUP_PRESET_IDS.MY_TODO_OTHERS_UNLISTED:
      return [
        createParticipantStatuses(participants, (participant) =>
          participant.id === localParticipantId ? ["todo"] : ["unlisted"]
        ),
      ];
    case BANNER_TOGETHER_GROUP_PRESET_IDS.MY_TODO_NOBODY_ELSE_HIDDEN:
      return [
        createParticipantStatuses(participants, (participant) =>
          participant.id === localParticipantId
            ? ["todo"]
            : NOT_HIDDEN_STATUSES
        ),
      ];
    case BANNER_TOGETHER_GROUP_PRESET_IDS.AT_LEAST_TWO_TODO:
      return participants.flatMap((firstParticipant, firstIndex) =>
        participants.slice(firstIndex + 1).map((secondParticipant) =>
          createParticipantStatuses(participants, (participant) =>
            participant.id === firstParticipant.id ||
            participant.id === secondParticipant.id
              ? ["todo"]
              : ALL_STATUSES
          )
        )
      );
    default:
      throw new Error(`Unsupported Banner Together group preset: ${presetId}.`);
  }
}

export function getBannerTogetherGroupPresetClauses(
  presetId,
  participants,
  localParticipantId
) {
  const normalizedParticipants = normalizeParticipantDescriptors(participants);
  const normalizedLocalParticipantId = normalizeLocalParticipantId(
    normalizedParticipants,
    localParticipantId
  );

  return createPresetClauses(
    presetId,
    normalizedParticipants,
    normalizedLocalParticipantId
  );
}

export function getBannerTogetherGroupPresetOptions(
  participants,
  localParticipantId
) {
  return Object.values(BANNER_TOGETHER_GROUP_PRESET_IDS).map((presetId) => ({
    id: presetId,
    label: PRESET_LABELS[presetId],
    clauses: getBannerTogetherGroupPresetClauses(
      presetId,
      participants,
      localParticipantId
    ),
  }));
}

function serializeClauses(clauses) {
  return JSON.stringify(
    [...new Set(clauses.map((clause) => JSON.stringify(clause)))].sort()
  );
}

export function findBannerTogetherGroupPresetId({
  participants,
  localParticipantId,
  clauses,
}) {
  const normalizedClauses = normalizeBannerTogetherGroupClauses(
    participants,
    clauses
  );

  return (
    Object.values(BANNER_TOGETHER_GROUP_PRESET_IDS).find((presetId) =>
      serializeClauses(normalizedClauses) ===
      serializeClauses(
        normalizeBannerTogetherGroupClauses(
          participants,
          getBannerTogetherGroupPresetClauses(
            presetId,
            participants,
            localParticipantId
          )
        )
      )
    ) ?? null
  );
}

function createMembershipIndex(lists) {
  const index = new Map();

  Object.entries(lists).forEach(([status, bannerIds]) => {
    bannerIds.forEach((bannerId) => index.set(bannerId, status));
  });

  return index;
}

function mergeBannerMetadata(existingBanner, nextBanner) {
  const mergedBanner = { ...(existingBanner ?? {}) };

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

  return (
    titleA.localeCompare(titleB, undefined, { sensitivity: "base" }) ||
    resultA.id.localeCompare(resultB.id)
  );
}

export function evaluateBannerTogetherGroupComparison({
  catalogBanners,
  participants,
  localParticipantId,
  clauses,
}) {
  if (!Array.isArray(catalogBanners)) {
    throw new Error("Banner Together catalog must be an array.");
  }

  const normalizedParticipants = normalizeBannerTogetherGroupParticipants(
    participants
  );
  normalizeLocalParticipantId(normalizedParticipants, localParticipantId);
  const normalizedClauses = normalizeBannerTogetherGroupClauses(
    normalizedParticipants,
    clauses
  );
  const membershipIndexes = new Map(
    normalizedParticipants.map((participant) => [
      participant.id,
      createMembershipIndex(participant.lists),
    ])
  );
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

  membershipIndexes.forEach((membershipIndex) => {
    membershipIndex.forEach((_status, bannerId) => {
      if (!catalogById.has(bannerId)) {
        missingCatalogIds.add(bannerId);
      }
    });
  });

  const results = [...catalogById.entries()]
    .map(([bannerId, banner]) => {
      const participantStatuses = Object.fromEntries(
        normalizedParticipants.map((participant) => [
          participant.id,
          membershipIndexes.get(participant.id).get(bannerId) ?? "unlisted",
        ])
      );

      return { id: bannerId, banner, participantStatuses };
    })
    .filter((result) =>
      normalizedClauses.some((clause) =>
        normalizedParticipants.every((participant) =>
          clause.participantStatuses[participant.id].includes(
            result.participantStatuses[participant.id]
          )
        )
      )
    )
    .sort(compareResultTitles);

  return {
    participants: normalizedParticipants,
    clauses: normalizedClauses,
    results,
    missingCatalogCount: missingCatalogIds.size,
  };
}
