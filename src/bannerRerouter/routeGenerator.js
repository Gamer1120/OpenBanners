import {
  DEFAULT_ROUTE_OPTIONS,
  LOOP_CLOSURE_MODE_NO_LOOP,
  LOOP_CLOSURE_MODE_PREFER,
  LOOP_CLOSURE_MODE_STRICT,
  PORTALS_PER_MISSION,
  countActivePortals,
  normalizeMissionCount,
  normalizeRouteOptions,
} from "./umm";

const EARTH_RADIUS_METERS = 6371000;
const DEFAULT_MISSIONS = 12;
const BASE_TARGET_MIN_M = 4500;
const BASE_TARGET_MAX_M = 5500;
const BASE_HARD_MAX_TOTAL_M = 20000;
const NEARBY_PORTAL_M = 30;
const MAX_LEG_M = 450;
const SECTORS = 16;
const RING_RADIUS_MIN_M = 1000;
const RING_RADIUS_MAX_M = 2200;
const DENSITY_RADIUS_M = 80;
const MAX_TAIL_M = 250;
const MAX_BRIDGE_STEPS = 16;
const MIN_PROGRESS_M = 1;
const MAX_NEAR_INSERTIONS = 50;
const MAX_NEAR_SCAN = 800;
const MAX_TOTAL_INSERTS = 3000;
const MAX_EXTEND_TRIES = 3000;
const TOPK_BACKBONE_PICK = 3;
const RESTARTS = 5;
const ATTEMPTS = 3;
const HARD_BOUND_RESTARTS = 8;
const HARD_BOUND_ATTEMPTS = 5;
const LOOP_REPAIR_UNUSED_LIMIT = 24;
const LOOP_REPAIR_SWAP_LIMIT = 14;
const UNIQUE_SEARCH_STALE_BATCH_LIMIT = 3;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function dedupeRoundedNumbers(values, precision = 3) {
  const seenValues = new Set();
  const dedupedValues = [];

  values.forEach((value) => {
    if (!Number.isFinite(value)) {
      return;
    }

    const normalizedValue = Number(value.toFixed(precision));

    if (seenValues.has(normalizedValue)) {
      return;
    }

    seenValues.add(normalizedValue);
    dedupedValues.push(normalizedValue);
  });

  return dedupedValues;
}

function calculateDistanceMeters(portalA, portalB) {
  if (!portalA || !portalB) {
    return 0;
  }

  const latitudeDelta = toRadians(portalB.latitude - portalA.latitude);
  const longitudeDelta = toRadians(portalB.longitude - portalA.longitude);
  const latitudeA = toRadians(portalA.latitude);
  const latitudeB = toRadians(portalB.latitude);
  const haversineTerm =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);
  const centralAngle =
    2 * Math.atan2(Math.sqrt(haversineTerm), Math.sqrt(1 - haversineTerm));

  return EARTH_RADIUS_METERS * centralAngle;
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return "Unavailable";
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function isRouteGenerationDebugEnabled() {
  const search =
    typeof globalThis?.location?.search === "string"
      ? globalThis.location.search
      : "";

  return /(?:^|[?&])(?:openbanners-debug|rerouter-debug)=1(?:&|$)/.test(search);
}

function debugRouteGeneration(message, details = undefined) {
  if (!isRouteGenerationDebugEnabled()) {
    return;
  }

  if (details === undefined) {
    console.log("[Banner Rerouter]", message);
    return;
  }

  console.log("[Banner Rerouter]", message, details);
}

function createCandidateRejectionSummary() {
  return {
    totalRejectedCandidates: 0,
    counts: {},
  };
}

function recordCandidateRejection(
  summary,
  reasons,
  details = {},
  { logToConsole = false } = {}
) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return;
  }

  summary.totalRejectedCandidates += 1;
  reasons.forEach(({ code }) => {
    if (typeof code !== "string" || !code) {
      return;
    }

    summary.counts[code] = (summary.counts[code] ?? 0) + 1;
  });

  const rejectionMessages = reasons.map((reason) => reason.message);
  const rejectionMessage = `Rejected candidate route: ${rejectionMessages.join(
    " "
  )}`;

  if (logToConsole) {
    console.log("[Banner Rerouter]", rejectionMessage, {
      ...details,
      reasons: rejectionMessages,
    });
  }

  debugRouteGeneration(rejectionMessage, {
    ...details,
    reasons: rejectionMessages,
  });
}

function getCandidateRouteSignature(route) {
  if (!Array.isArray(route) || route.length === 0) {
    return null;
  }

  const portalKeys = route.map((portal) => coordKey(portal));

  if (portalKeys.some((portalKey) => typeof portalKey !== "string" || !portalKey)) {
    return null;
  }

  return portalKeys.join("|");
}

function buildRouteFileName(title) {
  const slug =
    typeof title === "string" && title.trim()
      ? title
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "rerouted-banner";

  return `${slug || "rerouted-banner"}.umm.json`;
}

function buildGeneratedTitleFormat(title, missionCount) {
  const paddingLength = Math.max(2, String(missionCount).length);

  return `${title} %0${paddingLength}d`;
}

function isUmmCompatibleTitleFormat(value) {
  return (
    typeof value === "string" &&
    value.includes("T") &&
    /N+/.test(value)
  );
}

function buildUmmTitleFormat(route, draft) {
  const missionCount = normalizeMissionCount(
    route?.metadata?.missionCount,
    route?.missions?.length ?? DEFAULT_MISSIONS
  );
  const defaultPadding = Math.max(2, String(missionCount).length);
  const importedTitleFormat = draft?.importedMissionSet?.titleFormat;
  const routeTitleFormat = route?.metadata?.titleFormat;

  if (isUmmCompatibleTitleFormat(importedTitleFormat)) {
    return importedTitleFormat;
  }

  if (isUmmCompatibleTitleFormat(routeTitleFormat)) {
    return routeTitleFormat;
  }

  return `T ${"N".repeat(defaultPadding)}-M`;
}

function formatMissionTitle(baseTitle, missionNumber, missionCount) {
  const paddingLength = Math.max(2, String(missionCount).length);

  return `${baseTitle} ${String(missionNumber).padStart(paddingLength, "0")}`;
}

function createRng(seedValue) {
  let seed = seedValue >>> 0;

  if (seed === 0) {
    seed = 0x6d2b79f5;
  }

  const next = () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range(minimum, maximum) {
      return minimum + next() * (maximum - minimum);
    },
    int(maximumExclusive) {
      return Math.floor(next() * maximumExclusive);
    },
    choice(values) {
      if (!Array.isArray(values) || values.length === 0) {
        return null;
      }

      return values[this.int(values.length)];
    },
  };
}

function getPortalKey(portal) {
  return portal?.portalKey ?? portal?.guid ?? null;
}

function stripPortal(portal, routeOrderIndex = null) {
  return {
    portalKey: portal.portalKey,
    guid: portal.guid ?? null,
    title: portal.title,
    latitude: portal.latitude,
    longitude: portal.longitude,
    imageUrl: portal.imageUrl ?? null,
    description: portal.description ?? "",
    isImportedStartPoint: Boolean(portal.isImportedStartPoint),
    sourceMissionIndex: portal.sourceMissionIndex ?? 0,
    sourceStepIndex: portal.sourceStepIndex ?? 0,
    sourceMissionTitle: portal.sourceMissionTitle ?? null,
    sourceOrderIndex: portal.sourceOrderIndex ?? 0,
    routeOrderIndex,
  };
}

function getRouteTargets(missionCount, routeOptions = DEFAULT_ROUTE_OPTIONS) {
  const scale = missionCount / DEFAULT_MISSIONS;
  const normalizedRouteOptions = normalizeRouteOptions(routeOptions);
  const exactPortalCount = missionCount * PORTALS_PER_MISSION;
  const segmentCount = Math.max(
    1,
    exactPortalCount - (routeUsesPathDistance(normalizedRouteOptions) ? 1 : 0)
  );
  const defaultMinMeters = BASE_TARGET_MIN_M * scale;
  const defaultMaxMeters = BASE_TARGET_MAX_M * scale;
  const customMinMeters = normalizedRouteOptions.minLoopDistanceMeters;
  const customMaxMeters = normalizedRouteOptions.maxLoopDistanceMeters;
  let targetMinMeters = customMinMeters ?? defaultMinMeters;
  let targetMaxMeters = customMaxMeters ?? defaultMaxMeters;
  let preferredTargetMinMeters = defaultMinMeters;
  let preferredTargetMaxMeters = defaultMaxMeters;

  if (customMinMeters !== null && customMaxMeters === null) {
    targetMaxMeters = Math.max(defaultMaxMeters, targetMinMeters);
  }

  if (customMaxMeters !== null && customMinMeters === null) {
    targetMinMeters = Math.min(defaultMinMeters, targetMaxMeters);
  }

  if (customMinMeters !== null) {
    preferredTargetMinMeters = Math.max(preferredTargetMinMeters, customMinMeters);
  }

  if (customMaxMeters !== null) {
    preferredTargetMaxMeters = Math.min(preferredTargetMaxMeters, customMaxMeters);
  }

  if (preferredTargetMinMeters > preferredTargetMaxMeters) {
    if (customMinMeters !== null && customMaxMeters !== null) {
      preferredTargetMinMeters = customMinMeters;
      preferredTargetMaxMeters = customMaxMeters;
    } else if (customMinMeters !== null) {
      preferredTargetMaxMeters = Math.max(defaultMaxMeters, customMinMeters);
    } else if (customMaxMeters !== null) {
      preferredTargetMinMeters = Math.min(defaultMinMeters, customMaxMeters);
    }
  }

  const naturalHardMaxMeters = Math.max(
    BASE_HARD_MAX_TOTAL_M,
    BASE_HARD_MAX_TOTAL_M * scale,
    preferredTargetMaxMeters + 2500,
    preferredTargetMaxMeters * 1.45
  );
  const hardMaxMeters = customMaxMeters ?? naturalHardMaxMeters;
  const generationMaxMeters = Math.min(hardMaxMeters, naturalHardMaxMeters);
  const requiresExpandedSearch =
    (customMinMeters !== null && customMinMeters > defaultMinMeters) ||
    (customMaxMeters !== null && customMaxMeters < naturalHardMaxMeters);
  const defaultTargetCenterMeters = (defaultMinMeters + defaultMaxMeters) / 2;
  const preferredTargetCenterMeters =
    (preferredTargetMinMeters + preferredTargetMaxMeters) / 2;
  const distanceStretchRatio = preferredTargetCenterMeters / Math.max(defaultTargetCenterMeters, 1);
  const effectiveTargetMinMeters = customMinMeters ?? defaultMinMeters;
  const defaultAverageHopMeters =
    defaultTargetCenterMeters / Math.max(segmentCount, 1);
  const preferredAverageHopMeters =
    preferredTargetCenterMeters / Math.max(segmentCount, 1);
  const minimumAverageHopMeters =
    targetMinMeters / Math.max(segmentCount, 1);
  const prefersExtendedDistance =
    preferredTargetMinMeters > defaultMaxMeters * 1.5 ||
    distanceStretchRatio > 1.8;
  const prefersLongHopSearch =
    minimumAverageHopMeters >=
      Math.max(220, normalizedRouteOptions.maxSingleHopMeters * 0.62) ||
    distanceStretchRatio > 3.6;

  return {
    exactPortalCount,
    segmentCount,
    defaultTargetMinMeters: defaultMinMeters,
    defaultTargetMaxMeters: defaultMaxMeters,
    defaultTargetCenterMeters,
    targetMinMeters,
    targetMaxMeters,
    preferredTargetMinMeters,
    preferredTargetMaxMeters,
    preferredTargetCenterMeters,
    hardMinMeters: customMinMeters,
    hasHardMinMeters: customMinMeters !== null,
    hardMaxMeters,
    hasHardMaxMeters: customMaxMeters !== null,
    generationMaxMeters,
    requiresExpandedSearch,
    distanceStretchRatio,
    effectiveTargetMinMeters,
    defaultAverageHopMeters,
    preferredAverageHopMeters,
    minimumAverageHopMeters,
    prefersExtendedDistance,
    prefersLongHopSearch,
  };
}

function getTailGapMeters(portals) {
  if (!Array.isArray(portals) || portals.length < 2) {
    return 0;
  }

  return calculateDistanceMeters(portals[portals.length - 1], portals[0]);
}

function getLoopClosureConfig(routeOptions = DEFAULT_ROUTE_OPTIONS) {
  const normalizedRouteOptions = normalizeRouteOptions(routeOptions);

  switch (normalizedRouteOptions.loopClosureMode) {
    case LOOP_CLOSURE_MODE_STRICT:
      return {
        mode: LOOP_CLOSURE_MODE_STRICT,
        preferredTailGapMeters: 120,
        acceptableTailGapMeters: 180,
        tailPenaltyWeight: 2.8,
        shouldExtendTail: true,
        includesReturnToStart: true,
      };
    case LOOP_CLOSURE_MODE_NO_LOOP:
      return {
        mode: LOOP_CLOSURE_MODE_NO_LOOP,
        preferredTailGapMeters: Number.POSITIVE_INFINITY,
        acceptableTailGapMeters: Number.POSITIVE_INFINITY,
        tailPenaltyWeight: 0,
        shouldExtendTail: false,
        includesReturnToStart: false,
      };
    default:
      return {
        mode: LOOP_CLOSURE_MODE_PREFER,
        preferredTailGapMeters: 250,
        acceptableTailGapMeters: 325,
        tailPenaltyWeight: 0.75,
        shouldExtendTail: true,
        includesReturnToStart: true,
      };
  }
}

function routeUsesPathDistance(routeOptions = DEFAULT_ROUTE_OPTIONS) {
  return getLoopClosureConfig(routeOptions).includesReturnToStart === false;
}

function getRouteDistanceMode(routeOptions = DEFAULT_ROUTE_OPTIONS) {
  return routeUsesPathDistance(routeOptions) ? "path" : "loop";
}

function getRouteDistanceModeLabel(routeOptions = DEFAULT_ROUTE_OPTIONS) {
  return routeUsesPathDistance(routeOptions) ? "Path" : "Loop";
}

function routeMatchesLoopClosure(portals, routeOptions = DEFAULT_ROUTE_OPTIONS) {
  const loopClosureConfig = getLoopClosureConfig(routeOptions);

  if (!loopClosureConfig.includesReturnToStart) {
    return true;
  }

  return getTailGapMeters(portals) <= loopClosureConfig.acceptableTailGapMeters;
}

function routeRequiresStrictLoopClosure(routeOptions = DEFAULT_ROUTE_OPTIONS) {
  return (
    getLoopClosureConfig(routeOptions).mode === LOOP_CLOSURE_MODE_STRICT
  );
}

function buildStrictLoopClosureErrorMessage(requiresHardDistanceBounds = false) {
  if (requiresHardDistanceBounds) {
    return "No reroute could satisfy the strict loop-closure requirement while staying within the hard minimum/maximum distance constraints.";
  }

  return "No reroute could satisfy the strict loop-closure requirement.";
}

function routeMatchesHardDistanceBounds(distanceMeters, targets) {
  if (
    targets.hasHardMinMeters &&
    Number.isFinite(targets.hardMinMeters) &&
    distanceMeters < targets.hardMinMeters
  ) {
    return false;
  }

  if (
    targets.hasHardMaxMeters &&
    Number.isFinite(targets.hardMaxMeters) &&
    distanceMeters > targets.hardMaxMeters
  ) {
    return false;
  }

  return true;
}

function pathLength(portals) {
  if (!Array.isArray(portals) || portals.length < 2) {
    return 0;
  }

  let totalDistanceMeters = 0;

  for (let index = 1; index < portals.length; index += 1) {
    totalDistanceMeters += calculateDistanceMeters(
      portals[index - 1],
      portals[index]
    );
  }

  return totalDistanceMeters;
}

function getRouteDistanceMeters(
  portals,
  routeOptions = DEFAULT_ROUTE_OPTIONS
) {
  return routeUsesPathDistance(routeOptions) ? pathLength(portals) : loopLength(portals);
}

function withLockedEndPortal(portals, endPortal = null) {
  if (!Array.isArray(portals)) {
    return [];
  }

  if (!endPortal) {
    return portals;
  }

  const endPortalKey = coordKey(endPortal);

  return [
    ...portals.filter((portal) => coordKey(portal) !== endPortalKey),
    endPortal,
  ];
}

function getProjectedRouteDistanceMeters(
  portals,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  endPortal = null
) {
  return getRouteDistanceMeters(withLockedEndPortal(portals, endPortal), routeOptions);
}

function getPreferredTargetWindow(targets) {
  return {
    minMeters: targets.preferredTargetMinMeters ?? targets.targetMinMeters,
    maxMeters: targets.preferredTargetMaxMeters ?? targets.targetMaxMeters,
  };
}

function getEffectiveDistanceTargetMinMeters(targets) {
  if (targets.hasHardMinMeters && Number.isFinite(targets.hardMinMeters)) {
    return targets.hardMinMeters;
  }

  if (Number.isFinite(targets.preferredTargetMinMeters)) {
    return targets.preferredTargetMinMeters;
  }

  return Number.isFinite(targets.targetMinMeters) ? targets.targetMinMeters : 0;
}

function estimateAppendDistanceGain(
  route,
  portal,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  endPortal = null
) {
  if (!Array.isArray(route) || route.length === 0 || !portal) {
    return 0;
  }

  const lastPortal = route[route.length - 1];

  if (routeUsesPathDistance(routeOptions)) {
    if (endPortal) {
      return (
        calculateDistanceMeters(lastPortal, portal) +
        calculateDistanceMeters(portal, endPortal) -
        calculateDistanceMeters(lastPortal, endPortal)
      );
    }

    return calculateDistanceMeters(lastPortal, portal);
  }

  const closurePortal = endPortal ?? route[0];

  return (
    calculateDistanceMeters(lastPortal, portal) +
    calculateDistanceMeters(portal, closurePortal) -
    calculateDistanceMeters(lastPortal, closurePortal)
  );
}

function computeDistancePressureState(
  route,
  exactPortalCount,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  endPortal = null
) {
  const currentDistanceMeters = getProjectedRouteDistanceMeters(
    route,
    routeOptions,
    endPortal
  );
  const remainingInsertions = Math.max(0, exactPortalCount - route.length);
  const exactSegmentCount = Math.max(
    1,
    exactPortalCount - (routeUsesPathDistance(routeOptions) ? 1 : 0)
  );
  const effectiveTargetMinMeters = getEffectiveDistanceTargetMinMeters(targets);
  const preferredTargetMinMeters = Number.isFinite(targets.preferredTargetMinMeters)
    ? targets.preferredTargetMinMeters
    : effectiveTargetMinMeters;
  const remainingDistanceMeters = Math.max(
    0,
    effectiveTargetMinMeters - currentDistanceMeters
  );
  const neededAverageMeters =
    remainingInsertions > 0 ? remainingDistanceMeters / remainingInsertions : 0;
  const preferredAverageMeters = preferredTargetMinMeters / exactSegmentCount;
  const targetHopMeters = Math.max(preferredAverageMeters, neededAverageMeters);

  return {
    currentDistanceMeters,
    remainingInsertions,
    remainingDistanceMeters,
    neededAverageMeters,
    preferredAverageMeters,
    targetHopMeters,
    isUnderPressure:
      remainingDistanceMeters > 0 &&
      neededAverageMeters > preferredAverageMeters * 0.92,
  };
}

function routeMatchesPreferredDistanceWindow(distanceMeters, targets) {
  const preferredTargetWindow = getPreferredTargetWindow(targets);

  return (
    distanceMeters >= preferredTargetWindow.minMeters &&
    distanceMeters <= preferredTargetWindow.maxMeters
  );
}

function describeCandidateRejectionReasons(
  distanceMeters,
  tailGapMeters,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS
) {
  const reasons = [];
  const loopClosureConfig = getLoopClosureConfig(routeOptions);
  const distanceModeLabel = getRouteDistanceModeLabel(routeOptions).toLowerCase();

  if (
    targets.hasHardMinMeters &&
    Number.isFinite(targets.hardMinMeters) &&
    distanceMeters < targets.hardMinMeters
  ) {
    reasons.push({
      code: "below-hard-min-distance",
      message: `${distanceModeLabel} distance ${formatDistance(
        distanceMeters
      )} is below the hard minimum ${formatDistance(targets.hardMinMeters)}.`,
    });
  }

  if (
    targets.hasHardMaxMeters &&
    Number.isFinite(targets.hardMaxMeters) &&
    distanceMeters > targets.hardMaxMeters
  ) {
    reasons.push({
      code: "above-hard-max-distance",
      message: `${distanceModeLabel} distance ${formatDistance(
        distanceMeters
      )} is above the hard maximum ${formatDistance(targets.hardMaxMeters)}.`,
    });
  }

  if (
    loopClosureConfig.mode === LOOP_CLOSURE_MODE_STRICT &&
    tailGapMeters > loopClosureConfig.acceptableTailGapMeters
  ) {
    reasons.push({
      code: "strict-loop-closure",
      message: `Tail gap ${formatDistance(
        tailGapMeters
      )} exceeds the strict loop-closure limit ${formatDistance(
        loopClosureConfig.acceptableTailGapMeters
      )}.`,
    });
  }

  return reasons;
}

function buildDistanceFocusedPortalPool(
  annotatedPortals,
  startPortal,
  exactPortalCount,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  requiredPortalKeys = [],
  endPortal = null
) {
  if (!Array.isArray(annotatedPortals) || annotatedPortals.length === 0) {
    return [];
  }

  if (
    !targets.prefersExtendedDistance ||
    annotatedPortals.length <= exactPortalCount * 5
  ) {
    return annotatedPortals;
  }

  const protectedPortalKeys = new Set(
    [
      coordKey(startPortal),
      coordKey(endPortal),
      ...requiredPortalKeys.filter(Boolean),
    ].filter(Boolean)
  );
  const protectedPortals = annotatedPortals.filter((portal) =>
    protectedPortalKeys.has(coordKey(portal))
  );
  const targetSubsetCount = Math.min(
    annotatedPortals.length,
    Math.max(
      exactPortalCount * 5,
      protectedPortals.length + Math.max(60, exactPortalCount * 2)
    )
  );

  if (protectedPortals.length >= targetSubsetCount) {
    return protectedPortals;
  }

  const exactSegmentCount = Math.max(
    1,
    exactPortalCount - (routeUsesPathDistance(routeOptions) ? 1 : 0)
  );
  const desiredHopMeters = clamp(
    getEffectiveDistanceTargetMinMeters(targets) / exactSegmentCount,
    120,
    MAX_LEG_M * 3.6
  );
  const rankedPortals = annotatedPortals
    .filter((portal) => !protectedPortalKeys.has(coordKey(portal)))
    .map((portal) => {
      const distanceFromStart = Math.hypot(portal.x ?? 0, portal.y ?? 0);
      const distanceFromEnd = endPortal
        ? Math.hypot(
            (portal.x ?? 0) - (endPortal.x ?? 0),
            (portal.y ?? 0) - (endPortal.y ?? 0)
          )
        : distanceFromStart;
      const corridorPenalty = endPortal
        ? segmentDistanceMeters(portal, startPortal, endPortal).distance
        : 0;
      const importedRangePenalty = endPortal
        ? getImportedOrderRangePenalty(portal, startPortal, endPortal)
        : 0;

      return {
        portal,
        score:
          distanceFromStart +
          0.28 * distanceFromEnd -
          16 * portal.density -
          0.12 * corridorPenalty -
          0.35 * importedRangePenalty,
      };
    })
    .sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score);
  let cellSize = clamp(desiredHopMeters * 0.42, 90, 340);
  let reducedCandidates = rankedPortals.map(({ portal }) => portal);

  while (cellSize >= 60) {
    const cellMap = new Map();

    rankedPortals.forEach((candidate) => {
      const portal = candidate.portal;
      const cellKey = `${Math.round((portal.x ?? 0) / cellSize)}:${Math.round(
        (portal.y ?? 0) / cellSize
      )}`;
      const currentCell = cellMap.get(cellKey) ?? [];

      currentCell.push(candidate);
      currentCell.sort(
        (leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score
      );

      if (currentCell.length > 2) {
        currentCell.length = 2;
      }

      cellMap.set(cellKey, currentCell);
    });

    reducedCandidates = Array.from(cellMap.values())
      .flat()
      .sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score)
      .map((candidate) => candidate.portal);

    if (protectedPortals.length + reducedCandidates.length >= targetSubsetCount) {
      break;
    }

    cellSize *= 0.78;
  }

  const selectedPortals = dedupeKeepFirst(protectedPortals);
  const selectedPortalKeys = new Set(selectedPortals.map(coordKey));
  const appendPortals = (portals) => {
    portals.forEach((portal) => {
      const portalKey = coordKey(portal);

      if (!portalKey || selectedPortalKeys.has(portalKey)) {
        return;
      }

      if (selectedPortals.length >= targetSubsetCount) {
        return;
      }

      selectedPortals.push(portal);
      selectedPortalKeys.add(portalKey);
    });
  };

  appendPortals(reducedCandidates);

  if (selectedPortals.length < targetSubsetCount) {
    appendPortals(rankedPortals.map((candidate) => candidate.portal));
  }

  return selectedPortals;
}

function buildSearchPlans(targets, requiresHardDistanceBounds) {
  const defaultPlan = {
    radiusScale: 1,
    maxLegScale: 1,
    nearScale: 1,
    sectorScale: 1,
    turnWeightScale: 1,
    progressWeightScale: 1,
    densityWeightScale: 1,
  };

  if (!requiresHardDistanceBounds) {
    return [defaultPlan];
  }

  const preferredTargetWindow = getPreferredTargetWindow(targets);
  const targetCenterMeters =
    (preferredTargetWindow.minMeters + preferredTargetWindow.maxMeters) / 2;
  const defaultCenterMeters =
    targets.defaultTargetCenterMeters ??
    (targets.defaultTargetMinMeters + targets.defaultTargetMaxMeters) / 2;
  const rawTargetScale = targetCenterMeters / Math.max(defaultCenterMeters, 1);
  const centerScale = clamp(
    rawTargetScale >= 1 ? Math.sqrt(rawTargetScale) : rawTargetScale,
    0.72,
    targets.prefersExtendedDistance ? 4.2 : 1.9
  );
  const radiusScales = dedupeRoundedNumbers([
    centerScale * 0.82,
    centerScale * 0.92,
    centerScale,
    centerScale * 1.08,
    centerScale * 1.18,
    ...(targets.prefersExtendedDistance
      ? [
          centerScale * 1.32,
          centerScale * 1.5,
          centerScale * 1.72,
        ]
      : []),
  ]);
  const searchPlans = [];

  radiusScales.forEach((radiusScale) => {
    const normalizedRadiusScale = clamp(
      radiusScale,
      0.72,
      targets.prefersExtendedDistance ? 4.5 : 1.7
    );
    const compactBias = normalizedRadiusScale < 1 ? 1 - normalizedRadiusScale : 0;
    const expandBias = normalizedRadiusScale > 1 ? normalizedRadiusScale - 1 : 0;
    const basePlan = {
      radiusScale: normalizedRadiusScale,
      maxLegScale: clamp(
        Math.sqrt(normalizedRadiusScale),
        0.82,
        targets.prefersExtendedDistance ? 2.1 : 1.38
      ),
      nearScale: clamp(
        1 + (normalizedRadiusScale - 1) * 0.25,
        targets.prefersExtendedDistance ? 0.55 : 0.82,
        1.22
      ),
      sectorScale: clamp(
        1 + (normalizedRadiusScale - 1) * 0.22,
        0.88,
        targets.prefersExtendedDistance ? 1.6 : 1.26
      ),
      turnWeightScale: clamp(
        1 + compactBias * 0.22 - expandBias * 0.08,
        targets.prefersExtendedDistance ? 0.62 : 0.84,
        1.24
      ),
      progressWeightScale: clamp(
        1 + compactBias * 0.18 - expandBias * 0.1,
        targets.prefersExtendedDistance ? 0.62 : 0.84,
        1.24
      ),
      densityWeightScale: clamp(
        1 + compactBias * 0.08 - expandBias * 0.16,
        targets.prefersExtendedDistance ? 0.4 : 0.74,
        1.18
      ),
    };
    const aggressivePlan = {
      radiusScale: clamp(
        normalizedRadiusScale * (normalizedRadiusScale >= 1 ? 1.08 : 0.95),
        0.72,
        targets.prefersExtendedDistance ? 4.8 : 1.78
      ),
      maxLegScale: clamp(
        basePlan.maxLegScale * (normalizedRadiusScale >= 1 ? 1.12 : 0.9),
        0.8,
        targets.prefersExtendedDistance ? 2.35 : 1.48
      ),
      nearScale: clamp(
        basePlan.nearScale * (normalizedRadiusScale >= 1 ? 0.8 : 1.08),
        targets.prefersExtendedDistance ? 0.45 : 0.8,
        1.28
      ),
      sectorScale: clamp(
        basePlan.sectorScale * (normalizedRadiusScale >= 1 ? 1.08 : 0.94),
        0.84,
        targets.prefersExtendedDistance ? 1.72 : 1.32
      ),
      turnWeightScale: clamp(
        basePlan.turnWeightScale * (normalizedRadiusScale >= 1 ? 0.72 : 1.08),
        targets.prefersExtendedDistance ? 0.5 : 0.8,
        1.32
      ),
      progressWeightScale: clamp(
        basePlan.progressWeightScale * (normalizedRadiusScale >= 1 ? 0.74 : 1.12),
        targets.prefersExtendedDistance ? 0.5 : 0.8,
        1.32
      ),
      densityWeightScale: clamp(
        basePlan.densityWeightScale * (normalizedRadiusScale >= 1 ? 0.58 : 1.1),
        targets.prefersExtendedDistance ? 0.28 : 0.68,
        1.26
      ),
    };

    searchPlans.push(basePlan, aggressivePlan);

    if (targets.prefersExtendedDistance) {
      searchPlans.push({
        radiusScale: clamp(normalizedRadiusScale * 1.12, 0.72, 5.1),
        maxLegScale: clamp(basePlan.maxLegScale * 1.18, 0.9, 2.55),
        nearScale: clamp(basePlan.nearScale * 0.66, 0.38, 1.05),
        sectorScale: clamp(basePlan.sectorScale * 1.14, 0.92, 1.9),
        turnWeightScale: clamp(basePlan.turnWeightScale * 0.58, 0.42, 1.18),
        progressWeightScale: clamp(basePlan.progressWeightScale * 0.62, 0.42, 1.18),
        densityWeightScale: clamp(basePlan.densityWeightScale * 0.4, 0.18, 1.1),
      });
    }
  });

  return searchPlans;
}

function coordKey(portal) {
  return getPortalKey(portal);
}

function bearingRadians(portalA, portalB) {
  const y =
    Math.sin(toRadians(portalB.longitude - portalA.longitude)) *
    Math.cos(toRadians(portalB.latitude));
  const x =
    Math.cos(toRadians(portalA.latitude)) *
      Math.sin(toRadians(portalB.latitude)) -
    Math.sin(toRadians(portalA.latitude)) *
      Math.cos(toRadians(portalB.latitude)) *
      Math.cos(toRadians(portalB.longitude - portalA.longitude));
  const angle = Math.atan2(y, x);

  return (angle + 2 * Math.PI) % (2 * Math.PI);
}

function localCoordinates(startPortal, portal) {
  const metersPerDegreeLongitude =
    111320 * Math.cos(toRadians(startPortal.latitude));
  const metersPerDegreeLatitude = 110540;

  return {
    x: (portal.longitude - startPortal.longitude) * metersPerDegreeLongitude,
    y: (portal.latitude - startPortal.latitude) * metersPerDegreeLatitude,
  };
}

function segmentDistanceMeters(point, segmentStart, segmentEnd) {
  const vectorX = segmentEnd.x - segmentStart.x;
  const vectorY = segmentEnd.y - segmentStart.y;
  const relativeX = point.x - segmentStart.x;
  const relativeY = point.y - segmentStart.y;
  const vectorLengthSquared = vectorX * vectorX + vectorY * vectorY;

  if (vectorLengthSquared === 0) {
    return {
      distance: Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y),
      t: 0,
    };
  }

  const t = clamp(
    (relativeX * vectorX + relativeY * vectorY) / vectorLengthSquared,
    0,
    1
  );
  const closestX = segmentStart.x + t * vectorX;
  const closestY = segmentStart.y + t * vectorY;

  return {
    distance: Math.hypot(point.x - closestX, point.y - closestY),
    t,
  };
}

function loopLength(portals) {
  if (!Array.isArray(portals) || portals.length < 2) {
    return 0;
  }

  return (
    pathLength(portals) +
    calculateDistanceMeters(
    portals[portals.length - 1],
    portals[0]
    )
  );
}

function turnPenaltyRadians(portals) {
  if (!Array.isArray(portals) || portals.length < 3) {
    return 0;
  }

  let totalPenalty = 0;

  for (let index = 1; index < portals.length - 1; index += 1) {
    const bearingIn = bearingRadians(portals[index - 1], portals[index]);
    const bearingOut = bearingRadians(portals[index], portals[index + 1]);
    const difference = Math.abs(
      ((bearingOut - bearingIn + Math.PI) % (2 * Math.PI)) - Math.PI
    );

    totalPenalty += difference;
  }

  return totalPenalty;
}

function computeDistanceFromTarget(distanceMeters, targets) {
  const preferredTargetWindow = getPreferredTargetWindow(targets);

  if (distanceMeters < preferredTargetWindow.minMeters) {
    return preferredTargetWindow.minMeters - distanceMeters;
  }

  if (distanceMeters > preferredTargetWindow.maxMeters) {
    return distanceMeters - preferredTargetWindow.maxMeters;
  }

  return 0;
}

function computeRouteScore(portals, targets, routeOptions = DEFAULT_ROUTE_OPTIONS) {
  const distanceMeters = getRouteDistanceMeters(portals, routeOptions);
  const distancePenalty = computeDistanceFromTarget(distanceMeters, targets);
  const loopClosureConfig = getLoopClosureConfig(routeOptions);
  const tailGapPenalty = Math.max(
    0,
    getTailGapMeters(portals) - loopClosureConfig.preferredTailGapMeters
  );

  return (
    0.45 * distanceMeters +
    420 *
      turnPenaltyRadians(
        loopClosureConfig.includesReturnToStart ? [...portals, portals[0]] : portals
      ) +
    0.95 * computeHopDistributionPenalty(portals, targets, routeOptions) +
    1.5 * distancePenalty +
    loopClosureConfig.tailPenaltyWeight * tailGapPenalty -
    28 * portals.length
  );
}

function getEndAnchorProjectionFraction(portal, endPortal) {
  if (
    !portal ||
    !endPortal ||
    !Number.isFinite(portal.x) ||
    !Number.isFinite(portal.y) ||
    !Number.isFinite(endPortal.x) ||
    !Number.isFinite(endPortal.y)
  ) {
    return 0;
  }

  const endLengthSquared = endPortal.x * endPortal.x + endPortal.y * endPortal.y;

  if (endLengthSquared <= 0) {
    return 0;
  }

  return (
    (portal.x * endPortal.x + portal.y * endPortal.y) / endLengthSquared
  );
}

function getEndAnchorOvershootPenalty(portal, endPortal) {
  if (!endPortal || !portal || coordKey(portal) === coordKey(endPortal)) {
    return 0;
  }

  const projectionFraction = getEndAnchorProjectionFraction(portal, endPortal);
  const endLengthMeters = Math.hypot(endPortal.x ?? 0, endPortal.y ?? 0);

  if (projectionFraction <= 1.02 || endLengthMeters <= 0) {
    return 0;
  }

  return (projectionFraction - 1.02) * endLengthMeters;
}

function getImportedOrderRangePenalty(portal, startPortal, endPortal) {
  if (
    !portal ||
    !startPortal ||
    !endPortal ||
    !Number.isFinite(portal.sourceOrderIndex) ||
    !Number.isFinite(startPortal.sourceOrderIndex) ||
    !Number.isFinite(endPortal.sourceOrderIndex)
  ) {
    return 0;
  }

  const lowerBound = Math.min(
    startPortal.sourceOrderIndex,
    endPortal.sourceOrderIndex
  );
  const upperBound = Math.max(
    startPortal.sourceOrderIndex,
    endPortal.sourceOrderIndex
  );

  if (portal.sourceOrderIndex < lowerBound) {
    return (lowerBound - portal.sourceOrderIndex) * 65;
  }

  if (portal.sourceOrderIndex > upperBound) {
    return (portal.sourceOrderIndex - upperBound) * 95;
  }

  return 0;
}

function computeEndAnchorPenalty(portals, endPortal) {
  if (!endPortal || !Array.isArray(portals) || portals.length === 0) {
    return 0;
  }

  const normalizedRoute = withLockedEndPortal(portals, endPortal);
  const startPortal = normalizedRoute[0] ?? null;
  const tailPortals = normalizedRoute.slice(
    Math.max(0, normalizedRoute.length - 7),
    -1
  );
  let previousRemainingDistanceMeters = Number.POSITIVE_INFINITY;
  let totalPenalty = 0;

  normalizedRoute.slice(0, -1).forEach((portal) => {
    totalPenalty += getEndAnchorOvershootPenalty(portal, endPortal);
    totalPenalty += getImportedOrderRangePenalty(portal, startPortal, endPortal);
  });

  tailPortals.forEach((portal) => {
    const remainingDistanceMeters = calculateDistanceMeters(portal, endPortal);

    if (
      Number.isFinite(previousRemainingDistanceMeters) &&
      remainingDistanceMeters > previousRemainingDistanceMeters + 20
    ) {
      totalPenalty += remainingDistanceMeters - previousRemainingDistanceMeters;
    }

    previousRemainingDistanceMeters = remainingDistanceMeters;
  });

  return totalPenalty;
}

function computeDirectionalBacktrackPenalty(portals, endPortal) {
  if (!endPortal || !Array.isArray(portals) || portals.length < 3) {
    return 0;
  }

  const normalizedRoute = withLockedEndPortal(portals, endPortal);
  let previousRemainingDistanceMeters = calculateDistanceMeters(
    normalizedRoute[0],
    endPortal
  );
  let penalty = 0;

  normalizedRoute.slice(1, -1).forEach((portal) => {
    const remainingDistanceMeters = calculateDistanceMeters(portal, endPortal);

    if (remainingDistanceMeters > previousRemainingDistanceMeters + 25) {
      penalty += remainingDistanceMeters - previousRemainingDistanceMeters;
    }

    previousRemainingDistanceMeters = remainingDistanceMeters;
  });

  return penalty;
}

function computeMaxHopMeters(portals) {
  if (!Array.isArray(portals) || portals.length < 2) {
    return 0;
  }

  let maxHopMeters = 0;

  for (let index = 1; index < portals.length; index += 1) {
    maxHopMeters = Math.max(
      maxHopMeters,
      calculateDistanceMeters(portals[index - 1], portals[index])
    );
  }

  return maxHopMeters;
}

function getRouteHopDistances(
  portals,
  routeOptions = DEFAULT_ROUTE_OPTIONS
) {
  if (!Array.isArray(portals) || portals.length < 2) {
    return [];
  }

  const hopDistances = portals.slice(1).map((portal, portalIndex) =>
    calculateDistanceMeters(portals[portalIndex], portal)
  );

  if (!routeUsesPathDistance(routeOptions) && portals.length > 1) {
    hopDistances.push(calculateDistanceMeters(portals[portals.length - 1], portals[0]));
  }

  return hopDistances;
}

function computeHopDistributionPenalty(
  portals,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS
) {
  const hopDistances = getRouteHopDistances(portals, routeOptions);

  if (hopDistances.length === 0) {
    return 0;
  }

  const meanHopMeters =
    hopDistances.reduce((sum, hopDistance) => sum + hopDistance, 0) /
    hopDistances.length;
  const targetHopMeters = Math.max(
    1,
    Number.isFinite(targets.minimumAverageHopMeters)
      ? targets.minimumAverageHopMeters
      : meanHopMeters
  );
  const variance =
    hopDistances.reduce(
      (sum, hopDistance) => sum + (hopDistance - meanHopMeters) ** 2,
      0
    ) / hopDistances.length;
  const standardDeviationMeters = Math.sqrt(variance);
  const oversizeThresholdMeters = Math.max(
    targetHopMeters * 2.4,
    meanHopMeters * 2.2,
    220
  );
  const oversizePenalty = hopDistances.reduce(
    (sum, hopDistance) =>
      sum + Math.max(0, hopDistance - oversizeThresholdMeters),
    0
  );
  let frontLoadPenalty = 0;
  let cumulativeDistanceMeters = 0;

  hopDistances.forEach((hopDistance, hopIndex) => {
    cumulativeDistanceMeters += hopDistance;
    const expectedDistanceMeters =
      ((hopIndex + 1) / hopDistances.length) *
      (meanHopMeters * hopDistances.length);
    const frontLoadAllowanceMeters = Math.max(targetHopMeters * 1.15, 220);

    if (cumulativeDistanceMeters > expectedDistanceMeters + frontLoadAllowanceMeters) {
      frontLoadPenalty +=
        cumulativeDistanceMeters -
        expectedDistanceMeters -
        frontLoadAllowanceMeters;
    }
  });

  return (
    1.45 * oversizePenalty +
    0.35 * standardDeviationMeters +
    0.08 * frontLoadPenalty
  );
}

function computeMissionChunkPenalty(portals) {
  if (!Array.isArray(portals) || portals.length < PORTALS_PER_MISSION) {
    return 0;
  }

  let penalty = 0;

  for (
    let startIndex = 0;
    startIndex + PORTALS_PER_MISSION <= portals.length;
    startIndex += PORTALS_PER_MISSION
  ) {
    const missionChunk = portals.slice(
      startIndex,
      startIndex + PORTALS_PER_MISSION
    );
    const missionPathMeters = pathLength(missionChunk);
    const missionEndpointDistanceMeters = calculateDistanceMeters(
      missionChunk[0],
      missionChunk[missionChunk.length - 1]
    );
    let missionBacktrackPenalty = 0;
    let previousRemainingDistanceMeters = missionEndpointDistanceMeters;

    missionChunk.slice(1, -1).forEach((portal) => {
      const remainingDistanceMeters = calculateDistanceMeters(
        portal,
        missionChunk[missionChunk.length - 1]
      );

      if (remainingDistanceMeters > previousRemainingDistanceMeters + 20) {
        missionBacktrackPenalty +=
          remainingDistanceMeters - previousRemainingDistanceMeters;
      }

      previousRemainingDistanceMeters = remainingDistanceMeters;
    });

    penalty +=
      0.75 * Math.max(0, missionPathMeters - missionEndpointDistanceMeters) +
      210 * turnPenaltyRadians(missionChunk) +
      0.55 * missionBacktrackPenalty;
  }

  return penalty;
}

function computeAnchorCorridorPenalty(portals, endPortal) {
  if (!endPortal || !Array.isArray(portals) || portals.length < 3) {
    return 0;
  }

  const normalizedRoute = withLockedEndPortal(portals, endPortal);
  const startPortal = normalizedRoute[0];
  const anchorLengthMeters = Math.max(
    calculateDistanceMeters(startPortal, endPortal),
    1
  );
  let penalty = 0;
  let previousProgress = 0;

  normalizedRoute.slice(1, -1).forEach((portal) => {
    const progress = getEndAnchorProjectionFraction(portal, endPortal);
    const lateralDistanceMeters = segmentDistanceMeters(
      portal,
      startPortal,
      endPortal
    ).distance;

    if (progress < previousProgress - 0.03) {
      penalty +=
        (previousProgress - progress - 0.03) * anchorLengthMeters * 3.4;
    }

    if (progress < -0.005) {
      penalty += (-0.005 - progress) * anchorLengthMeters * 12;
    }

    if (progress > 1.04) {
      penalty += (progress - 1.04) * anchorLengthMeters * 2.8;
    }

    penalty += 0.12 * lateralDistanceMeters;
    previousProgress = progress;
  });

  return penalty;
}

function computeProjectedRouteScore(
  portals,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  endPortal = null
) {
  const normalizedRoute = withLockedEndPortal(portals, endPortal);

  return (
    computeRouteScore(normalizedRoute, targets, routeOptions) +
    1.35 * computeEndAnchorPenalty(normalizedRoute, endPortal) +
    0.42 * computeDirectionalBacktrackPenalty(normalizedRoute, endPortal) +
    0.95 * computeAnchorCorridorPenalty(normalizedRoute, endPortal) +
    0.22 * computeMaxHopMeters(normalizedRoute) +
    180 * turnPenaltyRadians(normalizedRoute) +
    0.9 * computeMissionChunkPenalty(normalizedRoute)
  );
}

function prepareAnnotatedPortals(portals, startPortal) {
  const annotatedPortals = portals.map((portal) => {
    const { x, y } = localCoordinates(startPortal, portal);

    return {
      ...portal,
      x,
      y,
      density: 0,
    };
  });

  annotatedPortals.forEach((portal, portalIndex) => {
    let density = 0;

    annotatedPortals.forEach((candidatePortal, candidateIndex) => {
      if (candidateIndex === portalIndex) {
        return;
      }

      if (
        calculateDistanceMeters(portal, candidatePortal) <= DENSITY_RADIUS_M
      ) {
        density += 1;
      }
    });

    portal.density = density;
  });

  return annotatedPortals;
}

function dedupeKeepFirst(portals) {
  const seenPortalKeys = new Set();
  const dedupedPortals = [];

  portals.forEach((portal) => {
    const portalKey = coordKey(portal);

    if (!portalKey || seenPortalKeys.has(portalKey)) {
      return;
    }

    seenPortalKeys.add(portalKey);
    dedupedPortals.push(portal);
  });

  return dedupedPortals;
}

function buildUnusedPool(annotatedPortals, usedPortalKeys) {
  return annotatedPortals.filter(
    (portal) => !usedPortalKeys.has(coordKey(portal))
  );
}

function repairLoopClosure(
  route,
  annotatedPortals,
  startPortal,
  targets,
  requiredPortalKeys = [],
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  lockedTailPortalKey = null
) {
  if (!Array.isArray(route) || route.length < 2) {
    return route;
  }

  const loopClosureConfig = getLoopClosureConfig(routeOptions);

  if (!loopClosureConfig.includesReturnToStart) {
    return route;
  }

  const initialDistanceMeters = getRouteDistanceMeters(route, routeOptions);

  if (
    routeMatchesHardDistanceBounds(initialDistanceMeters, targets) &&
    routeMatchesLoopClosure(route, routeOptions)
  ) {
    return route;
  }

  const exactPortalCount = route.length;
  const protectedPortalKeys = new Set([
    coordKey(startPortal),
    lockedTailPortalKey,
    ...requiredPortalKeys.filter(Boolean),
  ]);
  const usedPortalKeys = new Set(route.map(coordKey));
  const unusedNearStart = buildUnusedPool(annotatedPortals, usedPortalKeys)
    .sort(
      (leftPortal, rightPortal) =>
        calculateDistanceMeters(startPortal, leftPortal) -
        calculateDistanceMeters(startPortal, rightPortal)
    )
    .slice(0, LOOP_REPAIR_UNUSED_LIMIT);
  const movableRouteIndexes = Array.from(
    { length: Math.max(0, route.length - 1) },
    (_value, index) => index + 1
  )
    .filter((routeIndex) => !protectedPortalKeys.has(coordKey(route[routeIndex])))
    .sort(
    (leftIndex, rightIndex) =>
      calculateDistanceMeters(startPortal, route[leftIndex]) -
      calculateDistanceMeters(startPortal, route[rightIndex])
  );
  const removableRouteIndexes = Array.from(
    { length: Math.max(0, route.length - 1) },
    (_value, index) => index + 1
  )
    .filter((routeIndex) => !protectedPortalKeys.has(coordKey(route[routeIndex])))
    .sort((leftIndex, rightIndex) => rightIndex - leftIndex)
    .slice(0, LOOP_REPAIR_SWAP_LIMIT);
  let bestClosedRoute = null;
  let bestClosedScore = Number.POSITIVE_INFINITY;
  let bestImprovedRoute = route;
  let bestImprovedScore = computeRouteScore(route, targets, routeOptions);
  let bestImprovedTailGap = getTailGapMeters(route);

  const considerCandidate = (candidateRoute) => {
    const normalizedRoute = dedupeKeepFirst(candidateRoute);

    if (normalizedRoute.length !== exactPortalCount) {
      return;
    }

    if (
      lockedTailPortalKey &&
      coordKey(normalizedRoute[normalizedRoute.length - 1]) !== lockedTailPortalKey
    ) {
      return;
    }

    const candidateDistanceMeters = getRouteDistanceMeters(
      normalizedRoute,
      routeOptions
    );

    if (!routeMatchesHardDistanceBounds(candidateDistanceMeters, targets)) {
      return;
    }

    const candidateTailGapMeters = getTailGapMeters(normalizedRoute);
    const candidateScore = computeRouteScore(
      normalizedRoute,
      targets,
      routeOptions
    );

    if (
      candidateTailGapMeters <= loopClosureConfig.acceptableTailGapMeters &&
      candidateScore < bestClosedScore
    ) {
      bestClosedRoute = normalizedRoute;
      bestClosedScore = candidateScore;
      return;
    }

    if (
      candidateTailGapMeters + 0.5 < bestImprovedTailGap ||
      (Math.abs(candidateTailGapMeters - bestImprovedTailGap) <= 0.5 &&
        candidateScore < bestImprovedScore)
    ) {
      bestImprovedRoute = normalizedRoute;
      bestImprovedScore = candidateScore;
      bestImprovedTailGap = candidateTailGapMeters;
    }
  };

  movableRouteIndexes.forEach((routeIndex) => {
    const candidateRoute = lockedTailPortalKey
      ? [
          ...route.slice(0, routeIndex),
          ...route.slice(routeIndex + 1, -1),
          route[routeIndex],
          route[route.length - 1],
        ]
      : [
          ...route.slice(0, routeIndex),
          ...route.slice(routeIndex + 1),
          route[routeIndex],
        ];

    considerCandidate(candidateRoute);
  });

  unusedNearStart.forEach((portal) => {
    removableRouteIndexes.forEach((routeIndex) => {
      const candidateRoute = lockedTailPortalKey
        ? [
            ...route.slice(0, routeIndex),
            ...route.slice(routeIndex + 1, -1),
            portal,
            route[route.length - 1],
          ]
        : [
            ...route.slice(0, routeIndex),
            ...route.slice(routeIndex + 1),
            portal,
          ];

      considerCandidate(candidateRoute);
    });
  });

  return bestClosedRoute ?? bestImprovedRoute;
}

function shuffle(values, rng) {
  const nextValues = values.slice();

  for (let index = nextValues.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.int(index + 1);
    const temp = nextValues[index];
    nextValues[index] = nextValues[swapIndex];
    nextValues[swapIndex] = temp;
  }

  return nextValues;
}

function buildBackboneSector(
  annotatedPortals,
  startPortal,
  startPortalKey,
  ringMinMeters,
  ringMaxMeters,
  sectorCount,
  rng
) {
  const adjustedMinMeters = ringMinMeters * rng.range(0.9, 1.1);
  const adjustedMaxMeters = ringMaxMeters * rng.range(0.9, 1.1);
  const sectorBins = Array.from({ length: sectorCount }, () => []);

  annotatedPortals.forEach((portal, portalIndex) => {
    if (portal.portalKey === startPortalKey) {
      return;
    }

    const distanceMeters = calculateDistanceMeters(startPortal, portal);

    if (distanceMeters < adjustedMinMeters || distanceMeters > adjustedMaxMeters) {
      return;
    }

    const angle = bearingRadians(startPortal, portal);
    const sectorIndex = Math.floor((angle / (2 * Math.PI)) * sectorCount) % sectorCount;
    sectorBins[sectorIndex].push(portalIndex);
  });

  const shuffledBins = sectorBins.map((portalIndexes) =>
    shuffle(portalIndexes, rng)
  );
  const sequence = [];
  const sequenceSeen = new Set();
  const startSector = rng.int(sectorCount);

  for (let sectorOffset = 0; sectorOffset < sectorCount; sectorOffset += 1) {
    const sectorIndex = (startSector + sectorOffset) % sectorCount;
    const sector = shuffledBins[sectorIndex];

    if (sector.length === 0) {
      continue;
    }

    const takeCount = rng.next() < 0.6 ? 1 : 2;

    sector.slice(0, takeCount).forEach((portalIndex) => {
      if (sequenceSeen.has(portalIndex)) {
        return;
      }

      sequenceSeen.add(portalIndex);
      sequence.push(portalIndex);
    });
  }

  return sequence;
}

function buildBackboneGreedy(
  annotatedPortals,
  startPortal,
  startPortalKey,
  ringMinMeters,
  ringMaxMeters,
  rng,
  {
    kPick = TOPK_BACKBONE_PICK,
    turnWeight = 430,
    progressWeight = 200,
    densityWeight = 40,
  } = {}
) {
  let candidateIndexes = annotatedPortals
    .map((portal, portalIndex) => ({ portal, portalIndex }))
    .filter(({ portal }) => portal.portalKey !== startPortalKey)
    .filter(({ portal }) => {
      const distanceMeters = calculateDistanceMeters(startPortal, portal);

      return (
        distanceMeters >= ringMinMeters * 0.8 &&
        distanceMeters <= ringMaxMeters * 1.1
      );
    })
    .map(({ portalIndex }) => portalIndex);

  if (candidateIndexes.length < 12) {
    candidateIndexes = annotatedPortals
      .map((portal, portalIndex) => ({ portal, portalIndex }))
      .filter(({ portal }) => portal.portalKey !== startPortalKey)
      .map(({ portalIndex }) => portalIndex);
  }

  const clockwise = rng.choice([true, false]);
  let currentPortal = startPortal;
  let currentBearing = rng.range(0, 2 * Math.PI);
  const usedIndexes = new Set();
  const sequence = [];
  const stepCount = Math.round(rng.range(14, 18));

  const scoreCandidate = (portalIndex) => {
    const portal = annotatedPortals[portalIndex];
    const distanceMeters = calculateDistanceMeters(currentPortal, portal);

    if (distanceMeters < 0.001) {
      return Number.POSITIVE_INFINITY;
    }

    const bearing = bearingRadians(currentPortal, portal);
    const turn =
      Math.abs(((bearing - currentBearing + Math.PI) % (2 * Math.PI)) - Math.PI);
    const currentAngle = bearingRadians(startPortal, currentPortal);
    const nextAngle = bearingRadians(startPortal, portal);
    const angularProgress = clockwise
      ? (nextAngle - currentAngle + 2 * Math.PI) % (2 * Math.PI)
      : (currentAngle - nextAngle + 2 * Math.PI) % (2 * Math.PI);
    const progressPenalty = angularProgress >= 0.05 ? 0 : 1;

    return (
      0.7 * distanceMeters +
      turnWeight * turn +
      progressWeight * progressPenalty -
      densityWeight * portal.density
    );
  };

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    const availableIndexes = candidateIndexes.filter(
      (portalIndex) => !usedIndexes.has(portalIndex)
    );

    if (availableIndexes.length === 0) {
      break;
    }

    let nearbyIndexes = availableIndexes.filter((portalIndex) => {
      const portal = annotatedPortals[portalIndex];
      const distanceMeters = calculateDistanceMeters(currentPortal, portal);

      return distanceMeters >= 80 && distanceMeters <= MAX_LEG_M * 2;
    });

    if (nearbyIndexes.length === 0) {
      nearbyIndexes = availableIndexes;
    }

    nearbyIndexes.sort(
      (leftIndex, rightIndex) =>
        scoreCandidate(leftIndex) - scoreCandidate(rightIndex)
    );
    const picks = nearbyIndexes.slice(0, Math.max(1, Math.min(kPick, nearbyIndexes.length)));
    const nextPortalIndex = rng.choice(picks);

    usedIndexes.add(nextPortalIndex);
    sequence.push(nextPortalIndex);
    currentBearing = bearingRadians(
      currentPortal,
      annotatedPortals[nextPortalIndex]
    );
    currentPortal = annotatedPortals[nextPortalIndex];
  }

  return sequence;
}

function buildBackboneAnchoredGreedy(
  annotatedPortals,
  startPortal,
  startPortalKey,
  endPortal,
  rng,
  {
    kPick = TOPK_BACKBONE_PICK,
    corridorWeight = 0.6,
    turnWeight = 240,
    headingWeight = 210,
    progressWeight = 1.35,
    densityWeight = 28,
    importOrderWeight = 0.22,
  } = {}
) {
  if (!endPortal) {
    return [];
  }

  const endPortalKey = coordKey(endPortal);
  const pathLengthMeters = Math.max(
    calculateDistanceMeters(startPortal, endPortal),
    1
  );
  const preferredStepCount = Math.round(rng.range(12, 18));
  const candidateIndexes = annotatedPortals
    .map((portal, portalIndex) => ({ portal, portalIndex }))
    .filter(
      ({ portal }) =>
        portal.portalKey !== startPortalKey && coordKey(portal) !== endPortalKey
    )
    .map(({ portalIndex }) => portalIndex);
  const usedIndexes = new Set();
  const sequence = [];
  let currentPortal = startPortal;
  let currentBearing = bearingRadians(startPortal, endPortal);

  for (let stepIndex = 0; stepIndex < preferredStepCount; stepIndex += 1) {
    const remainingDistanceToEndMeters = calculateDistanceMeters(
      currentPortal,
      endPortal
    );

    if (
      remainingDistanceToEndMeters <= MAX_LEG_M * 1.35 &&
      sequence.length >= 4
    ) {
      break;
    }

    let availableIndexes = candidateIndexes.filter(
      (portalIndex) => !usedIndexes.has(portalIndex)
    );

    if (availableIndexes.length === 0) {
      break;
    }

    let nearbyIndexes = availableIndexes.filter((portalIndex) => {
      const portal = annotatedPortals[portalIndex];
      const hopDistanceMeters = calculateDistanceMeters(currentPortal, portal);

      return hopDistanceMeters >= 40 && hopDistanceMeters <= MAX_LEG_M * 2.3;
    });

    if (nearbyIndexes.length < Math.max(5, kPick * 2)) {
      nearbyIndexes = availableIndexes.filter((portalIndex) => {
        const portal = annotatedPortals[portalIndex];
        const nextRemainingDistanceMeters = calculateDistanceMeters(
          portal,
          endPortal
        );

        return (
          nextRemainingDistanceMeters <
          remainingDistanceToEndMeters + Math.min(150, pathLengthMeters * 0.04)
        );
      });
    }

    if (nearbyIndexes.length === 0) {
      nearbyIndexes = availableIndexes;
    }

    const headingToEnd = bearingRadians(currentPortal, endPortal);

    const scoreCandidate = (portalIndex) => {
      const portal = annotatedPortals[portalIndex];
      const hopDistanceMeters = calculateDistanceMeters(currentPortal, portal);
      const nextRemainingDistanceMeters = calculateDistanceMeters(
        portal,
        endPortal
      );
      const progressMeters =
        remainingDistanceToEndMeters - nextRemainingDistanceMeters;
      const corridorDistanceMeters = segmentDistanceMeters(
        portal,
        currentPortal,
        endPortal
      ).distance;
      const heading = bearingRadians(currentPortal, portal);
      const turnFromCurrentBearing =
        Math.abs(((heading - currentBearing + Math.PI) % (2 * Math.PI)) - Math.PI);
      const headingTurn =
        Math.abs(((heading - headingToEnd + Math.PI) % (2 * Math.PI)) - Math.PI);
      const importOrderDelta =
        portal.sourceOrderIndex - currentPortal.sourceOrderIndex;
      const importOrderPenalty = importOrderDelta >= 0 ? 0 : -importOrderDelta;
      const overshootPenalty = getEndAnchorOvershootPenalty(portal, endPortal);
      const importedRangePenalty = getImportedOrderRangePenalty(
        portal,
        startPortal,
        endPortal
      );
      const backwardPenalty =
        progressMeters >= MIN_PROGRESS_M
          ? 0
          : Math.abs(progressMeters) * progressWeight * 2.6 + 120;

      return (
        0.82 * hopDistanceMeters +
        0.38 * nextRemainingDistanceMeters +
        corridorWeight * corridorDistanceMeters +
        turnWeight * turnFromCurrentBearing +
        headingWeight * headingTurn +
        1.4 * overshootPenalty +
        0.9 * importedRangePenalty +
        backwardPenalty +
        importOrderWeight * importOrderPenalty -
        densityWeight * portal.density -
        progressWeight * Math.max(0, progressMeters)
      );
    };

    nearbyIndexes.sort(
      (leftIndex, rightIndex) =>
        scoreCandidate(leftIndex) - scoreCandidate(rightIndex)
    );

    const picks = nearbyIndexes.slice(
      0,
      Math.max(1, Math.min(kPick, nearbyIndexes.length))
    );
    const nextPortalIndex = rng.choice(picks);

    usedIndexes.add(nextPortalIndex);
    sequence.push(nextPortalIndex);
    currentBearing = bearingRadians(currentPortal, annotatedPortals[nextPortalIndex]);
    currentPortal = annotatedPortals[nextPortalIndex];
  }

  return sequence;
}

function bridgeAndDensify(orderIndexes, annotatedPortals, startPortal, maxLegMeters, nearMeters) {
  if (!Array.isArray(orderIndexes) || orderIndexes.length === 0) {
    return [startPortal];
  }

  const route = [startPortal, ...orderIndexes.map((index) => annotatedPortals[index]), startPortal];
  const usedPortalKeys = new Set(route.map(coordKey));
  const pool = buildUnusedPool(annotatedPortals, usedPortalKeys);
  const densified = [route[0]];
  let totalInsertions = 0;
  const bboxPadding = nearMeters * 1.6;

  for (let legIndex = 0; legIndex < route.length - 1; legIndex += 1) {
    const portalA = route[legIndex];
    const portalB = route[legIndex + 1];
    const bridgePortals = [];
    let currentX = portalA.x;
    let currentY = portalA.y;
    let remainingDistanceMeters = Math.hypot(portalB.x - currentX, portalB.y - currentY);
    let bridgeSteps = 0;

    while (
      remainingDistanceMeters > maxLegMeters &&
      pool.length > 0 &&
      totalInsertions < MAX_TOTAL_INSERTS &&
      bridgeSteps < MAX_BRIDGE_STEPS
    ) {
      bridgeSteps += 1;

      const bridgeCandidates = pool.filter(
        (portal) =>
          Math.hypot(portal.x - currentX, portal.y - currentY) <= MAX_LEG_M * 1.25
      );

      if (bridgeCandidates.length === 0) {
        break;
      }

      bridgeCandidates.sort((leftPortal, rightPortal) => {
        const leftScore =
          0.7 * Math.hypot(leftPortal.x - currentX, leftPortal.y - currentY) +
          0.3 * Math.hypot(portalB.x - leftPortal.x, portalB.y - leftPortal.y);
        const rightScore =
          0.7 * Math.hypot(rightPortal.x - currentX, rightPortal.y - currentY) +
          0.3 * Math.hypot(portalB.x - rightPortal.x, portalB.y - rightPortal.y);

        return leftScore - rightScore;
      });

      const bestBridgePortal = bridgeCandidates[0];
      const newRemainingDistanceMeters = Math.hypot(
        portalB.x - bestBridgePortal.x,
        portalB.y - bestBridgePortal.y
      );

      if (remainingDistanceMeters - newRemainingDistanceMeters < MIN_PROGRESS_M) {
        break;
      }

      bridgePortals.push(bestBridgePortal);
      pool.splice(pool.indexOf(bestBridgePortal), 1);
      totalInsertions += 1;
      currentX = bestBridgePortal.x;
      currentY = bestBridgePortal.y;
      remainingDistanceMeters = newRemainingDistanceMeters;
    }

    const sublegs = [portalA, ...bridgePortals, portalB];

    for (let sublegIndex = 0; sublegIndex < sublegs.length - 1; sublegIndex += 1) {
      if (totalInsertions >= MAX_TOTAL_INSERTS) {
        break;
      }

      const sublegStart = sublegs[sublegIndex];
      const sublegEnd = sublegs[sublegIndex + 1];
      const minX = Math.min(sublegStart.x, sublegEnd.x) - bboxPadding;
      const maxX = Math.max(sublegStart.x, sublegEnd.x) + bboxPadding;
      const minY = Math.min(sublegStart.y, sublegEnd.y) - bboxPadding;
      const maxY = Math.max(sublegStart.y, sublegEnd.y) + bboxPadding;
      const midpointX = (sublegStart.x + sublegEnd.x) / 2;
      const midpointY = (sublegStart.y + sublegEnd.y) / 2;
      const candidates = pool
        .filter(
          (portal) =>
            portal.x >= minX &&
            portal.x <= maxX &&
            portal.y >= minY &&
            portal.y <= maxY
        )
        .sort(
          (leftPortal, rightPortal) =>
            (leftPortal.x - midpointX) ** 2 +
              (leftPortal.y - midpointY) ** 2 -
            ((rightPortal.x - midpointX) ** 2 +
              (rightPortal.y - midpointY) ** 2)
        )
        .slice(0, MAX_NEAR_SCAN);
      const nearCandidates = [];

      candidates.forEach((portal) => {
        if (nearCandidates.length >= MAX_NEAR_INSERTIONS) {
          return;
        }

        const segmentDistance = segmentDistanceMeters(
          portal,
          sublegStart,
          sublegEnd
        );

        if (segmentDistance.distance <= nearMeters) {
          nearCandidates.push({ portal, t: segmentDistance.t });
        }
      });

      nearCandidates
        .sort((leftCandidate, rightCandidate) => leftCandidate.t - rightCandidate.t)
        .forEach(({ portal }) => {
          densified.push(portal);
          pool.splice(pool.indexOf(portal), 1);
          totalInsertions += 1;
        });

      densified.push(sublegEnd);
    }
  }

  const cleanedRoute = dedupeKeepFirst(densified);

  if (
    cleanedRoute.length > 1 &&
    coordKey(cleanedRoute[cleanedRoute.length - 1]) === coordKey(startPortal)
  ) {
    cleanedRoute.pop();
  }

  return cleanedRoute;
}

function bridgeAndDensifyAnchored(
  orderIndexes,
  annotatedPortals,
  startPortal,
  endPortal,
  maxLegMeters,
  nearMeters
) {
  if (!endPortal) {
    return bridgeAndDensify(
      orderIndexes,
      annotatedPortals,
      startPortal,
      maxLegMeters,
      nearMeters
    );
  }

  const route = [
    startPortal,
    ...orderIndexes.map((index) => annotatedPortals[index]),
    endPortal,
  ];
  const usedPortalKeys = new Set(route.map(coordKey));
  const pool = buildUnusedPool(annotatedPortals, usedPortalKeys);
  const densified = [route[0]];
  let totalInsertions = 0;
  const bboxPadding = nearMeters * 1.6;

  for (let legIndex = 0; legIndex < route.length - 1; legIndex += 1) {
    const portalA = route[legIndex];
    const portalB = route[legIndex + 1];
    const bridgePortals = [];
    let currentX = portalA.x;
    let currentY = portalA.y;
    let previousBridgePortal = portalA;
    let remainingDistanceMeters = Math.hypot(
      portalB.x - currentX,
      portalB.y - currentY
    );
    let bridgeSteps = 0;

    while (
      remainingDistanceMeters > maxLegMeters &&
      pool.length > 0 &&
      totalInsertions < MAX_TOTAL_INSERTS &&
      bridgeSteps < MAX_BRIDGE_STEPS
    ) {
      bridgeSteps += 1;

      const bridgeCandidates = pool.filter(
        (portal) =>
          Math.hypot(portal.x - currentX, portal.y - currentY) <= MAX_LEG_M * 1.35
      );

      if (bridgeCandidates.length === 0) {
        break;
      }

      bridgeCandidates.sort((leftPortal, rightPortal) => {
        const desiredBearing = bearingRadians(previousBridgePortal, portalB);
        const leftBearing = bearingRadians(previousBridgePortal, leftPortal);
        const rightBearing = bearingRadians(previousBridgePortal, rightPortal);
        const leftTurnPenalty = Math.abs(
          ((leftBearing - desiredBearing + Math.PI) % (2 * Math.PI)) - Math.PI
        );
        const rightTurnPenalty = Math.abs(
          ((rightBearing - desiredBearing + Math.PI) % (2 * Math.PI)) - Math.PI
        );
        const leftRemainingMeters = Math.hypot(
          portalB.x - leftPortal.x,
          portalB.y - leftPortal.y
        );
        const rightRemainingMeters = Math.hypot(
          portalB.x - rightPortal.x,
          portalB.y - rightPortal.y
        );
        const leftScore =
          0.72 * Math.hypot(leftPortal.x - currentX, leftPortal.y - currentY) +
          0.28 * leftRemainingMeters +
          180 * leftTurnPenalty;
        const rightScore =
          0.72 * Math.hypot(rightPortal.x - currentX, rightPortal.y - currentY) +
          0.28 * rightRemainingMeters +
          180 * rightTurnPenalty;

        return leftScore - rightScore;
      });

      const bestBridgePortal = bridgeCandidates[0];
      const newRemainingDistanceMeters = Math.hypot(
        portalB.x - bestBridgePortal.x,
        portalB.y - bestBridgePortal.y
      );

      if (remainingDistanceMeters - newRemainingDistanceMeters < MIN_PROGRESS_M) {
        break;
      }

      bridgePortals.push(bestBridgePortal);
      pool.splice(pool.indexOf(bestBridgePortal), 1);
      totalInsertions += 1;
      currentX = bestBridgePortal.x;
      currentY = bestBridgePortal.y;
      previousBridgePortal = bestBridgePortal;
      remainingDistanceMeters = newRemainingDistanceMeters;
    }

    const sublegs = [portalA, ...bridgePortals, portalB];

    for (let sublegIndex = 0; sublegIndex < sublegs.length - 1; sublegIndex += 1) {
      if (totalInsertions >= MAX_TOTAL_INSERTS) {
        break;
      }

      const sublegStart = sublegs[sublegIndex];
      const sublegEnd = sublegs[sublegIndex + 1];
      const minX = Math.min(sublegStart.x, sublegEnd.x) - bboxPadding;
      const maxX = Math.max(sublegStart.x, sublegEnd.x) + bboxPadding;
      const minY = Math.min(sublegStart.y, sublegEnd.y) - bboxPadding;
      const maxY = Math.max(sublegStart.y, sublegEnd.y) + bboxPadding;
      const midpointX = (sublegStart.x + sublegEnd.x) / 2;
      const midpointY = (sublegStart.y + sublegEnd.y) / 2;
      const candidates = pool
        .filter(
          (portal) =>
            portal.x >= minX &&
            portal.x <= maxX &&
            portal.y >= minY &&
            portal.y <= maxY
        )
        .sort(
          (leftPortal, rightPortal) =>
            (leftPortal.x - midpointX) ** 2 +
              (leftPortal.y - midpointY) ** 2 -
            ((rightPortal.x - midpointX) ** 2 +
              (rightPortal.y - midpointY) ** 2)
        )
        .slice(0, MAX_NEAR_SCAN);
      const nearCandidates = [];

      candidates.forEach((portal) => {
        if (nearCandidates.length >= MAX_NEAR_INSERTIONS) {
          return;
        }

        const segmentDistance = segmentDistanceMeters(
          portal,
          sublegStart,
          sublegEnd
        );

        if (segmentDistance.distance <= nearMeters) {
          nearCandidates.push({ portal, t: segmentDistance.t });
        }
      });

      nearCandidates
        .sort((leftCandidate, rightCandidate) => leftCandidate.t - rightCandidate.t)
        .forEach(({ portal }) => {
          densified.push(portal);
          pool.splice(pool.indexOf(portal), 1);
          totalInsertions += 1;
        });

      densified.push(sublegEnd);
    }
  }

  return dedupeKeepFirst(densified);
}

function augmentWithUnusedNearRoute(
  route,
  annotatedPortals,
  extraNearMeters,
  addLimit
) {
  if (!Array.isArray(route) || route.length === 0 || addLimit <= 0) {
    return route;
  }

  const usedPortalKeys = new Set(route.map(coordKey));
  const pool = buildUnusedPool(annotatedPortals, usedPortalKeys);
  const nextRoute = [route[0]];
  const bboxPadding = extraNearMeters * 1.6;
  let addedCount = 0;

  for (let legIndex = 0; legIndex < route.length - 1; legIndex += 1) {
    const portalA = route[legIndex];
    const portalB = route[legIndex + 1];
    const minX = Math.min(portalA.x, portalB.x) - bboxPadding;
    const maxX = Math.max(portalA.x, portalB.x) + bboxPadding;
    const minY = Math.min(portalA.y, portalB.y) - bboxPadding;
    const maxY = Math.max(portalA.y, portalB.y) + bboxPadding;
    const midpointX = (portalA.x + portalB.x) / 2;
    const midpointY = (portalA.y + portalB.y) / 2;
    const candidates = pool
      .filter(
        (portal) =>
          portal.x >= minX &&
          portal.x <= maxX &&
          portal.y >= minY &&
          portal.y <= maxY
      )
      .sort(
        (leftPortal, rightPortal) =>
          (leftPortal.x - midpointX) ** 2 +
            (leftPortal.y - midpointY) ** 2 -
          ((rightPortal.x - midpointX) ** 2 +
            (rightPortal.y - midpointY) ** 2)
      )
      .slice(0, MAX_NEAR_SCAN);
    const nearbyPortals = [];

    candidates.forEach((portal) => {
      if (addedCount >= addLimit) {
        return;
      }

      const segmentDistance = segmentDistanceMeters(portal, portalA, portalB);

      if (segmentDistance.distance <= extraNearMeters) {
        nearbyPortals.push({ portal, t: segmentDistance.t });
      }
    });

    nearbyPortals
      .sort((leftCandidate, rightCandidate) => leftCandidate.t - rightCandidate.t)
      .forEach(({ portal }) => {
        if (addedCount >= addLimit) {
          return;
        }

        nextRoute.push(portal);
        pool.splice(pool.indexOf(portal), 1);
        addedCount += 1;
      });

    nextRoute.push(portalB);
  }

  return dedupeKeepFirst(nextRoute);
}

function extendTailTowardsStart(
  route,
  annotatedPortals,
  startPortal,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  tailTargetPortal = startPortal,
  endPortal = null
) {
  if (!Array.isArray(route) || route.length === 0) {
    return route;
  }

  const loopClosureConfig = getLoopClosureConfig(routeOptions);

  if (!loopClosureConfig.shouldExtendTail) {
    return route;
  }

  const usedPortalKeys = new Set(route.map(coordKey));
  const pool = buildUnusedPool(annotatedPortals, usedPortalKeys);
  const maxTotalMeters = Math.min(
    targets.generationMaxMeters,
    Math.max(
      BASE_TARGET_MAX_M + 1500,
      getPreferredTargetWindow(targets).maxMeters + 1500
    )
  );

  while (pool.length > 0) {
    const lastPortal = route[route.length - 1];
    const tailDistanceMeters = calculateDistanceMeters(lastPortal, tailTargetPortal);

    if (
      tailDistanceMeters <=
        Math.min(
        Math.max(MAX_TAIL_M, loopClosureConfig.preferredTailGapMeters),
          loopClosureConfig.acceptableTailGapMeters
        ) ||
      getProjectedRouteDistanceMeters(route, routeOptions, endPortal) >=
        maxTotalMeters
    ) {
      break;
    }

    const viablePortals = pool.filter((portal) => {
      const stepDistanceMeters = Math.hypot(portal.x - lastPortal.x, portal.y - lastPortal.y);
      const nextTailDistanceMeters = calculateDistanceMeters(portal, tailTargetPortal);

      return (
        stepDistanceMeters <= MAX_LEG_M * 1.6 &&
        tailDistanceMeters - nextTailDistanceMeters >= MIN_PROGRESS_M &&
        getProjectedRouteDistanceMeters([...route, portal], routeOptions, endPortal) <=
          maxTotalMeters
      );
    });

    if (viablePortals.length === 0) {
      break;
    }

    viablePortals.sort((leftPortal, rightPortal) => {
      const leftScore =
        0.8 * Math.hypot(leftPortal.x - lastPortal.x, leftPortal.y - lastPortal.y) +
        0.4 * calculateDistanceMeters(leftPortal, tailTargetPortal) +
        1.2 * getEndAnchorOvershootPenalty(leftPortal, endPortal);
      const rightScore =
        0.8 * Math.hypot(rightPortal.x - lastPortal.x, rightPortal.y - lastPortal.y) +
        0.4 * calculateDistanceMeters(rightPortal, tailTargetPortal) +
        1.2 * getEndAnchorOvershootPenalty(rightPortal, endPortal);

      return leftScore - rightScore;
    });

    const nextPortal = viablePortals[0];

    route.push(nextPortal);
    pool.splice(pool.indexOf(nextPortal), 1);
  }

  return route;
}

function fillWithUnusedGreedy(
  route,
  annotatedPortals,
  startPortal,
  exactCount,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  tailTargetPortal = startPortal,
  endPortal = null
) {
  if (!Array.isArray(route) || route.length === 0) {
    return route;
  }

  const usedPortalKeys = new Set(route.map(coordKey));
  const pool = buildUnusedPool(annotatedPortals, usedPortalKeys);
  const maxTotalMeters = Math.min(
    targets.generationMaxMeters,
    Math.max(
      BASE_TARGET_MAX_M + 2500,
      getPreferredTargetWindow(targets).maxMeters + 2500
    )
  );
  let guardCount = 0;
  const prefersExtendedDistance = Boolean(targets.prefersExtendedDistance);
  const segmentCountForTarget = Math.max(
    1,
    exactCount - (routeUsesPathDistance(routeOptions) ? 1 : 0)
  );
  const preferredHopMeters = clamp(
    (targets.preferredTargetMinMeters ?? targets.targetMinMeters) /
      Math.max(segmentCountForTarget, 1),
    MAX_LEG_M * 0.75,
    MAX_LEG_M * 2.4
  );

  while (route.length < exactCount && pool.length > 0 && guardCount < MAX_EXTEND_TRIES) {
    guardCount += 1;
    const lastPortal = route[route.length - 1];
    const distancePressure = computeDistancePressureState(
      route,
      exactCount,
      targets,
      routeOptions,
      endPortal
    );
    const targetGainMeters = clamp(
      Math.max(preferredHopMeters, distancePressure.targetHopMeters),
      MAX_LEG_M * 0.75,
      MAX_LEG_M * (prefersExtendedDistance ? 4.4 : 2.4)
    );
    const hopLimitMeters = clamp(
      Math.max(
        MAX_LEG_M * (prefersExtendedDistance ? 1.9 : 1.45),
        targetGainMeters * 1.9
      ),
      MAX_LEG_M * 1.1,
      MAX_LEG_M * (prefersExtendedDistance ? 4.8 : 2.6)
    );
    let candidates = pool.filter(
      (portal) =>
        Math.hypot(portal.x - lastPortal.x, portal.y - lastPortal.y) <=
        hopLimitMeters
    );

    if (candidates.length === 0) {
      candidates = pool.filter(
        (portal) =>
          Math.hypot(portal.x - lastPortal.x, portal.y - lastPortal.y) <=
          clamp(
            Math.max(
              MAX_LEG_M * (prefersExtendedDistance ? 2.6 : 2),
              targetGainMeters * 2.4
            ),
            MAX_LEG_M * 1.2,
            MAX_LEG_M * (prefersExtendedDistance ? 5.4 : 2.8)
          )
      );
    }

    if (candidates.length === 0) {
      break;
    }

    if (prefersExtendedDistance && distancePressure.isUnderPressure) {
      const longGainCandidates = candidates.filter(
        (portal) =>
          estimateAppendDistanceGain(route, portal, routeOptions, endPortal) >=
          targetGainMeters * 0.68
      );

      if (longGainCandidates.length > 0) {
        candidates = longGainCandidates;
      }
    }

    candidates.sort((leftPortal, rightPortal) => {
      const leftHopMeters = Math.hypot(
        leftPortal.x - lastPortal.x,
        leftPortal.y - lastPortal.y
      );
      const rightHopMeters = Math.hypot(
        rightPortal.x - lastPortal.x,
        rightPortal.y - lastPortal.y
      );
      const leftTailDistance = calculateDistanceMeters(leftPortal, tailTargetPortal);
      const rightTailDistance = calculateDistanceMeters(rightPortal, tailTargetPortal);
      const leftProgressGain = Math.max(
        0,
        calculateDistanceMeters(lastPortal, tailTargetPortal) - leftTailDistance
      );
      const rightProgressGain = Math.max(
        0,
        calculateDistanceMeters(lastPortal, tailTargetPortal) - rightTailDistance
      );
      const leftAppendGain = estimateAppendDistanceGain(
        route,
        leftPortal,
        routeOptions,
        endPortal
      );
      const rightAppendGain = estimateAppendDistanceGain(
        route,
        rightPortal,
        routeOptions,
        endPortal
      );
      const leftScore = prefersExtendedDistance
        ? 0.22 * Math.abs(leftAppendGain - targetGainMeters) +
          0.34 * Math.max(0, targetGainMeters - leftAppendGain) -
          0.58 * leftAppendGain -
          0.16 * leftTailDistance -
          0.08 * leftProgressGain +
          1.15 * getEndAnchorOvershootPenalty(leftPortal, endPortal) -
          0.08 * leftPortal.density
        : 0.8 * leftHopMeters +
          0.35 * leftTailDistance -
          0.25 * leftProgressGain +
          1.15 * getEndAnchorOvershootPenalty(leftPortal, endPortal) -
          0.05 * leftPortal.density;
      const rightScore = prefersExtendedDistance
        ? 0.22 * Math.abs(rightAppendGain - targetGainMeters) +
          0.34 * Math.max(0, targetGainMeters - rightAppendGain) -
          0.58 * rightAppendGain -
          0.16 * rightTailDistance -
          0.08 * rightProgressGain +
          1.15 * getEndAnchorOvershootPenalty(rightPortal, endPortal) -
          0.08 * rightPortal.density
        : 0.8 * rightHopMeters +
          0.35 * rightTailDistance -
          0.25 * rightProgressGain +
          1.15 * getEndAnchorOvershootPenalty(rightPortal, endPortal) -
          0.05 * rightPortal.density;

      return leftScore - rightScore;
    });

    const nextPortal = candidates.find(
      (portal) =>
        getProjectedRouteDistanceMeters([...route, portal], routeOptions, endPortal) <=
        maxTotalMeters
    );

    if (!nextPortal) {
      break;
    }

    route.push(nextPortal);
    pool.splice(pool.indexOf(nextPortal), 1);
  }

  return route;
}

function insertAlongAnchoredCorridor(
  route,
  annotatedPortals,
  exactCount,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  endPortal = null
) {
  if (
    !endPortal ||
    !Array.isArray(route) ||
    route.length === 0 ||
    route.length >= exactCount
  ) {
    return route;
  }

  let nextRoute = dedupeKeepFirst(
    route.filter((portal) => coordKey(portal) !== coordKey(endPortal))
  );
  const startPortal = nextRoute[0];
  const anchorLengthMeters = Math.max(
    calculateDistanceMeters(startPortal, endPortal),
    1
  );
  let guardCount = 0;

  while (
    nextRoute.length < exactCount &&
    guardCount < Math.min(MAX_EXTEND_TRIES, exactCount * 20)
  ) {
    guardCount += 1;

    const usedPortalKeys = new Set(nextRoute.map(coordKey));
    const pool = buildUnusedPool(annotatedPortals, usedPortalKeys).filter(
      (portal) => coordKey(portal) !== coordKey(endPortal)
    );
    const hasInRangeUnusedPortals = pool.some(
      (portal) => getImportedOrderRangePenalty(portal, startPortal, endPortal) === 0
    );

    if (pool.length === 0) {
      break;
    }

    const routeWithEnd = [...nextRoute, endPortal];
    let bestCandidateRoute = null;
    let bestCandidateScore = Number.POSITIVE_INFINITY;

    for (
      let segmentIndex = 0;
      segmentIndex < routeWithEnd.length - 1;
      segmentIndex += 1
    ) {
      const portalA = routeWithEnd[segmentIndex];
      const portalB = routeWithEnd[segmentIndex + 1];
      const segmentLengthMeters = Math.max(
        calculateDistanceMeters(portalA, portalB),
        1
      );
      const segmentWindowMeters = clamp(segmentLengthMeters * 0.45, 110, 260);
      const progressA =
        segmentIndex === 0
          ? 0
          : getEndAnchorProjectionFraction(portalA, endPortal);
      const progressB =
        coordKey(portalB) === coordKey(endPortal)
          ? 1
          : getEndAnchorProjectionFraction(portalB, endPortal);
      const progressMin = Math.min(progressA, progressB) - 0.02;
      const progressMax = Math.max(progressA, progressB) + 0.04;
      const localCandidates = pool
        .map((portal) => {
          const legDistance = segmentDistanceMeters(portal, portalA, portalB);
          const distanceToA = calculateDistanceMeters(portalA, portal);
          const distanceToB = calculateDistanceMeters(portal, portalB);
          const progress = getEndAnchorProjectionFraction(portal, endPortal);
          const progressOutside =
            progress < progressMin
              ? progressMin - progress
              : progress > progressMax
                ? progress - progressMax
                : 0;
          const addedDistanceMeters =
            distanceToA + distanceToB - segmentLengthMeters;
          const localScore =
            0.85 * addedDistanceMeters +
            1.3 * legDistance.distance +
            480 * progressOutside +
            2.2 * getEndAnchorOvershootPenalty(portal, endPortal) +
            1.6 * getImportedOrderRangePenalty(portal, startPortal, endPortal) +
            0.08 *
              Math.abs(progress - (progressA + progressB) / 2) *
              anchorLengthMeters -
            10 * portal.density;

          return {
            portal,
            legDistanceMeters: legDistance.distance,
            distanceToA,
            distanceToB,
            localScore,
          };
        })
        .filter(
          ({ portal, legDistanceMeters, distanceToA, distanceToB, localScore }) =>
            Number.isFinite(localScore) &&
            (!hasInRangeUnusedPortals ||
              getImportedOrderRangePenalty(portal, startPortal, endPortal) === 0) &&
            (legDistanceMeters <= segmentWindowMeters ||
              (distanceToA <= MAX_LEG_M * 1.7 &&
                distanceToB <= MAX_LEG_M * 1.7))
        )
        .sort(
          (leftCandidate, rightCandidate) =>
            leftCandidate.localScore - rightCandidate.localScore
        )
        .slice(0, 6);

      localCandidates.forEach(({ portal }) => {
        const candidateRoute = [
          ...nextRoute.slice(0, segmentIndex + 1),
          portal,
          ...nextRoute.slice(segmentIndex + 1),
        ];
        const candidateDistanceMeters = getProjectedRouteDistanceMeters(
          candidateRoute,
          routeOptions,
          endPortal
        );

        if (candidateDistanceMeters > targets.generationMaxMeters) {
          return;
        }

        const candidateScore = computeProjectedRouteScore(
          candidateRoute,
          targets,
          routeOptions,
          endPortal
        );

        if (candidateScore < bestCandidateScore) {
          bestCandidateScore = candidateScore;
          bestCandidateRoute = candidateRoute;
        }
      });
    }

    if (!bestCandidateRoute) {
      break;
    }

    nextRoute = bestCandidateRoute;
  }

  return nextRoute;
}

function detourOutwardFill(
  route,
  annotatedPortals,
  startPortal,
  needCount,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  tailTargetPortal = startPortal,
  endPortal = null
) {
  if (!Array.isArray(route) || route.length === 0 || needCount <= 0) {
    return route;
  }

  const usedPortalKeys = new Set(route.map(coordKey));
  const pool = buildUnusedPool(annotatedPortals, usedPortalKeys);
  let remainingCount = needCount;
  let guardCount = 0;
  const prefersExtendedDistance = Boolean(targets.prefersExtendedDistance);

  while (remainingCount > 0 && pool.length > 0 && guardCount < MAX_EXTEND_TRIES) {
    guardCount += 1;
    const lastPortal = route[route.length - 1];
    const distancePressure = computeDistancePressureState(
      route,
      route.length + remainingCount,
      targets,
      routeOptions,
      endPortal
    );
    const targetGainMeters = clamp(
      Math.max(distancePressure.targetHopMeters, MAX_LEG_M * 1.05),
      MAX_LEG_M * 0.9,
      MAX_LEG_M * 5
    );
    let candidatePool = pool;

    if (prefersExtendedDistance && distancePressure.isUnderPressure) {
      const longGainCandidates = pool.filter(
        (portal) =>
          estimateAppendDistanceGain(route, portal, routeOptions, endPortal) >=
          targetGainMeters * 0.7
      );

      if (longGainCandidates.length > 0) {
        candidatePool = longGainCandidates;
      }
    }

    candidatePool.sort((leftPortal, rightPortal) => {
      const leftAppendGain = estimateAppendDistanceGain(
        route,
        leftPortal,
        routeOptions,
        endPortal
      );
      const rightAppendGain = estimateAppendDistanceGain(
        route,
        rightPortal,
        routeOptions,
        endPortal
      );
      const leftScore = prefersExtendedDistance
        ? 0.22 * Math.abs(leftAppendGain - targetGainMeters) +
          0.34 * Math.max(0, targetGainMeters - leftAppendGain) -
          0.54 * leftAppendGain +
          0.14 * calculateDistanceMeters(leftPortal, tailTargetPortal) +
          1.25 * getEndAnchorOvershootPenalty(leftPortal, endPortal) -
          20 * leftPortal.density
        : Math.hypot(leftPortal.x - lastPortal.x, leftPortal.y - lastPortal.y) +
          0.2 * calculateDistanceMeters(leftPortal, tailTargetPortal) -
          0.18 *
            Math.max(
              0,
              calculateDistanceMeters(lastPortal, tailTargetPortal) -
                calculateDistanceMeters(leftPortal, tailTargetPortal)
            ) +
          1.25 * getEndAnchorOvershootPenalty(leftPortal, endPortal) -
          30 * leftPortal.density;
      const rightScore = prefersExtendedDistance
        ? 0.22 * Math.abs(rightAppendGain - targetGainMeters) +
          0.34 * Math.max(0, targetGainMeters - rightAppendGain) -
          0.54 * rightAppendGain +
          0.14 * calculateDistanceMeters(rightPortal, tailTargetPortal) +
          1.25 * getEndAnchorOvershootPenalty(rightPortal, endPortal) -
          20 * rightPortal.density
        : Math.hypot(rightPortal.x - lastPortal.x, rightPortal.y - lastPortal.y) +
          0.2 * calculateDistanceMeters(rightPortal, tailTargetPortal) -
          0.18 *
            Math.max(
              0,
              calculateDistanceMeters(lastPortal, tailTargetPortal) -
                calculateDistanceMeters(rightPortal, tailTargetPortal)
            ) +
          1.25 * getEndAnchorOvershootPenalty(rightPortal, endPortal) -
          30 * rightPortal.density;

      return leftScore - rightScore;
    });

    const targetPortal = candidatePool[0];
    let currentX = lastPortal.x;
    let currentY = lastPortal.y;
    let previousRemainingDistance = Math.hypot(
      targetPortal.x - currentX,
      targetPortal.y - currentY
    );
    let bridgeSteps = 0;

    while (
      previousRemainingDistance > MAX_LEG_M &&
      remainingCount > 0 &&
      bridgeSteps < MAX_BRIDGE_STEPS
    ) {
      bridgeSteps += 1;

      const candidates = pool.filter(
        (portal) =>
          portal.portalKey !== targetPortal.portalKey &&
          Math.hypot(portal.x - currentX, portal.y - currentY) <= MAX_LEG_M * 1.5
      );

      if (candidates.length === 0) {
        break;
      }

      candidates.sort((leftPortal, rightPortal) => {
        const leftScore =
          0.75 * Math.hypot(leftPortal.x - currentX, leftPortal.y - currentY) +
          0.25 * Math.hypot(targetPortal.x - leftPortal.x, targetPortal.y - leftPortal.y);
        const rightScore =
          0.75 * Math.hypot(rightPortal.x - currentX, rightPortal.y - currentY) +
          0.25 * Math.hypot(targetPortal.x - rightPortal.x, targetPortal.y - rightPortal.y);

        return leftScore - rightScore;
      });

      const bridgePortal = candidates[0];
      const nextRemainingDistance = Math.hypot(
        targetPortal.x - bridgePortal.x,
        targetPortal.y - bridgePortal.y
      );

      if (previousRemainingDistance - nextRemainingDistance < MIN_PROGRESS_M) {
        break;
      }

      if (
        getProjectedRouteDistanceMeters([...route, bridgePortal], routeOptions, endPortal) >
        targets.generationMaxMeters
      ) {
        break;
      }

      route.push(bridgePortal);
      pool.splice(pool.indexOf(bridgePortal), 1);
      remainingCount -= 1;
      currentX = bridgePortal.x;
      currentY = bridgePortal.y;
      previousRemainingDistance = nextRemainingDistance;
    }

    if (remainingCount <= 0 || !pool.includes(targetPortal)) {
      continue;
    }

    if (
      getProjectedRouteDistanceMeters([...route, targetPortal], routeOptions, endPortal) >
      targets.generationMaxMeters
    ) {
      break;
    }

    route.push(targetPortal);
    pool.splice(pool.indexOf(targetPortal), 1);
    remainingCount -= 1;

    if (
      remainingCount <= 0 ||
      (prefersExtendedDistance && distancePressure.isUnderPressure)
    ) {
      break;
    }

    const clusterNeighbors = pool
      .filter(
        (portal) =>
          Math.hypot(portal.x - targetPortal.x, portal.y - targetPortal.y) <= 120
      )
      .sort((leftPortal, rightPortal) => {
        const leftScore =
          Math.hypot(leftPortal.x - targetPortal.x, leftPortal.y - targetPortal.y) -
          0.25 * Math.max(0, calculateDistanceMeters(targetPortal, tailTargetPortal) -
            calculateDistanceMeters(leftPortal, tailTargetPortal)) +
          1.1 * getEndAnchorOvershootPenalty(leftPortal, endPortal) -
          15 * leftPortal.density;
        const rightScore =
          Math.hypot(rightPortal.x - targetPortal.x, rightPortal.y - targetPortal.y) -
          0.25 * Math.max(0, calculateDistanceMeters(targetPortal, tailTargetPortal) -
            calculateDistanceMeters(rightPortal, tailTargetPortal)) +
          1.1 * getEndAnchorOvershootPenalty(rightPortal, endPortal) -
          15 * rightPortal.density;

        return leftScore - rightScore;
      });

    clusterNeighbors.slice(0, 3).forEach((portal) => {
      if (remainingCount <= 0) {
        return;
      }

      if (
        getProjectedRouteDistanceMeters([...route, portal], routeOptions, endPortal) >
        targets.generationMaxMeters
      ) {
        return;
      }

      route.push(portal);
      pool.splice(pool.indexOf(portal), 1);
      remainingCount -= 1;
    });
  }

  return route;
}

function forceFillRemaining(
  route,
  annotatedPortals,
  exactCount,
  tailTargetPortal = null
) {
  if (!Array.isArray(route) || route.length === 0) {
    return route;
  }

  const usedPortalKeys = new Set(route.map(coordKey));
  const pool = buildUnusedPool(annotatedPortals, usedPortalKeys);

  while (route.length < exactCount && pool.length > 0) {
    const lastPortal = route[route.length - 1];

    pool.sort(
      (leftPortal, rightPortal) => {
        const leftScore =
          calculateDistanceMeters(lastPortal, leftPortal) +
          (tailTargetPortal
            ? 0.2 * calculateDistanceMeters(leftPortal, tailTargetPortal)
            : 0) +
          (tailTargetPortal
            ? 1.1 * getEndAnchorOvershootPenalty(leftPortal, tailTargetPortal)
            : 0);
        const rightScore =
          calculateDistanceMeters(lastPortal, rightPortal) +
          (tailTargetPortal
            ? 0.2 * calculateDistanceMeters(rightPortal, tailTargetPortal)
            : 0) +
          (tailTargetPortal
            ? 1.1 * getEndAnchorOvershootPenalty(rightPortal, tailTargetPortal)
            : 0);

        return leftScore - rightScore;
      }
    );

    route.push(pool.shift());
  }

  return route;
}

function repairAnchoredEndApproach(
  route,
  endPortal,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  requiredPortalKeys = []
) {
  if (!endPortal || !Array.isArray(route) || route.length < 4) {
    return route;
  }

  const normalizedRoute = withLockedEndPortal(route, endPortal);
  const routeWithoutEnd = normalizedRoute.slice(0, -1);
  const protectedPortalKeys = new Set([
    coordKey(routeWithoutEnd[0]),
    coordKey(endPortal),
    ...requiredPortalKeys.filter(Boolean),
  ]);
  const movablePortals = routeWithoutEnd.filter(
    (portal, routeIndex) =>
      routeIndex > 0 && !protectedPortalKeys.has(coordKey(portal))
  );

  if (movablePortals.length < 2) {
    return normalizedRoute;
  }

  const tailSize = Math.min(6, movablePortals.length);
  const inRangeTailCandidates = movablePortals
    .filter(
      (portal) =>
        getImportedOrderRangePenalty(portal, routeWithoutEnd[0], endPortal) === 0
    )
    .slice()
    .sort(
      (leftPortal, rightPortal) =>
        calculateDistanceMeters(leftPortal, endPortal) -
        calculateDistanceMeters(rightPortal, endPortal)
    );
  const outOfRangeTailCandidates = movablePortals
    .filter(
      (portal) =>
        getImportedOrderRangePenalty(portal, routeWithoutEnd[0], endPortal) > 0
    )
    .slice()
    .sort((leftPortal, rightPortal) => {
      const leftScore =
        4.5 * getImportedOrderRangePenalty(leftPortal, routeWithoutEnd[0], endPortal) +
        calculateDistanceMeters(leftPortal, endPortal) +
        1.1 * getEndAnchorOvershootPenalty(leftPortal, endPortal);
      const rightScore =
        4.5 * getImportedOrderRangePenalty(rightPortal, routeWithoutEnd[0], endPortal) +
        calculateDistanceMeters(rightPortal, endPortal) +
        1.1 * getEndAnchorOvershootPenalty(rightPortal, endPortal);

      return leftScore - rightScore;
    });
  const tailPortalKeys = new Set(
    [...inRangeTailCandidates, ...outOfRangeTailCandidates]
      .slice(0, tailSize)
      .map(coordKey)
  );
  const direction =
    (endPortal.sourceOrderIndex ?? 0) >=
    (routeWithoutEnd[0].sourceOrderIndex ?? 0)
      ? 1
      : -1;
  const prefixRoute = routeWithoutEnd.filter(
    (portal) => !tailPortalKeys.has(coordKey(portal))
  );
  const reorderedTail = routeWithoutEnd
    .filter((portal) => tailPortalKeys.has(coordKey(portal)))
    .sort((leftPortal, rightPortal) => {
      const leftPenalty =
        getImportedOrderRangePenalty(leftPortal, routeWithoutEnd[0], endPortal);
      const rightPenalty =
        getImportedOrderRangePenalty(rightPortal, routeWithoutEnd[0], endPortal);
      const leftOvershootsEnd =
        leftPenalty > 0 &&
        (direction >= 0
          ? (leftPortal.sourceOrderIndex ?? 0) > (endPortal.sourceOrderIndex ?? 0)
          : (leftPortal.sourceOrderIndex ?? 0) < (endPortal.sourceOrderIndex ?? 0));
      const rightOvershootsEnd =
        rightPenalty > 0 &&
        (direction >= 0
          ? (rightPortal.sourceOrderIndex ?? 0) > (endPortal.sourceOrderIndex ?? 0)
          : (rightPortal.sourceOrderIndex ?? 0) < (endPortal.sourceOrderIndex ?? 0));

      if (leftOvershootsEnd !== rightOvershootsEnd) {
        return leftOvershootsEnd ? -1 : 1;
      }

      if (leftOvershootsEnd && rightOvershootsEnd) {
        return direction >= 0
          ? (leftPortal.sourceOrderIndex ?? 0) - (rightPortal.sourceOrderIndex ?? 0)
          : (rightPortal.sourceOrderIndex ?? 0) - (leftPortal.sourceOrderIndex ?? 0);
      }

      if (Math.abs(leftPenalty - rightPenalty) > 0.5) {
        return leftPenalty - rightPenalty;
      }

      const leftProgress = getEndAnchorProjectionFraction(leftPortal, endPortal);
      const rightProgress = getEndAnchorProjectionFraction(rightPortal, endPortal);

      if (Math.abs(leftProgress - rightProgress) > 0.01) {
        return leftProgress - rightProgress;
      }

      return direction >= 0
        ? (leftPortal.sourceOrderIndex ?? 0) - (rightPortal.sourceOrderIndex ?? 0)
        : (rightPortal.sourceOrderIndex ?? 0) - (leftPortal.sourceOrderIndex ?? 0);
    });

  const candidateRoute = [...prefixRoute, ...reorderedTail, endPortal];
  const candidateTailHopMeters = calculateDistanceMeters(
    candidateRoute[candidateRoute.length - 2],
    endPortal
  );
  const normalizedTailHopMeters = calculateDistanceMeters(
    normalizedRoute[normalizedRoute.length - 2],
    endPortal
  );

  if (candidateTailHopMeters + 5 < normalizedTailHopMeters) {
    return candidateRoute;
  }

  return computeProjectedRouteScore(candidateRoute, targets, routeOptions, endPortal) <=
    computeProjectedRouteScore(normalizedRoute, targets, routeOptions, endPortal)
    ? candidateRoute
    : normalizedRoute;
}

function resequenceAnchoredNoLoopRoute(
  route,
  endPortal,
  requiredPortalKeys = []
) {
  if (!endPortal || !Array.isArray(route) || route.length < 4) {
    return route;
  }

  const normalizedRoute = withLockedEndPortal(route, endPortal);
  const startPortal = normalizedRoute[0];
  const protectedPortalKeys = new Set([
    coordKey(startPortal),
    coordKey(endPortal),
    ...requiredPortalKeys.filter(Boolean),
  ]);
  const movablePortals = normalizedRoute.filter(
    (portal, routeIndex) =>
      routeIndex > 0 &&
      routeIndex < normalizedRoute.length - 1 &&
      !protectedPortalKeys.has(coordKey(portal))
  );
  const protectedMiddlePortals = normalizedRoute.filter(
    (portal, routeIndex) =>
      routeIndex > 0 &&
      routeIndex < normalizedRoute.length - 1 &&
      protectedPortalKeys.has(coordKey(portal))
  );
  const progressByPortalKey = new Map(
    normalizedRoute.map((portal) => [
      coordKey(portal),
      getEndAnchorProjectionFraction(portal, endPortal),
    ])
  );
  const middlePortals = [...movablePortals, ...protectedMiddlePortals];
  const prefixPortals = middlePortals
    .filter((portal) => (progressByPortalKey.get(coordKey(portal)) ?? 0) < 0)
    .sort((leftPortal, rightPortal) => {
      const leftProgress = progressByPortalKey.get(coordKey(leftPortal)) ?? 0;
      const rightProgress = progressByPortalKey.get(coordKey(rightPortal)) ?? 0;

      if (Math.abs(leftProgress - rightProgress) > 0.001) {
        return rightProgress - leftProgress;
      }

      return calculateDistanceMeters(startPortal, leftPortal) -
        calculateDistanceMeters(startPortal, rightPortal);
    });
  const corridorPortals = middlePortals
    .filter((portal) => {
      const progress = progressByPortalKey.get(coordKey(portal)) ?? 0;

      return progress >= 0 && progress <= 1;
    })
    .sort((leftPortal, rightPortal) => {
      const leftProgress = progressByPortalKey.get(coordKey(leftPortal)) ?? 0;
      const rightProgress = progressByPortalKey.get(coordKey(rightPortal)) ?? 0;

      if (Math.abs(leftProgress - rightProgress) > 0.001) {
        return leftProgress - rightProgress;
      }

      return (leftPortal.sourceOrderIndex ?? 0) - (rightPortal.sourceOrderIndex ?? 0);
    });
  const suffixPortals = middlePortals
    .filter((portal) => (progressByPortalKey.get(coordKey(portal)) ?? 0) > 1)
    .sort((leftPortal, rightPortal) => {
      const leftProgress = progressByPortalKey.get(coordKey(leftPortal)) ?? 0;
      const rightProgress = progressByPortalKey.get(coordKey(rightPortal)) ?? 0;

      if (Math.abs(leftProgress - rightProgress) > 0.001) {
        return rightProgress - leftProgress;
      }

      return calculateDistanceMeters(endPortal, leftPortal) -
        calculateDistanceMeters(endPortal, rightPortal);
    });

  return [
    startPortal,
    ...prefixPortals,
    ...corridorPortals,
    ...suffixPortals,
    endPortal,
  ];
}

function relocateRoutePortal(route, fromIndex, toIndex) {
  if (
    !Array.isArray(route) ||
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= route.length ||
    toIndex > route.length
  ) {
    return route;
  }

  const nextRoute = route.slice();
  const [movedPortal] = nextRoute.splice(fromIndex, 1);
  const normalizedInsertIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
  nextRoute.splice(normalizedInsertIndex, 0, movedPortal);
  return nextRoute;
}

function refineAnchoredRouteShape(
  route,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  requiredPortalKeys = [],
  endPortal = null
) {
  if (!endPortal || !Array.isArray(route) || route.length < 5) {
    return route;
  }

  let bestRoute = withLockedEndPortal(route, endPortal);
  let bestScore = computeProjectedRouteScore(
    bestRoute,
    targets,
    routeOptions,
    endPortal
  );
  const protectedPortalKeys = new Set([
    coordKey(bestRoute[0]),
    coordKey(endPortal),
    ...requiredPortalKeys.filter(Boolean),
  ]);

  for (let roundIndex = 0; roundIndex < 3; roundIndex += 1) {
    let improved = false;

    for (
      let routeIndex = 1;
      routeIndex < bestRoute.length - 1 && !improved;
      routeIndex += 1
    ) {
      const portalKey = coordKey(bestRoute[routeIndex]);

      if (protectedPortalKeys.has(portalKey)) {
        continue;
      }

      const windowStart = Math.max(1, routeIndex - 6);
      const windowEnd = Math.min(bestRoute.length - 1, routeIndex + 7);

      for (
        let candidateIndex = windowStart;
        candidateIndex < windowEnd && !improved;
        candidateIndex += 1
      ) {
        if (candidateIndex === routeIndex) {
          continue;
        }

        const relocatedRoute = withLockedEndPortal(
          relocateRoutePortal(bestRoute, routeIndex, candidateIndex),
          endPortal
        );
        const relocatedScore = computeProjectedRouteScore(
          relocatedRoute,
          targets,
          routeOptions,
          endPortal
        );

        if (relocatedScore + 0.5 < bestScore) {
          bestRoute = relocatedRoute;
          bestScore = relocatedScore;
          improved = true;
          break;
        }

        if (
          candidateIndex < bestRoute.length - 2 &&
          !protectedPortalKeys.has(coordKey(bestRoute[candidateIndex]))
        ) {
          const swappedRoute = bestRoute.slice();
          const tempPortal = swappedRoute[routeIndex];
          swappedRoute[routeIndex] = swappedRoute[candidateIndex];
          swappedRoute[candidateIndex] = tempPortal;
          const swappedScore = computeProjectedRouteScore(
            swappedRoute,
            targets,
            routeOptions,
            endPortal
          );

          if (swappedScore + 0.5 < bestScore) {
            bestRoute = swappedRoute;
            bestScore = swappedScore;
            improved = true;
            break;
          }
        }
      }
    }

    if (!improved) {
      break;
    }
  }

  return bestRoute;
}

function rebalanceAnchoredRouteForMissionChunks(
  route,
  annotatedPortals,
  startPortal,
  endPortal,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  requiredPortalKeys = []
) {
  if (!endPortal || !Array.isArray(route) || route.length < PORTALS_PER_MISSION * 2) {
    return route;
  }

  const normalizedRoute = withLockedEndPortal(route, endPortal);
  const protectedPortalKeys = new Set([
    coordKey(startPortal),
    coordKey(endPortal),
    ...requiredPortalKeys.filter(Boolean),
  ]);
  const direction =
    (endPortal.sourceOrderIndex ?? 0) >= (startPortal.sourceOrderIndex ?? 0) ? 1 : -1;
  const rangeStart = Math.min(
    startPortal.sourceOrderIndex ?? 0,
    endPortal.sourceOrderIndex ?? 0
  );
  const rangeEnd = Math.max(
    startPortal.sourceOrderIndex ?? 0,
    endPortal.sourceOrderIndex ?? 0
  );
  const isInRange = (portal) =>
    Number.isFinite(portal?.sourceOrderIndex) &&
    portal.sourceOrderIndex >= rangeStart &&
    portal.sourceOrderIndex <= rangeEnd;
  const currentOutOfRangeCount = normalizedRoute.filter(
    (portal, routeIndex) => routeIndex > 0 && !isInRange(portal)
  ).length;

  if (currentOutOfRangeCount === 0 || currentOutOfRangeCount % PORTALS_PER_MISSION === 0) {
    return normalizedRoute;
  }

  const neededExtraCount =
    PORTALS_PER_MISSION - (currentOutOfRangeCount % PORTALS_PER_MISSION);
  const usedPortalKeys = new Set(normalizedRoute.map(coordKey));
  const preferredExtraCandidates = annotatedPortals
    .filter((portal) => !usedPortalKeys.has(coordKey(portal)))
    .filter((portal) => !isInRange(portal))
    .filter((portal) =>
      direction >= 0
        ? (portal.sourceOrderIndex ?? 0) > (endPortal.sourceOrderIndex ?? 0)
        : (portal.sourceOrderIndex ?? 0) < (endPortal.sourceOrderIndex ?? 0)
    )
    .sort((leftPortal, rightPortal) =>
      direction >= 0
        ? (leftPortal.sourceOrderIndex ?? 0) - (rightPortal.sourceOrderIndex ?? 0)
        : (rightPortal.sourceOrderIndex ?? 0) - (leftPortal.sourceOrderIndex ?? 0)
    );
  const fallbackExtraCandidates = annotatedPortals
    .filter((portal) => !usedPortalKeys.has(coordKey(portal)))
    .filter((portal) => !isInRange(portal))
    .filter((portal) =>
      direction >= 0
        ? (portal.sourceOrderIndex ?? 0) < rangeStart
        : (portal.sourceOrderIndex ?? 0) > rangeEnd
    )
    .sort((leftPortal, rightPortal) =>
      direction >= 0
        ? (rightPortal.sourceOrderIndex ?? 0) - (leftPortal.sourceOrderIndex ?? 0)
        : (leftPortal.sourceOrderIndex ?? 0) - (rightPortal.sourceOrderIndex ?? 0)
    );
  const extraPortals = [...preferredExtraCandidates, ...fallbackExtraCandidates].slice(
    0,
    neededExtraCount
  );

  if (extraPortals.length !== neededExtraCount) {
    return normalizedRoute;
  }

  const corridorPortals = normalizedRoute.filter(isInRange);
  const finalApproachCount = Math.min(PORTALS_PER_MISSION, corridorPortals.length);
  const protectedFinalApproachKeys = new Set(
    corridorPortals
      .slice(-finalApproachCount)
      .map((portal) => coordKey(portal))
  );
  const removableCorridorPortals = corridorPortals
    .filter(
      (portal) =>
        !protectedPortalKeys.has(coordKey(portal)) &&
        !protectedFinalApproachKeys.has(coordKey(portal))
    )
    .sort((leftPortal, rightPortal) =>
      direction >= 0
        ? (rightPortal.sourceOrderIndex ?? 0) - (leftPortal.sourceOrderIndex ?? 0)
        : (leftPortal.sourceOrderIndex ?? 0) - (rightPortal.sourceOrderIndex ?? 0)
    )
    .slice(0, neededExtraCount);

  if (removableCorridorPortals.length !== neededExtraCount) {
    return normalizedRoute;
  }

  const removablePortalKeySet = new Set(removableCorridorPortals.map(coordKey));
  const nextSelectedPortals = [
    ...normalizedRoute.filter((portal) => !removablePortalKeySet.has(coordKey(portal))),
    ...extraPortals,
  ];
  const nextCorridorPortals = nextSelectedPortals
    .filter(isInRange)
    .slice()
    .sort((leftPortal, rightPortal) =>
      direction >= 0
        ? (leftPortal.sourceOrderIndex ?? 0) - (rightPortal.sourceOrderIndex ?? 0)
        : (rightPortal.sourceOrderIndex ?? 0) - (leftPortal.sourceOrderIndex ?? 0)
    );
  const nextExtraPortals = nextSelectedPortals
    .filter((portal) => !isInRange(portal))
    .filter((portal) => coordKey(portal) !== coordKey(startPortal))
    .filter((portal) => coordKey(portal) !== coordKey(endPortal))
    .slice()
    .sort((leftPortal, rightPortal) =>
      direction >= 0
        ? (leftPortal.sourceOrderIndex ?? 0) - (rightPortal.sourceOrderIndex ?? 0)
        : (rightPortal.sourceOrderIndex ?? 0) - (leftPortal.sourceOrderIndex ?? 0)
    );
  const nextFinalApproachCount = Math.min(
    PORTALS_PER_MISSION,
    nextCorridorPortals.length
  );
  const candidateRoute = [
    ...nextCorridorPortals.slice(0, nextCorridorPortals.length - nextFinalApproachCount),
    ...nextExtraPortals,
    ...nextCorridorPortals.slice(-nextFinalApproachCount),
  ];
  const originalScore = computeProjectedRouteScore(
    normalizedRoute,
    targets,
    routeOptions,
    endPortal
  );
  const candidateScore = computeProjectedRouteScore(
    candidateRoute,
    targets,
    routeOptions,
    endPortal
  );
  const originalMissionPenalty = computeMissionChunkPenalty(normalizedRoute);
  const candidateMissionPenalty = computeMissionChunkPenalty(candidateRoute);
  const originalLinePenalty = computeAnchorCorridorPenalty(
    normalizedRoute,
    endPortal
  );
  const candidateLinePenalty = computeAnchorCorridorPenalty(
    candidateRoute,
    endPortal
  );
  const originalMaxHopMeters = computeMaxHopMeters(normalizedRoute);
  const candidateMaxHopMeters = computeMaxHopMeters(candidateRoute);
  const originalTailHopMeters = calculateDistanceMeters(
    normalizedRoute[normalizedRoute.length - 2],
    endPortal
  );
  const candidateTailHopMeters = calculateDistanceMeters(
    candidateRoute[candidateRoute.length - 2],
    endPortal
  );

  if (
    candidateRoute.length === normalizedRoute.length &&
    candidateMissionPenalty + 1 < originalMissionPenalty &&
    candidateLinePenalty <=
      Math.max(originalLinePenalty * 1.15, originalLinePenalty + 220) &&
    candidateTailHopMeters <= Math.max(originalTailHopMeters + 300, originalTailHopMeters * 1.25) &&
    candidateMaxHopMeters <= Math.max(originalMaxHopMeters * 1.8, originalMaxHopMeters + 1200) &&
    candidateScore <= originalScore + Math.max(40, originalScore * 0.025)
  ) {
    return candidateRoute;
  }

  return normalizedRoute;
}

function ensureRequiredPortals(
  route,
  annotatedPortals,
  requiredPortalKeys,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  endPortal = null
) {
  if (!Array.isArray(route) || route.length === 0 || requiredPortalKeys.length === 0) {
    return dedupeKeepFirst(route);
  }

  const nextRoute = dedupeKeepFirst(route);
  const portalByKey = new Map(
    annotatedPortals.map((portal) => [coordKey(portal), portal])
  );
  const includedPortalKeys = new Set(nextRoute.map(coordKey));

  requiredPortalKeys.forEach((requiredPortalKey) => {
    if (includedPortalKeys.has(requiredPortalKey)) {
      return;
    }

    const requiredPortal = portalByKey.get(requiredPortalKey);

    if (!requiredPortal) {
      return;
    }

    let bestInsertIndex = nextRoute.length;
    let bestInsertScore = Number.POSITIVE_INFINITY;

    for (let insertIndex = 1; insertIndex <= nextRoute.length; insertIndex += 1) {
      const candidateRoute = [
        ...nextRoute.slice(0, insertIndex),
        requiredPortal,
        ...nextRoute.slice(insertIndex),
      ];
      const candidateScore =
        computeProjectedRouteScore(candidateRoute, targets, routeOptions, endPortal) +
        Math.max(
          0,
          getProjectedRouteDistanceMeters(candidateRoute, routeOptions, endPortal) -
            targets.generationMaxMeters
        ) * 3;

      if (candidateScore < bestInsertScore) {
        bestInsertScore = candidateScore;
        bestInsertIndex = insertIndex;
      }
    }

    nextRoute.splice(bestInsertIndex, 0, requiredPortal);
    includedPortalKeys.add(requiredPortalKey);
  });

  return dedupeKeepFirst(nextRoute);
}

function trimRouteToExactCount(
  route,
  exactPortalCount,
  protectedPortalKeys,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  endPortal = null
) {
  const nextRoute = dedupeKeepFirst(route);
  const protectedPortalKeySet = new Set(protectedPortalKeys.filter(Boolean));

  while (nextRoute.length > exactPortalCount) {
    let bestRemovalIndex = -1;
    let bestRemovalScore = Number.POSITIVE_INFINITY;

    for (let routeIndex = 0; routeIndex < nextRoute.length; routeIndex += 1) {
      const portalKey = coordKey(nextRoute[routeIndex]);

      if (protectedPortalKeySet.has(portalKey)) {
        continue;
      }

      const candidateRoute = [
        ...nextRoute.slice(0, routeIndex),
        ...nextRoute.slice(routeIndex + 1),
      ];
      const candidateScore = computeProjectedRouteScore(
        candidateRoute,
        targets,
        routeOptions,
        endPortal
      );

      if (candidateScore < bestRemovalScore) {
        bestRemovalScore = candidateScore;
        bestRemovalIndex = routeIndex;
      }
    }

    if (bestRemovalIndex === -1) {
      break;
    }

    nextRoute.splice(bestRemovalIndex, 1);
  }

  return nextRoute;
}

function enforceExactUnique(
  route,
  annotatedPortals,
  startPortal,
  missionCount,
  targets,
  requiredPortalKeys = [],
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  endPortal = null
) {
  const exactPortalCount = missionCount * PORTALS_PER_MISSION;
  const endPortalKey = coordKey(endPortal);
  const exactWorkingPortalCount = exactPortalCount - (endPortalKey ? 1 : 0);
  const effectiveRequiredPortalKeys = requiredPortalKeys.filter(
    (requiredPortalKey) => requiredPortalKey !== endPortalKey
  );
  const tailTargetPortal = endPortal ?? startPortal;
  let nextRoute = ensureRequiredPortals(
    dedupeKeepFirst(
      route.filter((portal) => coordKey(portal) !== endPortalKey)
    ),
    annotatedPortals,
    effectiveRequiredPortalKeys,
    targets,
    routeOptions,
    endPortal
  );
  const deferNearRouteAugment = Boolean(targets.prefersExtendedDistance);
  const deferTailExtension = Boolean(targets.prefersExtendedDistance);

  if (!deferNearRouteAugment) {
    [40, 55, 70, 90].forEach((extraNearMeters) => {
      if (nextRoute.length >= exactWorkingPortalCount) {
        return;
      }

      nextRoute = augmentWithUnusedNearRoute(
        nextRoute,
        annotatedPortals,
        extraNearMeters,
        exactWorkingPortalCount - nextRoute.length
      );
    });
  }

  if (nextRoute.length < exactWorkingPortalCount) {
    nextRoute = insertAlongAnchoredCorridor(
      nextRoute,
      annotatedPortals,
      exactWorkingPortalCount,
      targets,
      routeOptions,
      endPortal
    );
  }

  if (!deferTailExtension && nextRoute.length < exactWorkingPortalCount) {
    nextRoute = extendTailTowardsStart(
      nextRoute,
      annotatedPortals,
      startPortal,
      targets,
      routeOptions,
      tailTargetPortal,
      endPortal
    );
  }

  if (nextRoute.length < exactWorkingPortalCount) {
    nextRoute = fillWithUnusedGreedy(
      nextRoute,
      annotatedPortals,
      startPortal,
      exactWorkingPortalCount,
      targets,
      routeOptions,
      tailTargetPortal,
      endPortal
    );
  }

  if (nextRoute.length < exactWorkingPortalCount) {
    nextRoute = detourOutwardFill(
      nextRoute,
      annotatedPortals,
      startPortal,
      exactWorkingPortalCount - nextRoute.length,
      targets,
      routeOptions,
      tailTargetPortal,
      endPortal
    );
  }

  if (deferTailExtension && nextRoute.length < exactWorkingPortalCount) {
    nextRoute = extendTailTowardsStart(
      nextRoute,
      annotatedPortals,
      startPortal,
      targets,
      routeOptions,
      tailTargetPortal,
      endPortal
    );
  }

  if (deferNearRouteAugment && nextRoute.length < exactWorkingPortalCount) {
    [40, 55, 70, 90].forEach((extraNearMeters) => {
      if (nextRoute.length >= exactWorkingPortalCount) {
        return;
      }

      nextRoute = augmentWithUnusedNearRoute(
        nextRoute,
        annotatedPortals,
        extraNearMeters,
        exactWorkingPortalCount - nextRoute.length
      );
    });
  }

  if (nextRoute.length < exactWorkingPortalCount) {
    nextRoute = forceFillRemaining(
      nextRoute,
      annotatedPortals,
      exactWorkingPortalCount,
      tailTargetPortal
    );
  }

  if (nextRoute.length > exactWorkingPortalCount) {
    nextRoute = trimRouteToExactCount(
      nextRoute,
      exactWorkingPortalCount,
      [coordKey(startPortal), ...effectiveRequiredPortalKeys],
      targets,
      routeOptions,
      endPortal
    );
  }

  if (nextRoute.length !== exactWorkingPortalCount) {
    throw new Error(
      `The imported banner only produced ${
        nextRoute.length + (endPortalKey ? 1 : 0)
      } unique route portals, but ${exactPortalCount} are required.`
    );
  }

  if (endPortal) {
    nextRoute = repairAnchoredEndApproach(
      [...nextRoute, endPortal],
      endPortal,
      targets,
      routeOptions,
      effectiveRequiredPortalKeys
    );
    nextRoute = refineAnchoredRouteShape(
      nextRoute,
      targets,
      routeOptions,
      effectiveRequiredPortalKeys,
      endPortal
    );
    nextRoute = repairAnchoredEndApproach(
      nextRoute,
      endPortal,
      targets,
      routeOptions,
      effectiveRequiredPortalKeys
    );
    if (routeUsesPathDistance(routeOptions)) {
      nextRoute = resequenceAnchoredNoLoopRoute(
        nextRoute,
        endPortal,
        effectiveRequiredPortalKeys
      );
    }
  }

  const presentPortalKeys = new Set(nextRoute.map(coordKey));
  const missingRequiredPortalCount = effectiveRequiredPortalKeys.filter(
    (requiredPortalKey) => !presentPortalKeys.has(requiredPortalKey)
  ).length;

  if (missingRequiredPortalCount > 0) {
    throw new Error(
      `${missingRequiredPortalCount} required portal${
        missingRequiredPortalCount === 1 ? "" : "s"
      } could not be kept in the reroute.`
    );
  }

  return nextRoute;
}

function buildCandidate(
  annotatedPortals,
  startPortal,
  startPortalKey,
  targets,
  rng,
  routeOptions = DEFAULT_ROUTE_OPTIONS,
  searchPlan = null,
  endPortal = null
) {
  const normalizedRouteOptions = normalizeRouteOptions(routeOptions);
  const resolvedSearchPlan = searchPlan ?? {
    radiusScale: 1,
    maxLegScale: 1,
    nearScale: 1,
    sectorScale: 1,
    turnWeightScale: 1,
    progressWeightScale: 1,
    densityWeightScale: 1,
  };
  const ringScale = resolvedSearchPlan.radiusScale * rng.range(0.92, 1.12);
  const ringMinMeters = RING_RADIUS_MIN_M * ringScale;
  const ringMaxMeters = RING_RADIUS_MAX_M * ringScale * rng.range(0.94, 1.08);
  const sectorCount = Math.max(
    10,
    Math.min(
      28,
      Math.round(
        SECTORS * resolvedSearchPlan.sectorScale * rng.range(0.9, 1.12)
      )
    )
  );
  const maxLegMeters =
    normalizedRouteOptions.maxSingleHopMeters *
    resolvedSearchPlan.maxLegScale *
    rng.range(0.92, 1.12);
  const nearMeters =
    normalizedRouteOptions.nearRouteCaptureMeters *
    resolvedSearchPlan.nearScale *
    rng.range(0.9, 1.22);
  const weights = {
    turnWeight:
      resolvedSearchPlan.turnWeightScale * rng.range(380, 500),
    progressWeight:
      resolvedSearchPlan.progressWeightScale * rng.range(160, 240),
    densityWeight:
      resolvedSearchPlan.densityWeightScale * rng.range(30, 50),
  };

  if (endPortal) {
    const anchoredWeights = {
      kPick: TOPK_BACKBONE_PICK,
      corridorWeight: rng.range(0.42, 0.9),
      turnWeight:
        resolvedSearchPlan.turnWeightScale * rng.range(180, 300),
      headingWeight:
        resolvedSearchPlan.turnWeightScale * rng.range(170, 250),
      progressWeight:
        resolvedSearchPlan.progressWeightScale * rng.range(1.0, 1.65),
      densityWeight:
        resolvedSearchPlan.densityWeightScale * rng.range(20, 38),
      importOrderWeight: rng.range(0.1, 0.34),
    };
    const anchoredBackbone = buildBackboneAnchoredGreedy(
      annotatedPortals,
      startPortal,
      startPortalKey,
      endPortal,
      rng,
      anchoredWeights
    );
    const anchoredRoute = bridgeAndDensifyAnchored(
      anchoredBackbone,
      annotatedPortals,
      startPortal,
      endPortal,
      maxLegMeters,
      nearMeters
    );

    return anchoredRoute;
  }

  const sectorBackbone = buildBackboneSector(
    annotatedPortals,
    startPortal,
    startPortalKey,
    ringMinMeters,
    ringMaxMeters,
    sectorCount,
    rng
  );
  const sectorRoute = bridgeAndDensify(
    sectorBackbone,
    annotatedPortals,
    startPortal,
    maxLegMeters,
    nearMeters
  );
  const sectorLengthMeters = getProjectedRouteDistanceMeters(
    sectorRoute,
    routeOptions,
    endPortal
  );

  if (routeMatchesPreferredDistanceWindow(sectorLengthMeters, targets)) {
    return sectorRoute;
  }

  const greedyBackbone = buildBackboneGreedy(
    annotatedPortals,
    startPortal,
    startPortalKey,
    ringMinMeters,
    ringMaxMeters,
    rng,
    weights
  );
  const greedyRoute = bridgeAndDensify(
    greedyBackbone,
    annotatedPortals,
    startPortal,
    maxLegMeters,
    nearMeters
  );

  return computeProjectedRouteScore(sectorRoute, targets, routeOptions, endPortal) <=
    computeProjectedRouteScore(greedyRoute, targets, routeOptions, endPortal)
    ? sectorRoute
    : greedyRoute;
}

export function getActivePortals(draft) {
  if (!draft) {
    return [];
  }

  const excludedPortalKeys = new Set(
    Array.isArray(draft.excludedPortalKeys)
      ? draft.excludedPortalKeys.filter((value) => typeof value === "string")
      : []
  );

  return (draft.portalPool ?? [])
    .filter((portal) => !excludedPortalKeys.has(portal.portalKey))
    .slice()
    .sort(
      (leftPortal, rightPortal) =>
        leftPortal.sourceOrderIndex - rightPortal.sourceOrderIndex
    );
}

function buildMissionSteps(routeId, missionNumber, portals) {
  return portals.reduce((steps, portal, portalIndex) => {
    steps[portalIndex] = {
      objective: "hack",
      poi: {
        id: portal.guid ?? portal.portalKey,
        title: portal.title,
        type: "portal",
        latitude: portal.latitude,
        longitude: portal.longitude,
      },
    };

    return steps;
  }, {});
}

function buildMissions(routeId, metadata, orderedPortals) {
  const missions = [];

  for (let missionIndex = 0; missionIndex < metadata.missionCount; missionIndex += 1) {
    const missionNumber = missionIndex + 1;
    const missionPortals = orderedPortals.slice(
      missionIndex * PORTALS_PER_MISSION,
      missionIndex * PORTALS_PER_MISSION + PORTALS_PER_MISSION
    );

    missions.push({
      id: `${routeId}-mission-${missionNumber}`,
      missionNumber,
      title: formatMissionTitle(metadata.title, missionNumber, metadata.missionCount),
      portals: missionPortals,
      steps: buildMissionSteps(routeId, missionNumber, missionPortals),
    });
  }

  return missions;
}

function buildBounds(portals) {
  if (!Array.isArray(portals) || portals.length === 0) {
    return null;
  }

  return portals.reduce(
    (bounds, portal) => ({
      minLatitude: Math.min(bounds.minLatitude, portal.latitude),
      maxLatitude: Math.max(bounds.maxLatitude, portal.latitude),
      minLongitude: Math.min(bounds.minLongitude, portal.longitude),
      maxLongitude: Math.max(bounds.maxLongitude, portal.longitude),
    }),
    {
      minLatitude: portals[0].latitude,
      maxLatitude: portals[0].latitude,
      minLongitude: portals[0].longitude,
      maxLongitude: portals[0].longitude,
    }
  );
}

export function compactRouteSnapshot(route) {
  if (!route || typeof route !== "object") {
    return null;
  }

  const portalOrder = Array.isArray(route.portalOrder)
    ? route.portalOrder.filter((portalKey) => typeof portalKey === "string")
    : Array.isArray(route.orderedPortals)
      ? route.orderedPortals
          .map((portal) => coordKey(portal))
          .filter((portalKey) => typeof portalKey === "string")
      : [];

  return {
    storageFormat: "banner-rerouter-route-v1",
    id: typeof route.id === "string" ? route.id : `reroute-${Date.now()}`,
    createdAt: Number.isFinite(route.createdAt) ? route.createdAt : Date.now(),
    metadata:
      route.metadata && typeof route.metadata === "object" ? route.metadata : null,
    source: route.source && typeof route.source === "object" ? route.source : null,
    routeOptions: normalizeRouteOptions(route.routeOptions),
    portalOrder,
    summary: route.summary && typeof route.summary === "object" ? route.summary : {},
  };
}

export function inflateStoredRoute(route, portalPool = []) {
  if (!route || typeof route !== "object") {
    return null;
  }

  if (Array.isArray(route.orderedPortals) && Array.isArray(route.missions)) {
    return route;
  }

  const portalOrder = Array.isArray(route.portalOrder)
    ? route.portalOrder.filter((portalKey) => typeof portalKey === "string")
    : [];

  if (portalOrder.length === 0) {
    return null;
  }

  const portalLookup = new Map(
    (Array.isArray(portalPool) ? portalPool : []).map((portal) => [
      coordKey(portal),
      portal,
    ])
  );
  const orderedPortals = [];

  for (let portalIndex = 0; portalIndex < portalOrder.length; portalIndex += 1) {
    const portal = portalLookup.get(portalOrder[portalIndex]);

    if (!portal) {
      return null;
    }

    orderedPortals.push(stripPortal(portal, portalIndex));
  }

  const fallbackMissionCount = Math.max(
    1,
    Math.round(portalOrder.length / PORTALS_PER_MISSION)
  );
  const missionCount = normalizeMissionCount(
    route.metadata?.missionCount,
    route.summary?.missionCount ?? fallbackMissionCount
  );
  const title =
    typeof route.metadata?.title === "string" && route.metadata.title.trim()
      ? route.metadata.title.trim()
      : "Rerouted Banner";
  const metadata = {
    title,
    description:
      typeof route.metadata?.description === "string"
        ? route.metadata.description
        : "",
    missionCount,
    titleFormat:
      typeof route.metadata?.titleFormat === "string"
        ? route.metadata.titleFormat
        : buildGeneratedTitleFormat(title, missionCount),
  };
  const routeId =
    typeof route.id === "string" ? route.id : `reroute-${route.createdAt ?? Date.now()}`;

  return {
    id: routeId,
    createdAt: Number.isFinite(route.createdAt) ? route.createdAt : Date.now(),
    metadata,
    source: route.source && typeof route.source === "object" ? route.source : {},
    routeOptions: normalizeRouteOptions(route.routeOptions),
    orderedPortals,
    portalOrder,
    missions: buildMissions(routeId, metadata, orderedPortals),
    summary: route.summary && typeof route.summary === "object" ? route.summary : {},
    bounds: buildBounds(orderedPortals),
  };
}

function buildRouteSummary(
  draft,
  orderedPortals,
  missionCount,
  targets,
  routeOptions = DEFAULT_ROUTE_OPTIONS
) {
  const pathDistanceMeters = pathLength(orderedPortals);
  const loopDistanceMeters = loopLength(orderedPortals);
  const routeDistanceMeters = getRouteDistanceMeters(orderedPortals, routeOptions);
  const distanceMode = getRouteDistanceMode(routeOptions);
  const distanceModeLabel = getRouteDistanceModeLabel(routeOptions);
  const averageHopMeters =
    orderedPortals.length > 1 ? pathDistanceMeters / (orderedPortals.length - 1) : 0;
  const hopDistances = orderedPortals.slice(1).map((portal, portalIndex) =>
    calculateDistanceMeters(orderedPortals[portalIndex], portal)
  );
  const maxHopMeters = hopDistances.length > 0 ? Math.max(...hopDistances) : 0;
  const startPortal = orderedPortals[0] ?? null;
  const endPortal = orderedPortals[orderedPortals.length - 1] ?? null;
  const tailGapMeters =
    startPortal && endPortal ? calculateDistanceMeters(endPortal, startPortal) : 0;
  const distancePenalty = computeDistanceFromTarget(routeDistanceMeters, targets);
  const targetFitScore = clamp(
    1 - distancePenalty / Math.max(targets.targetMaxMeters, 1),
    0,
    1
  );

  return {
    missionCount,
    portalCount: orderedPortals.length,
    importedPortalCount: draft.portalPool?.length ?? 0,
    activePortalCount: countActivePortals(draft),
    excludedPortalCount: Math.max(
      0,
      (draft.portalPool?.length ?? 0) - countActivePortals(draft)
    ),
    pathDistanceMeters,
    pathDistanceLabel: formatDistance(pathDistanceMeters),
    loopDistanceMeters,
    loopDistanceLabel: formatDistance(loopDistanceMeters),
    distanceMeters: routeDistanceMeters,
    distanceLabel: formatDistance(routeDistanceMeters),
    distanceMode,
    distanceModeLabel,
    targetWindowTypeLabel: `${distanceMode} distance`,
    targetMinMeters: targets.targetMinMeters,
    targetMaxMeters: targets.targetMaxMeters,
    targetWindowLabel: `${formatDistance(targets.targetMinMeters)}-${formatDistance(
      targets.targetMaxMeters
    )}`,
    averageHopMeters,
    averageHopLabel: formatDistance(averageHopMeters),
    maxHopMeters,
    maxHopLabel: formatDistance(maxHopMeters),
    tailGapMeters,
    tailGapLabel: formatDistance(tailGapMeters),
    targetFitScore,
    targetFitLabel: `${Math.round(targetFitScore * 100)}%`,
    isWithinTargetWindow:
      routeDistanceMeters >= targets.targetMinMeters &&
      routeDistanceMeters <= targets.targetMaxMeters,
    loopClosureMode: normalizeRouteOptions(routeOptions).loopClosureMode,
    requiredPortalCount: Array.isArray(draft.requiredPortalKeys)
      ? draft.requiredPortalKeys.length
      : 0,
    startPortalKey: startPortal?.portalKey ?? null,
    startPortalTitle: startPortal?.title ?? "Unavailable",
    endPortalKey: endPortal?.portalKey ?? null,
    endPortalTitle: endPortal?.title ?? "Unavailable",
  };
}

export function generateReroute(
  draft,
  {
    now = Date.now(),
    seedOffset = 0,
    onProgress = null,
    progressIntervalMs = 125,
    logRejections = false,
    maxContinuousSearchBatches = Number.POSITIVE_INFINITY,
  } = {}
) {
  if (!draft) {
    throw new Error("Import a banner before generating a reroute.");
  }

  const missionCount = normalizeMissionCount(
    draft.metadata?.missionCount,
    draft.metadata?.missionCount
  );
  const allPortals = getActivePortals(draft);
  const targetPortalCount = missionCount * PORTALS_PER_MISSION;
  const routeOptions = normalizeRouteOptions(draft.routeOptions);
  const requiredPortalKeySet = new Set(
    Array.isArray(draft.requiredPortalKeys)
      ? draft.requiredPortalKeys.filter((value) => typeof value === "string")
      : []
  );
  const requiredPortals = allPortals.filter((portal) =>
    requiredPortalKeySet.has(portal.portalKey)
  );

  if (allPortals.length < targetPortalCount) {
    throw new Error(
      `You need at least ${targetPortalCount} imported portals for a ${missionCount}-mission reroute.`
    );
  }

  if (
    Number.isFinite(routeOptions.minLoopDistanceMeters) &&
    Number.isFinite(routeOptions.maxLoopDistanceMeters) &&
    routeOptions.minLoopDistanceMeters > routeOptions.maxLoopDistanceMeters
  ) {
    throw new Error(
      "Minimum route distance must be less than or equal to maximum route distance."
    );
  }

  const startPortal =
    allPortals.find((portal) => portal.portalKey === draft.selectedStartPortalKey) ??
    allPortals[0];

  if (!startPortal) {
    throw new Error("Select a valid start portal before generating a reroute.");
  }

  const endPortal =
    draft.selectedEndPortalKey == null
      ? null
      : allPortals.find((portal) => portal.portalKey === draft.selectedEndPortalKey) ??
        null;

  if (draft.selectedEndPortalKey != null && !endPortal) {
    throw new Error("Select a valid end portal before generating a reroute.");
  }

  if (endPortal && endPortal.portalKey === startPortal.portalKey) {
    throw new Error("Start portal and end portal must be different.");
  }

  const reservedPortalKeySet = new Set(
    requiredPortals.map((portal) => portal.portalKey)
  );
  reservedPortalKeySet.add(startPortal.portalKey);

  if (endPortal) {
    reservedPortalKeySet.add(endPortal.portalKey);
  }

  if (reservedPortalKeySet.size > targetPortalCount) {
    throw new Error(
      `The start portal, end portal, and required portals need ${reservedPortalKeySet.size} route slots, but a ${missionCount}-mission reroute only has ${targetPortalCount}.`
    );
  }

  const normalizedSeedOffset =
    Number.isFinite(Number(seedOffset)) ? Number(seedOffset) >>> 0 : 0;
  const seed =
    ((Number(now) || 0) ^
      (missionCount << 8) ^
      ((draft.routeHistory?.length ?? 0) << 16) ^
      (allPortals.length << 3) ^
      normalizedSeedOffset) >>>
    0;
  const rng = createRng(seed);
  const annotatedPortals = prepareAnnotatedPortals(allPortals, startPortal);
  const candidateAnnotatedPortals = endPortal
    ? annotatedPortals.filter((portal) => portal.portalKey !== endPortal.portalKey)
    : annotatedPortals;
  const annotatedStartPortal =
    annotatedPortals.find((portal) => portal.portalKey === startPortal.portalKey) ??
    annotatedPortals[0] ??
    startPortal;
  const annotatedEndPortal = endPortal
    ? annotatedPortals.find((portal) => portal.portalKey === endPortal.portalKey) ??
      endPortal
    : null;
  const targets = getRouteTargets(missionCount, routeOptions);
  const searchAnnotatedPortals = buildDistanceFocusedPortalPool(
    candidateAnnotatedPortals,
    annotatedStartPortal,
    targetPortalCount - (annotatedEndPortal ? 1 : 0),
    targets,
    routeOptions,
    requiredPortals.map((portal) => portal.portalKey),
    annotatedEndPortal
  );
  let bestRoute = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestLoopClosureRoute = null;
  let bestLoopClosureScore = Number.POSITIVE_INFINITY;
  let bestInRangeRoute = null;
  let bestInRangeScore = Number.POSITIVE_INFINITY;
  let bestHardDistanceRoute = null;
  let bestHardDistanceScore = Number.POSITIVE_INFINITY;
  let bestHardBoundRoute = null;
  let bestHardBoundScore = Number.POSITIVE_INFINITY;
  const requiresHardDistanceBounds =
    targets.hasHardMinMeters || targets.hasHardMaxMeters;
  const requiresExpandedSearch = targets.requiresExpandedSearch;
  const strictLoopClosureRequired = routeRequiresStrictLoopClosure(routeOptions);
  const searchPlans = buildSearchPlans(targets, requiresExpandedSearch);
  const restartCount = requiresExpandedSearch ? HARD_BOUND_RESTARTS : RESTARTS;
  const attemptCount = requiresExpandedSearch ? HARD_BOUND_ATTEMPTS : ATTEMPTS;
  const baseCandidateCount = searchPlans.length * restartCount * attemptCount;
  const rejectionSummary = createCandidateRejectionSummary();
  let consideredCandidateCount = 0;
  let rejectedCandidateCount = 0;
  let uniqueCandidateCount = 0;
  let duplicateCandidateCount = 0;
  let totalCandidateCount = baseCandidateCount;
  let lastProgressTimestamp = 0;
  let isContinuingUniqueSearch = false;
  let uniqueSearchBatchCount = 0;
  const seenCandidateSignatures = new Set();

  const emitProgress = (force = false) => {
    if (typeof onProgress !== "function") {
      return;
    }

    const currentTimestamp = Date.now();

    if (
      !force &&
      currentTimestamp - lastProgressTimestamp < progressIntervalMs &&
      consideredCandidateCount < totalCandidateCount
    ) {
      return;
    }

    lastProgressTimestamp = currentTimestamp;
    onProgress({
      consideredCandidateCount,
      totalCandidateCount,
      rejectedCandidateCount,
      uniqueCandidateCount,
      duplicateCandidateCount,
      progressRatio:
        Number.isFinite(totalCandidateCount) && totalCandidateCount > 0
          ? consideredCandidateCount / totalCandidateCount
          : null,
      searchPlanCount: searchPlans.length,
      restartCount,
      attemptCount,
      isContinuingUniqueSearch,
      uniqueSearchBatchCount,
    });
  };

  emitProgress(true);

  const evaluateCandidateAttempt = (searchPlan, restartIndex, attemptIndex) => {
    let candidateRoute;

    try {
      candidateRoute = enforceExactUnique(
        buildCandidate(
          searchAnnotatedPortals,
          annotatedStartPortal,
          startPortal.portalKey,
          targets,
          rng,
          routeOptions,
          searchPlan,
          annotatedEndPortal
        ),
        searchAnnotatedPortals,
        annotatedStartPortal,
        missionCount,
        targets,
        requiredPortals.map((portal) => portal.portalKey),
        routeOptions,
        annotatedEndPortal
      );
    } catch (error) {
      recordCandidateRejection(
        rejectionSummary,
        [
          {
            code: "candidate-build-error",
            message:
              error instanceof Error
                ? error.message
                : "Candidate generation failed.",
          },
        ],
        {
          restartIndex,
          attemptIndex,
          searchPlan,
        },
        { logToConsole: logRejections }
      );
      consideredCandidateCount += 1;
      rejectedCandidateCount += 1;
      emitProgress();
      return false;
    }

    if (
      strictLoopClosureRequired &&
      !routeMatchesLoopClosure(candidateRoute, routeOptions)
    ) {
      candidateRoute = repairLoopClosure(
        candidateRoute,
        annotatedPortals,
        annotatedStartPortal,
        targets,
        requiredPortals.map((portal) => portal.portalKey),
        routeOptions,
        annotatedEndPortal?.portalKey ?? null
      );
    }

    const candidateSignature = getCandidateRouteSignature(candidateRoute);

    if (candidateSignature && seenCandidateSignatures.has(candidateSignature)) {
      consideredCandidateCount += 1;
      duplicateCandidateCount += 1;
      emitProgress();
      return false;
    }

    if (candidateSignature) {
      seenCandidateSignatures.add(candidateSignature);
    }

    uniqueCandidateCount += 1;
    const candidateScore = computeRouteScore(
      candidateRoute,
      targets,
      routeOptions
    );
    const candidateRouteDistance = getRouteDistanceMeters(
      candidateRoute,
      routeOptions
    );
    const candidateTailGapMeters = getTailGapMeters(candidateRoute);
    const candidateMeetsLoopClosure = routeMatchesLoopClosure(
      candidateRoute,
      routeOptions
    );
    const candidateMeetsHardDistanceBounds = routeMatchesHardDistanceBounds(
      candidateRouteDistance,
      targets
    );
    const candidateRejectionReasons = describeCandidateRejectionReasons(
      candidateRouteDistance,
      candidateTailGapMeters,
      targets,
      routeOptions
    );

    if (candidateRejectionReasons.length > 0) {
      recordCandidateRejection(
        rejectionSummary,
        candidateRejectionReasons,
        {
          restartIndex,
          attemptIndex,
          searchPlan,
          routeDistanceMeters: candidateRouteDistance,
          tailGapMeters: candidateTailGapMeters,
          score: candidateScore,
        },
        { logToConsole: logRejections }
      );
      rejectedCandidateCount += 1;
    }

    consideredCandidateCount += 1;
    emitProgress();

    if (candidateScore < bestScore) {
      bestRoute = candidateRoute;
      bestScore = candidateScore;
    }

    if (candidateMeetsLoopClosure && candidateScore < bestLoopClosureScore) {
      bestLoopClosureRoute = candidateRoute;
      bestLoopClosureScore = candidateScore;
    }

    if (
      candidateMeetsHardDistanceBounds &&
      candidateScore < bestHardDistanceScore
    ) {
      bestHardDistanceRoute = candidateRoute;
      bestHardDistanceScore = candidateScore;
    }

    if (
      candidateMeetsHardDistanceBounds &&
      (!strictLoopClosureRequired || candidateMeetsLoopClosure) &&
      candidateScore < bestHardBoundScore
    ) {
      bestHardBoundRoute = candidateRoute;
      bestHardBoundScore = candidateScore;
    }

    if (
      routeMatchesPreferredDistanceWindow(candidateRouteDistance, targets) &&
      candidateMeetsLoopClosure &&
      candidateScore < bestInRangeScore
    ) {
      bestInRangeRoute = candidateRoute;
      bestInRangeScore = candidateScore;
    }

    return true;
  };

  const runCandidateBatch = (batchOffset = 0) => {
    let discoveredUniqueCandidate = false;

    for (const searchPlan of searchPlans) {
      for (let restartIndex = 0; restartIndex < restartCount; restartIndex += 1) {
        for (let attemptIndex = 0; attemptIndex < attemptCount; attemptIndex += 1) {
          if (
            evaluateCandidateAttempt(
              searchPlan,
              batchOffset * restartCount + restartIndex,
              attemptIndex
            )
          ) {
            discoveredUniqueCandidate = true;
          }
        }
      }
    }

    return discoveredUniqueCandidate;
  };

  const hasAcceptableRoute = () => {
    if (requiresHardDistanceBounds) {
      return Boolean(bestHardBoundRoute);
    }

    if (strictLoopClosureRequired) {
      return Boolean(bestInRangeRoute ?? bestLoopClosureRoute);
    }

    return Boolean(bestInRangeRoute ?? bestRoute);
  };

  runCandidateBatch();

  if (!hasAcceptableRoute()) {
    totalCandidateCount = null;
    isContinuingUniqueSearch = true;
    let staleUniqueBatchCount = 0;

    while (
      staleUniqueBatchCount < UNIQUE_SEARCH_STALE_BATCH_LIMIT &&
      uniqueSearchBatchCount < maxContinuousSearchBatches
    ) {
      uniqueSearchBatchCount += 1;
      const discoveredUniqueCandidate = runCandidateBatch(uniqueSearchBatchCount);

      if (hasAcceptableRoute()) {
        break;
      }

      if (discoveredUniqueCandidate) {
        staleUniqueBatchCount = 0;
      } else {
        staleUniqueBatchCount += 1;
      }
    }
  }

  const finalRoute = requiresHardDistanceBounds
    ? bestHardBoundRoute
    : strictLoopClosureRequired
      ? bestInRangeRoute ?? bestLoopClosureRoute
      : bestInRangeRoute ?? bestRoute;

  if (rejectionSummary.totalRejectedCandidates > 0) {
    debugRouteGeneration("Candidate rejection summary.", {
      ...rejectionSummary,
      finalRouteAccepted: Boolean(finalRoute),
      selectedRouteDistanceMeters: finalRoute
        ? getRouteDistanceMeters(finalRoute, routeOptions)
        : null,
      selectedRouteTailGapMeters: finalRoute ? getTailGapMeters(finalRoute) : null,
    });
  }

  emitProgress(true);

  if (!finalRoute && requiresHardDistanceBounds) {
    throw new Error(
      strictLoopClosureRequired && bestHardDistanceRoute
        ? buildStrictLoopClosureErrorMessage(true)
        : "No reroute could satisfy the hard minimum/maximum distance constraints."
    );
  }

  if (!finalRoute && strictLoopClosureRequired) {
    throw new Error(buildStrictLoopClosureErrorMessage(false));
  }

  if (!finalRoute || finalRoute.length !== targetPortalCount) {
    throw new Error("The reroute couldn't be generated from this portal pool.");
  }

  const finalRouteDistance = getRouteDistanceMeters(finalRoute, routeOptions);

  if (
    requiresHardDistanceBounds &&
    !routeMatchesHardDistanceBounds(finalRouteDistance, targets)
  ) {
    throw new Error(
      "No reroute could satisfy the hard minimum/maximum distance constraints."
    );
  }

  if (
    strictLoopClosureRequired &&
    !routeMatchesLoopClosure(finalRoute, routeOptions)
  ) {
    throw new Error(
      buildStrictLoopClosureErrorMessage(requiresHardDistanceBounds)
    );
  }

  const routeId = `reroute-${now}`;
  const orderedPortals = finalRoute.map((portal, portalIndex) =>
    stripPortal(portal, portalIndex)
  );
  const metadata = {
    title:
      typeof draft.metadata?.title === "string" && draft.metadata.title.trim()
        ? draft.metadata.title.trim()
        : "Rerouted Banner",
    description:
      typeof draft.metadata?.description === "string"
        ? draft.metadata.description
        : "",
    missionCount,
    titleFormat: buildGeneratedTitleFormat(
      typeof draft.metadata?.title === "string" && draft.metadata.title.trim()
        ? draft.metadata.title.trim()
        : "Rerouted Banner",
      missionCount
    ),
  };

  return {
    id: routeId,
    createdAt: now,
    metadata,
    source: {
      fileName: draft.source?.fileName ?? "imported-banner.json",
      importedAt: draft.source?.importedAt ?? now,
    },
    routeOptions,
    orderedPortals,
    portalOrder: orderedPortals.map((portal) => portal.portalKey),
    missions: buildMissions(routeId, metadata, orderedPortals),
    summary: buildRouteSummary(
      draft,
      orderedPortals,
      missionCount,
      targets,
      routeOptions
    ),
    bounds: buildBounds(orderedPortals),
  };
}

export function buildRouteHistoryEntry(
  route,
  draft,
  { label = null, now = Date.now() } = {}
) {
  const nextLabel =
    typeof label === "string" && label.trim()
      ? label.trim()
      : `Reroute ${(draft.routeHistory?.length ?? 0) + 1}`;

  return {
    id: `history-${now}`,
    createdAt: now,
    label: nextLabel,
    selectedStartPortalKey: draft.selectedStartPortalKey ?? null,
    selectedEndPortalKey: draft.selectedEndPortalKey ?? null,
    excludedPortalKeys: Array.isArray(draft.excludedPortalKeys)
      ? draft.excludedPortalKeys.filter((value) => typeof value === "string")
      : [],
    requiredPortalKeys: Array.isArray(draft.requiredPortalKeys)
      ? draft.requiredPortalKeys.filter((value) => typeof value === "string")
      : [],
    routeOptions: normalizeRouteOptions(draft.routeOptions),
    summary: route.summary,
    route,
  };
}

export function restoreDraftFromHistoryEntry(draft, entry, now = Date.now()) {
  if (!draft || !entry?.route) {
    return draft;
  }

  const availablePortalKeys = new Set(
    Array.isArray(draft.portalPool)
      ? draft.portalPool.map((portal) => portal.portalKey)
      : []
  );
  const excludedPortalKeys = Array.isArray(entry.excludedPortalKeys)
    ? entry.excludedPortalKeys.filter(
        (value) => typeof value === "string" && availablePortalKeys.has(value)
      )
    : [];
  const requiredPortalKeys = Array.isArray(entry.requiredPortalKeys)
    ? entry.requiredPortalKeys.filter(
        (value) => typeof value === "string" && availablePortalKeys.has(value)
      )
    : [];

  return {
    ...draft,
    updatedAt: now,
    excludedPortalKeys,
    requiredPortalKeys,
    selectedStartPortalKey:
      typeof entry.selectedStartPortalKey === "string"
        ? entry.selectedStartPortalKey
        : draft.selectedStartPortalKey,
    selectedEndPortalKey:
      typeof entry.selectedEndPortalKey === "string"
        ? entry.selectedEndPortalKey
        : draft.selectedEndPortalKey ?? null,
    routeOptions: normalizeRouteOptions(entry.routeOptions ?? draft.routeOptions),
    metadata: entry.route.metadata
      ? {
          ...draft.metadata,
          ...entry.route.metadata,
        }
      : draft.metadata,
    currentGeneratedRoute: entry.route,
  };
}

export function buildUmmMissionSet(route, draft) {
  if (!route) {
    throw new Error("Generate a reroute before exporting it.");
  }

  return {
    fileFormatVersion: 2,
    missionSetName: route.metadata.title,
    missionSetDescription: route.metadata.description,
    currentMission: 0,
    plannedBannerLength: route.metadata.missionCount,
    titleFormat: buildUmmTitleFormat(route, draft),
    missions: route.missions.map((mission, missionIndex) => ({
      missionTitle: mission.title,
      missionDescription: route.metadata.description,
      portals: mission.portals.map((portal, portalIndex) => ({
        guid: portal.guid,
        title: portal.title,
        description: portal.description,
        imageUrl: portal.imageUrl,
        isOrnamented: false,
        isStartPoint: missionIndex === 0 && portalIndex === 0,
        location: {
          latitude: portal.latitude,
          longitude: portal.longitude,
        },
        type: "PORTAL",
        objective: {
          type: "HACK_PORTAL",
          passphrase_params: {
            question: "",
            _single_passphrase: "",
          },
        },
      })),
    })),
  };
}

export function serializeUmmMissionSet(route, draft) {
  return JSON.stringify(buildUmmMissionSet(route, draft), null, 2);
}

export function downloadUmmMissionSet(route, draft) {
  if (typeof window === "undefined") {
    return;
  }

  const serializedMissionSet = serializeUmmMissionSet(route, draft);
  const blob = new Blob([serializedMissionSet], {
    type: "application/json",
  });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = buildRouteFileName(route.metadata?.title);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
}

export function getRerouteCapacity(draft) {
  return {
    activePortalCount: countActivePortals(draft),
    maximumMissionCount: Math.floor(countActivePortals(draft) / PORTALS_PER_MISSION),
  };
}
