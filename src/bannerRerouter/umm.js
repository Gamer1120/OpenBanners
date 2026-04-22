export const PORTALS_PER_MISSION = 6;
export const DEFAULT_MISSION_COUNT = 12;
export const MINIMUM_MISSION_COUNT = 6;
export const LOOP_CLOSURE_MODE_STRICT = "strict";
export const LOOP_CLOSURE_MODE_PREFER = "prefer";
export const LOOP_CLOSURE_MODE_NO_LOOP = "no-loop";
export const LOOP_CLOSURE_MODE_ALLOW_OPEN = "allow-open";
export const DEFAULT_ROUTE_OPTIONS = Object.freeze({
  targetStyle: "similar",
  optimizeFor: "balanced",
  preferLoopClosure: true,
  loopClosureMode: LOOP_CLOSURE_MODE_PREFER,
  maxSingleHopMeters: 450,
  nearRouteCaptureMeters: 30,
  preserveImportedShapeBias: 0.5,
  minLoopDistanceMeters: null,
  maxLoopDistanceMeters: null,
});

function buildEmptyImportSummary() {
  return {
    importedMissionCount: 0,
    importedPortalCount: 0,
    uniquePortalCount: 0,
    activePortalCount: 0,
    duplicatePortalCount: 0,
    invalidPortalCount: 0,
    excludedPortalCount: 0,
  };
}

function normalizeTitle(value, fallback) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return fallback;
}

function toFiniteNumber(value) {
  const normalizedValue = Number(value);
  return Number.isFinite(normalizedValue) ? normalizedValue : null;
}

function toPositiveNumber(value) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return null;
  }

  return normalizedValue;
}

export function normalizeLoopClosureMode(value) {
  if (value === LOOP_CLOSURE_MODE_STRICT || value === LOOP_CLOSURE_MODE_NO_LOOP) {
    return value;
  }

  if (value === LOOP_CLOSURE_MODE_ALLOW_OPEN) {
    return LOOP_CLOSURE_MODE_NO_LOOP;
  }

  return LOOP_CLOSURE_MODE_PREFER;
}

export function normalizeRouteOptions(routeOptions = {}) {
  return {
    ...DEFAULT_ROUTE_OPTIONS,
    ...(routeOptions && typeof routeOptions === "object" ? routeOptions : {}),
    loopClosureMode: normalizeLoopClosureMode(routeOptions?.loopClosureMode),
    maxSingleHopMeters:
      toPositiveNumber(routeOptions?.maxSingleHopMeters) ??
      DEFAULT_ROUTE_OPTIONS.maxSingleHopMeters,
    nearRouteCaptureMeters:
      toPositiveNumber(routeOptions?.nearRouteCaptureMeters) ??
      DEFAULT_ROUTE_OPTIONS.nearRouteCaptureMeters,
    preserveImportedShapeBias:
      toFiniteNumber(routeOptions?.preserveImportedShapeBias) ??
      DEFAULT_ROUTE_OPTIONS.preserveImportedShapeBias,
    minLoopDistanceMeters: toPositiveNumber(routeOptions?.minLoopDistanceMeters),
    maxLoopDistanceMeters: toPositiveNumber(routeOptions?.maxLoopDistanceMeters),
  };
}

function getRichnessScore(portal) {
  let score = 0;

  if (portal.guid) {
    score += 4;
  }

  if (portal.imageUrl) {
    score += 2;
  }

  if (portal.description) {
    score += 1;
  }

  return score;
}

function mergePortals(existingPortal, nextPortal) {
  const existingScore = getRichnessScore(existingPortal);
  const nextScore = getRichnessScore(nextPortal);
  const preferredPortal =
    nextScore > existingScore ? nextPortal : existingPortal;
  const secondaryPortal =
    preferredPortal === existingPortal ? nextPortal : existingPortal;
  const earliestPortal =
    existingPortal.sourceOrderIndex <= nextPortal.sourceOrderIndex
      ? existingPortal
      : nextPortal;

  return {
    ...preferredPortal,
    portalKey: existingPortal.portalKey,
    guid: preferredPortal.guid || secondaryPortal.guid || null,
    imageUrl: preferredPortal.imageUrl || secondaryPortal.imageUrl || null,
    description:
      preferredPortal.description || secondaryPortal.description || "",
    title: preferredPortal.title || secondaryPortal.title || "Untitled portal",
    latitude: preferredPortal.latitude ?? secondaryPortal.latitude,
    longitude: preferredPortal.longitude ?? secondaryPortal.longitude,
    isImportedStartPoint:
      existingPortal.isImportedStartPoint || nextPortal.isImportedStartPoint,
    sourceMissionIndex: earliestPortal.sourceMissionIndex,
    sourceMissionTitle:
      earliestPortal.sourceMissionTitle || preferredPortal.sourceMissionTitle,
    sourceStepIndex: earliestPortal.sourceStepIndex,
    sourceOrderIndex: earliestPortal.sourceOrderIndex,
  };
}

function buildIdentityKeys(portal) {
  const keys = [];
  const roundedLatitude = portal.latitude.toFixed(6);
  const roundedLongitude = portal.longitude.toFixed(6);
  const normalizedTitle = portal.title.trim().toLowerCase();

  if (portal.guid) {
    keys.push(`guid:${portal.guid}`);
  }

  keys.push(`coord:${roundedLatitude}:${roundedLongitude}`);
  keys.push(`coord-title:${roundedLatitude}:${roundedLongitude}:${normalizedTitle}`);

  return keys;
}

function pickInitialMissionCount(rawValue, uniquePortalCount) {
  const importBasedMissionCount = Number(rawValue);
  const maxMissionCount = Math.floor(uniquePortalCount / PORTALS_PER_MISSION);
  const normalizedMaxMissionCount =
    maxMissionCount - (maxMissionCount % PORTALS_PER_MISSION);

  if (normalizedMaxMissionCount < MINIMUM_MISSION_COUNT) {
    return 0;
  }

  if (
    Number.isFinite(importBasedMissionCount) &&
    importBasedMissionCount >= MINIMUM_MISSION_COUNT &&
    importBasedMissionCount % PORTALS_PER_MISSION === 0 &&
    importBasedMissionCount <= normalizedMaxMissionCount
  ) {
    return importBasedMissionCount;
  }

  if (DEFAULT_MISSION_COUNT <= normalizedMaxMissionCount) {
    return DEFAULT_MISSION_COUNT;
  }

  return normalizedMaxMissionCount;
}

export function normalizeMissionCount(value, fallback = DEFAULT_MISSION_COUNT) {
  const numericValue = Number(value);

  if (
    Number.isFinite(numericValue) &&
    numericValue >= MINIMUM_MISSION_COUNT &&
    numericValue % PORTALS_PER_MISSION === 0
  ) {
    return numericValue;
  }

  return fallback;
}

export function countActivePortals(draft) {
  if (!draft) {
    return 0;
  }

  const portalPool = Array.isArray(draft.portalPool) ? draft.portalPool : [];
  const excludedPortalKeys = new Set(
    Array.isArray(draft.excludedPortalKeys)
      ? draft.excludedPortalKeys.filter((value) => typeof value === "string")
      : []
  );

  return portalPool.filter((portal) => !excludedPortalKeys.has(portal.portalKey))
    .length;
}

export function parseUmmMissionSet(text, fileName = "imported-banner.json") {
  const importSummary = buildEmptyImportSummary();
  let parsedMissionSet;

  try {
    parsedMissionSet = JSON.parse(text);
  } catch (error) {
    throw new Error(
      error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON."
    );
  }

  if (!parsedMissionSet || typeof parsedMissionSet !== "object") {
    throw new Error("The imported file must contain a JSON object.");
  }

  const importedMissions = Array.isArray(parsedMissionSet.missions)
    ? parsedMissionSet.missions
    : null;

  if (!importedMissions || importedMissions.length === 0) {
    throw new Error("The imported UMM file does not contain any missions.");
  }

  importSummary.importedMissionCount = importedMissions.length;

  const uniquePortals = [];
  const aliasToIndex = new Map();
  let traversalIndex = 0;

  importedMissions.forEach((mission, missionIndex) => {
    const missionTitle =
      typeof mission?.missionTitle === "string" ? mission.missionTitle.trim() : "";
    const missionPortals = Array.isArray(mission?.portals) ? mission.portals : [];

    missionPortals.forEach((portal, stepIndex) => {
      importSummary.importedPortalCount += 1;

      const latitude = toFiniteNumber(portal?.location?.latitude);
      const longitude = toFiniteNumber(portal?.location?.longitude);
      const title = normalizeTitle(
        portal?.title,
        `Portal ${missionIndex + 1}-${stepIndex + 1}`
      );

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        importSummary.invalidPortalCount += 1;
        traversalIndex += 1;
        return;
      }

      const normalizedPortal = {
        portalKey: `portal-${traversalIndex + 1}`,
        guid:
          typeof portal?.guid === "string" && portal.guid.trim()
            ? portal.guid.trim()
            : null,
        title,
        latitude,
        longitude,
        imageUrl:
          typeof portal?.imageUrl === "string" && portal.imageUrl.trim()
            ? portal.imageUrl.trim()
            : null,
        description:
          typeof portal?.description === "string" ? portal.description.trim() : "",
        isImportedStartPoint: Boolean(portal?.isStartPoint),
        sourceMissionIndex: missionIndex,
        sourceStepIndex: stepIndex,
        sourceMissionTitle: missionTitle || null,
        sourceOrderIndex: traversalIndex,
      };

      const identityKeys = buildIdentityKeys(normalizedPortal);
      const existingIndex = identityKeys.reduce((matchedIndex, identityKey) => {
        if (matchedIndex !== null) {
          return matchedIndex;
        }

        return aliasToIndex.has(identityKey) ? aliasToIndex.get(identityKey) : null;
      }, null);

      if (existingIndex !== null) {
        importSummary.duplicatePortalCount += 1;
        uniquePortals[existingIndex] = mergePortals(
          uniquePortals[existingIndex],
          normalizedPortal
        );
        buildIdentityKeys(uniquePortals[existingIndex]).forEach((identityKey) => {
          aliasToIndex.set(identityKey, existingIndex);
        });
        traversalIndex += 1;
        return;
      }

      const nextIndex = uniquePortals.length;
      uniquePortals.push(normalizedPortal);
      identityKeys.forEach((identityKey) => {
        aliasToIndex.set(identityKey, nextIndex);
      });
      traversalIndex += 1;
    });
  });

  const sortedPortals = uniquePortals.sort(
    (leftPortal, rightPortal) =>
      leftPortal.sourceOrderIndex - rightPortal.sourceOrderIndex
  );
  const initialMissionCount = pickInitialMissionCount(
    parsedMissionSet.plannedBannerLength ?? parsedMissionSet.missions.length,
    sortedPortals.length
  );

  if (sortedPortals.length === 0) {
    throw new Error("The imported UMM file does not contain any usable portals.");
  }

  if (initialMissionCount === 0) {
    throw new Error(
      "This banner does not contain enough unique portals to build a reroute with 6 missions."
    );
  }

  const initialStartPortal =
    sortedPortals.find((portal) => portal.isImportedStartPoint) ?? sortedPortals[0];

  importSummary.uniquePortalCount = sortedPortals.length;
  importSummary.activePortalCount = sortedPortals.length;

  return {
    source: {
      importType: "umm",
      fileName,
      fileFormatVersion: Number.isFinite(parsedMissionSet.fileFormatVersion)
        ? parsedMissionSet.fileFormatVersion
        : null,
      importedAt: Date.now(),
    },
    metadata: {
      title: normalizeTitle(
        parsedMissionSet.missionSetName,
        "Rerouted Banner"
      ),
      description:
        typeof parsedMissionSet.missionSetDescription === "string"
          ? parsedMissionSet.missionSetDescription
          : "",
      missionCount: initialMissionCount,
    },
    importedMissionSet: {
      missionSetName:
        typeof parsedMissionSet.missionSetName === "string"
          ? parsedMissionSet.missionSetName
          : null,
      missionSetDescription:
        typeof parsedMissionSet.missionSetDescription === "string"
          ? parsedMissionSet.missionSetDescription
          : null,
      titleFormat:
        typeof parsedMissionSet.titleFormat === "string"
          ? parsedMissionSet.titleFormat
          : null,
      plannedBannerLength: Number.isFinite(parsedMissionSet.plannedBannerLength)
        ? parsedMissionSet.plannedBannerLength
        : null,
      importedMissionCount: importedMissions.length,
    },
    portalPool: sortedPortals,
    importSummary,
    selectedStartPortalKey: initialStartPortal?.portalKey ?? null,
    selectedEndPortalKey: null,
    routeOptions: {
      ...normalizeRouteOptions(DEFAULT_ROUTE_OPTIONS),
    },
  };
}
