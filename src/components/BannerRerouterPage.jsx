import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  AltRoute,
  DeleteOutline,
  Download,
  ExpandMore,
  History,
  Restore,
  UploadFile,
} from "@mui/icons-material";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import BannerMarkers from "./BannerMarkers";
import {
  MINIMUM_MISSION_COUNT,
  LOOP_CLOSURE_MODE_NO_LOOP,
  LOOP_CLOSURE_MODE_PREFER,
  LOOP_CLOSURE_MODE_STRICT,
  PORTALS_PER_MISSION,
  countActivePortals,
  normalizeRouteOptions,
  parseUmmMissionSet,
} from "../bannerRerouter/umm";
import {
  buildRouteHistoryEntry,
  downloadUmmMissionSet,
  generateReroute,
  getActivePortals,
  restoreDraftFromHistoryEntry,
} from "../bannerRerouter/routeGenerator";
import {
  clearBannerRerouterState,
  updateBannerRerouterState,
  useBannerRerouterState,
} from "../bannerRerouterStore";

const DEFAULT_MAP_CENTER = [52.221058, 6.893297];
const PORTAL_LIST_LIMIT = 120;
const DISTANCE_INPUT_DEBOUNCE_MS = 250;
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const LOOP_CLOSURE_OPTIONS = [
  {
    value: LOOP_CLOSURE_MODE_STRICT,
    label: "Strict loop",
  },
  {
    value: LOOP_CLOSURE_MODE_PREFER,
    label: "Prefer loop",
  },
  {
    value: LOOP_CLOSURE_MODE_NO_LOOP,
    label: "No loop",
  },
];
const compactActionButtonBaseSx = {
  minWidth: 0,
  borderRadius: 1.75,
  fontWeight: 800,
  lineHeight: 1.15,
  textTransform: "none",
  boxShadow: "none",
  minHeight: 36,
  px: 1.1,
  py: 0.7,
  fontSize: { xs: "0.78rem", sm: "0.84rem" },
  "&.Mui-disabled": {
    color: "rgba(255,255,255,0.46)",
    borderColor: "rgba(255,255,255,0.1)",
    bgcolor: "rgba(255,255,255,0.05)",
  },
};
const portalActionButtonStyles = {
  required: {
    activeSx: {
      color: "#eef7ff",
      bgcolor: "#245074",
      borderColor: "rgba(146, 214, 255, 0.42)",
      "&:hover": {
        bgcolor: "#2a608d",
      },
    },
    idleSx: {
      color: "#cde6ff",
      borderColor: "rgba(146, 214, 255, 0.24)",
      bgcolor: "rgba(20, 35, 48, 0.44)",
      "&:hover": {
        borderColor: "rgba(146, 214, 255, 0.38)",
        bgcolor: "rgba(34, 58, 80, 0.6)",
      },
    },
  },
  disabled: {
    activeSx: {
      color: "#fff1f1",
      bgcolor: "#7a2b2b",
      borderColor: "rgba(255, 170, 170, 0.42)",
      "&:hover": {
        bgcolor: "#903535",
      },
    },
    idleSx: {
      color: "#ffd6d6",
      borderColor: "rgba(255, 170, 170, 0.24)",
      bgcolor: "rgba(46, 22, 22, 0.42)",
      "&:hover": {
        borderColor: "rgba(255, 170, 170, 0.38)",
        bgcolor: "rgba(76, 34, 34, 0.58)",
      },
    },
  },
  delete: {
    idleSx: {
      color: "#ffd6d6",
      borderColor: "rgba(255, 170, 170, 0.24)",
      bgcolor: "rgba(46, 22, 22, 0.42)",
      "&:hover": {
        borderColor: "rgba(255, 170, 170, 0.38)",
        bgcolor: "rgba(76, 34, 34, 0.58)",
      },
    },
  },
};

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatPercentage(value) {
  if (!Number.isFinite(value)) {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
}

function getNormalizedMissionCountLimit(portalCount) {
  const maxMissionCount = Math.floor(portalCount / PORTALS_PER_MISSION);
  return maxMissionCount - (maxMissionCount % PORTALS_PER_MISSION);
}

function getPortalSearchText(portal) {
  return [
    portal.title,
    portal.sourceMissionTitle,
    portal.guid,
    portal.portalKey,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function comparePortalsByTitle(leftPortal, rightPortal) {
  const titleComparison = (leftPortal?.title ?? "").localeCompare(
    rightPortal?.title ?? "",
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    }
  );

  if (titleComparison !== 0) {
    return titleComparison;
  }

  return (leftPortal?.sourceOrderIndex ?? 0) - (rightPortal?.sourceOrderIndex ?? 0);
}

function formatDistanceKilometers(valueInMeters) {
  if (!Number.isFinite(valueInMeters)) {
    return "";
  }

  return String(valueInMeters / 1000);
}

function parseDistanceKilometersInput(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const numericKilometers = Number(value);

  if (!Number.isFinite(numericKilometers) || numericKilometers <= 0) {
    return null;
  }

  return numericKilometers * 1000;
}

function buildDistanceRouteOptions(baseRouteOptions, distanceInputs) {
  return {
    ...normalizeRouteOptions(baseRouteOptions),
    minLoopDistanceMeters: parseDistanceKilometersInput(distanceInputs?.min),
    maxLoopDistanceMeters: parseDistanceKilometersInput(distanceInputs?.max),
  };
}

function getRouteSummaryDistanceModeLabel(summary) {
  if (summary?.distanceModeLabel) {
    return summary.distanceModeLabel;
  }

  return summary?.loopClosureMode === "no-loop" ||
    summary?.loopClosureMode === "allow-open"
    ? "Path"
    : "Loop";
}

function getRouteSummaryDistanceLabel(summary) {
  return (
    summary?.distanceLabel ??
    summary?.loopDistanceLabel ??
    summary?.pathDistanceLabel ??
    "Distance unavailable"
  );
}

function getRouteSummaryTargetWindowTypeLabel(summary) {
  return (
    summary?.targetWindowTypeLabel ??
    `${getRouteSummaryDistanceModeLabel(summary).toLowerCase()} distance`
  );
}

function formatElapsedDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "0s";
  }

  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${totalSeconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function buildGenerationStatusLines(routeOptions, elapsedMilliseconds) {
  const normalizedRouteOptions = normalizeRouteOptions(routeOptions);
  const detailLines = [
    "Generating reroutes...",
  ];

  if (normalizedRouteOptions.loopClosureMode === LOOP_CLOSURE_MODE_STRICT) {
    detailLines.push("Strict loop closure is enabled, so the generator is testing extra closing variants.");
  } else if (normalizedRouteOptions.loopClosureMode === LOOP_CLOSURE_MODE_NO_LOOP) {
    detailLines.push("No-loop mode is enabled, so the generator is building an open route instead of forcing a return to the start.");
  }

  if (
    Number.isFinite(normalizedRouteOptions.minLoopDistanceMeters) ||
    Number.isFinite(normalizedRouteOptions.maxLoopDistanceMeters)
  ) {
    detailLines.push("Hard distance limits are enabled, which adds more candidate checks.");
  }

  if (elapsedMilliseconds >= 5000) {
    detailLines.push("Still exploring route variants. Tight constraints can take longer, especially with strict loop closure or required portals.");
  }

  return detailLines;
}

function buildCandidateProgressLabel(progress) {
  if (!progress || !Number.isFinite(progress.consideredCandidateCount)) {
    return null;
  }

  const uniqueCandidateText = Number.isFinite(progress.uniqueCandidateCount)
    ? ` Found ${progress.uniqueCandidateCount.toLocaleString()} unique ${
        progress.uniqueCandidateCount === 1 ? "route" : "routes"
      } so far.`
    : "";

  if (
    Number.isFinite(progress.totalCandidateCount) &&
    progress.totalCandidateCount > 0
  ) {
    return `Considered ${progress.consideredCandidateCount.toLocaleString()} of ${progress.totalCandidateCount.toLocaleString()} candidate routes so far.${uniqueCandidateText}`;
  }

  if (progress.isContinuingUniqueSearch) {
    return `Considered ${progress.consideredCandidateCount.toLocaleString()} candidate routes so far.${uniqueCandidateText} Still searching new unique route variants until you cancel or the search runs out of new options.`;
  }

  return `Considered ${progress.consideredCandidateCount.toLocaleString()} candidate routes so far.${uniqueCandidateText}`;
}

function buildSearchWorkerLabel(progress) {
  if (!progress || !Number.isFinite(progress.shardCount) || progress.shardCount <= 0) {
    return null;
  }

  return `Using ${progress.shardCount.toLocaleString()} parallel search ${
    progress.shardCount === 1 ? "worker" : "workers"
  }.`;
}

function buildDraftFromImport(importedDraft, now = Date.now()) {
  return {
    id: `rerouter-draft-${now}`,
    createdAt: now,
    updatedAt: now,
    source: importedDraft.source,
    metadata: importedDraft.metadata,
    importedMissionSet: importedDraft.importedMissionSet,
    portalPool: importedDraft.portalPool,
    importSummary: importedDraft.importSummary,
    excludedPortalKeys: [],
    requiredPortalKeys: [],
    selectedStartPortalKey: importedDraft.selectedStartPortalKey,
    selectedEndPortalKey: importedDraft.selectedEndPortalKey ?? null,
    routeOptions: importedDraft.routeOptions,
    currentGeneratedRoute: null,
    routeHistory: [],
  };
}

function readLocalFileText(file) {
  if (file && typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();

    fileReader.onload = () => {
      resolve(typeof fileReader.result === "string" ? fileReader.result : "");
    };
    fileReader.onerror = () => {
      reject(new Error("The selected file couldn't be read."));
    };
    fileReader.readAsText(file);
  });
}

function normalizeExcludedPortalKeys(portalPool, excludedPortalKeys) {
  const availablePortalKeys = new Set(
    portalPool
      .map((portal) => portal?.portalKey)
      .filter((portalKey) => typeof portalKey === "string")
  );

  return Array.from(
    new Set(
      Array.isArray(excludedPortalKeys)
        ? excludedPortalKeys.filter(
            (portalKey) =>
              typeof portalKey === "string" && availablePortalKeys.has(portalKey)
          )
        : []
    )
  );
}

function normalizeRequiredPortalKeys(portalPool, requiredPortalKeys) {
  const availablePortalKeys = new Set(
    portalPool
      .map((portal) => portal?.portalKey)
      .filter((portalKey) => typeof portalKey === "string")
  );

  return Array.from(
    new Set(
      Array.isArray(requiredPortalKeys)
        ? requiredPortalKeys.filter(
            (portalKey) =>
              typeof portalKey === "string" && availablePortalKeys.has(portalKey)
          )
        : []
    )
  );
}

function finalizeDraft(nextDraft) {
  if (!nextDraft) {
    return nextDraft;
  }

  const portalPool = Array.isArray(nextDraft.portalPool) ? nextDraft.portalPool : [];
  const requiredPortalKeys = normalizeRequiredPortalKeys(
    portalPool,
    nextDraft.requiredPortalKeys
  );
  const excludedPortalKeys = normalizeExcludedPortalKeys(
    portalPool,
    nextDraft.excludedPortalKeys
  ).filter((portalKey) => !requiredPortalKeys.includes(portalKey));
  const excludedPortalKeySet = new Set(excludedPortalKeys);
  const activePortals = portalPool.filter(
    (portal) => !excludedPortalKeySet.has(portal.portalKey)
  );
  const selectedStartPortalKey = activePortals.some(
    (portal) => portal.portalKey === nextDraft.selectedStartPortalKey
  )
    ? nextDraft.selectedStartPortalKey
    : activePortals[0]?.portalKey ?? null;
  const selectedEndPortalKey = activePortals.some(
    (portal) =>
      portal.portalKey === nextDraft.selectedEndPortalKey &&
      portal.portalKey !== selectedStartPortalKey
  )
    ? nextDraft.selectedEndPortalKey
    : null;

  return {
    ...nextDraft,
    updatedAt: Date.now(),
    excludedPortalKeys,
    requiredPortalKeys,
    selectedStartPortalKey,
    selectedEndPortalKey,
    routeOptions: normalizeRouteOptions(nextDraft.routeOptions),
    importSummary: {
      ...(nextDraft.importSummary ?? {}),
      uniquePortalCount: portalPool.length,
      activePortalCount: activePortals.length,
      excludedPortalCount: excludedPortalKeys.length,
    },
  };
}

function getActiveDraft(rerouterState) {
  if (!rerouterState?.activeDraftId) {
    return null;
  }

  return rerouterState.drafts?.[rerouterState.activeDraftId] ?? null;
}

function PreviewBoundsController({ coordinates }) {
  const map = useMap();

  useEffect(() => {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      return;
    }

    const bounds = L.latLngBounds(coordinates);
    map.fitBounds(bounds, {
      padding: [32, 32],
      animate: false,
    });
  }, [coordinates, map]);

  return null;
}

export default function BannerRerouterPage() {
  const fileInputRef = useRef(null);
  const distanceCommitTimeoutRef = useRef(null);
  const generationWorkerRef = useRef(null);
  const generationTimeoutRef = useRef(null);
  const generationRequestIdRef = useRef(0);
  const rerouterState = useBannerRerouterState();
  const activeDraft = getActiveDraft(rerouterState);
  const [portalQuery, setPortalQuery] = useState("");
  const [importError, setImportError] = useState("");
  const [actionError, setActionError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isGeneratingRoute, setIsGeneratingRoute] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [generationRouteOptions, setGenerationRouteOptions] = useState(null);
  const [generationProgress, setGenerationProgress] = useState(null);
  const [distanceInputs, setDistanceInputs] = useState({
    min: "",
    max: "",
  });
  const activePortalCount = countActivePortals(activeDraft);
  const requiredPortalSelectionCount = activeDraft?.requiredPortalKeys?.length ?? 0;
  const reservedPortalSelectionCount = useMemo(() => {
    const reservedPortalKeys = new Set(
      Array.isArray(activeDraft?.requiredPortalKeys)
        ? activeDraft.requiredPortalKeys
        : []
    );

    if (typeof activeDraft?.selectedStartPortalKey === "string") {
      reservedPortalKeys.add(activeDraft.selectedStartPortalKey);
    }

    if (typeof activeDraft?.selectedEndPortalKey === "string") {
      reservedPortalKeys.add(activeDraft.selectedEndPortalKey);
    }

    return reservedPortalKeys.size;
  }, [
    activeDraft?.requiredPortalKeys,
    activeDraft?.selectedEndPortalKey,
    activeDraft?.selectedStartPortalKey,
  ]);
  const disabledPortalCount = Math.max(
    0,
    (activeDraft?.portalPool?.length ?? 0) - activePortalCount
  );
  const maximumMissionCount = getNormalizedMissionCountLimit(
    activePortalCount
  );
  const requiredPortalCount = activeDraft
    ? Number(activeDraft.metadata?.missionCount ?? 0) * PORTALS_PER_MISSION
    : 0;
  const activePortals = useMemo(() => getActivePortals(activeDraft), [activeDraft]);
  const excludedPortalKeySet = useMemo(
    () =>
      new Set(
        Array.isArray(activeDraft?.excludedPortalKeys)
          ? activeDraft.excludedPortalKeys
          : []
      ),
    [activeDraft]
  );
  const requiredPortalKeySet = useMemo(
    () =>
      new Set(
        Array.isArray(activeDraft?.requiredPortalKeys)
          ? activeDraft.requiredPortalKeys
          : []
      ),
    [activeDraft]
  );
  const routeOptions = useMemo(
    () => normalizeRouteOptions(activeDraft?.routeOptions),
    [activeDraft]
  );
  const pendingRouteOptions = useMemo(
    () => buildDistanceRouteOptions(routeOptions, distanceInputs),
    [distanceInputs, routeOptions]
  );
  const hasInvalidDistanceWindow =
    Number.isFinite(pendingRouteOptions.minLoopDistanceMeters) &&
    Number.isFinite(pendingRouteOptions.maxLoopDistanceMeters) &&
    pendingRouteOptions.minLoopDistanceMeters >
      pendingRouteOptions.maxLoopDistanceMeters;
  const hasTooManyRequiredPortals =
    reservedPortalSelectionCount > requiredPortalCount;
  const isWorkspaceBusy = isImporting || isGeneratingRoute;
  const sortedStartPortals = useMemo(
    () => activePortals.slice().sort(comparePortalsByTitle),
    [activePortals]
  );
  const sortedEndPortals = useMemo(
    () =>
      activePortals
        .filter((portal) => portal.portalKey !== activeDraft?.selectedStartPortalKey)
        .slice()
        .sort(comparePortalsByTitle),
    [activeDraft?.selectedStartPortalKey, activePortals]
  );
  const missionCountOptions = useMemo(() => {
    if (!activeDraft) {
      return [];
    }

    const options = [];

    for (
      let missionCount = MINIMUM_MISSION_COUNT;
      missionCount <= maximumMissionCount;
      missionCount += MINIMUM_MISSION_COUNT
    ) {
      options.push(missionCount);
    }

    if (
      Number.isFinite(activeDraft.metadata?.missionCount) &&
      !options.includes(activeDraft.metadata.missionCount)
    ) {
      options.push(activeDraft.metadata.missionCount);
      options.sort((leftValue, rightValue) => leftValue - rightValue);
    }

    return options;
  }, [activeDraft, maximumMissionCount]);
  const filteredPortals = useMemo(() => {
    if (!activeDraft) {
      return [];
    }

    const normalizedQuery = portalQuery.trim().toLowerCase();

    return (activeDraft.portalPool ?? []).filter((portal) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        getPortalSearchText(portal).includes(normalizedQuery);

      return matchesQuery;
    });
  }, [activeDraft, portalQuery]);
  const visiblePortals = filteredPortals.slice(0, PORTAL_LIST_LIMIT);
  const previewMissions = activeDraft?.currentGeneratedRoute?.missions ?? [];
  const previewCoordinates = previewMissions.flatMap((mission) =>
    mission.portals.map((portal) => [portal.latitude, portal.longitude])
  );
  const hasEnoughPortals = !activeDraft || activePortalCount >= requiredPortalCount;
  const canGenerateRoute =
    !isWorkspaceBusy &&
    hasEnoughPortals &&
    !hasInvalidDistanceWindow &&
    !hasTooManyRequiredPortals;
  const currentRoute = activeDraft?.currentGeneratedRoute ?? null;
  const generationStatusLines = useMemo(
    () => buildGenerationStatusLines(generationRouteOptions, generationElapsedMs),
    [generationElapsedMs, generationRouteOptions]
  );
  const candidateProgressLabel = useMemo(
    () => buildCandidateProgressLabel(generationProgress),
    [generationProgress]
  );
  const searchWorkerLabel = useMemo(
    () => buildSearchWorkerLabel(generationProgress),
    [generationProgress]
  );
  const [isResetWorkspaceDialogOpen, setIsResetWorkspaceDialogOpen] = useState(false);
  const [isCurrentRouteExpanded, setIsCurrentRouteExpanded] = useState(true);

  useEffect(() => {
    if (distanceCommitTimeoutRef.current !== null) {
      window.clearTimeout(distanceCommitTimeoutRef.current);
      distanceCommitTimeoutRef.current = null;
    }

    setDistanceInputs({
      min: formatDistanceKilometers(routeOptions.minLoopDistanceMeters),
      max: formatDistanceKilometers(routeOptions.maxLoopDistanceMeters),
    });
  }, [
    activeDraft?.id,
    routeOptions.maxLoopDistanceMeters,
    routeOptions.minLoopDistanceMeters,
  ]);

  useEffect(() => {
    if (currentRoute) {
      setIsCurrentRouteExpanded(true);
    }
  }, [currentRoute]);

  useEffect(() => {
    if (!isGeneratingRoute || !Number.isFinite(generationStartedAt)) {
      setGenerationElapsedMs(0);
      return undefined;
    }

    const updateElapsed = () => {
      setGenerationElapsedMs(Date.now() - generationStartedAt);
    };

    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [generationStartedAt, isGeneratingRoute]);

  const historyEntries = useMemo(() => {
    if (!activeDraft?.routeHistory) {
      return [];
    }

    return [...activeDraft.routeHistory].sort(
      (leftEntry, rightEntry) => rightEntry.createdAt - leftEntry.createdAt
    );
  }, [activeDraft]);

  const replaceActiveDraft = (updater) => {
    let finalizedDraftResult = null;

    updateBannerRerouterState((currentState) => {
      const draft = getActiveDraft(currentState);

      if (!draft) {
        return currentState;
      }

      const nextDraft = typeof updater === "function" ? updater(draft) : updater;

      if (!nextDraft) {
        return currentState;
      }

      const finalizedDraft = finalizeDraft(nextDraft);
      finalizedDraftResult = finalizedDraft;

      return {
        ...currentState,
        activeDraftId: finalizedDraft.id,
        drafts: {
          ...currentState.drafts,
          [finalizedDraft.id]: finalizedDraft,
        },
      };
    });

    return finalizedDraftResult;
  };

  const clearDistanceCommitTimeout = () => {
    if (distanceCommitTimeoutRef.current !== null) {
      window.clearTimeout(distanceCommitTimeoutRef.current);
      distanceCommitTimeoutRef.current = null;
    }
  };

  const commitDistanceInputs = (
    nextDistanceInputs,
    { clearCurrentRoute = true } = {}
  ) => {
    clearDistanceCommitTimeout();

    if (!activeDraft) {
      return null;
    }

    return replaceActiveDraft((draft) => ({
      ...draft,
      routeOptions: buildDistanceRouteOptions(draft.routeOptions, nextDistanceInputs),
      currentGeneratedRoute: clearCurrentRoute ? null : draft.currentGeneratedRoute,
    }));
  };

  const clearPendingGeneration = () => {
    if (generationWorkerRef.current) {
      generationWorkerRef.current.onmessage = null;
      generationWorkerRef.current.onerror = null;
      generationWorkerRef.current.terminate();
      generationWorkerRef.current = null;
    }

    if (generationTimeoutRef.current !== null) {
      window.clearTimeout(generationTimeoutRef.current);
      generationTimeoutRef.current = null;
    }
  };

  const finishGenerationState = () => {
    clearPendingGeneration();
    setIsGeneratingRoute(false);
    setGenerationStartedAt(null);
    setGenerationElapsedMs(0);
    setGenerationRouteOptions(null);
    setGenerationProgress(null);
  };

  useEffect(() => {
    return () => {
      generationRequestIdRef.current += 1;
      clearDistanceCommitTimeout();
      clearPendingGeneration();
    };
  }, []);

  const openImportPicker = () => {
    if (isWorkspaceBusy) {
      return;
    }

    fileInputRef.current?.click();
  };

  const handleImportChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (isGeneratingRoute) {
      return;
    }

    clearDistanceCommitTimeout();
    setImportError("");
    setActionError("");
    setIsImporting(true);

    try {
      const fileContents = await readLocalFileText(file);
      const importedDraft = parseUmmMissionSet(fileContents, file.name);
      const createdDraft = finalizeDraft(buildDraftFromImport(importedDraft));

      updateBannerRerouterState(() => ({
        version: 1,
        activeDraftId: createdDraft.id,
        drafts: {
          [createdDraft.id]: createdDraft,
        },
      }));
      setPortalQuery("");
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "The banner couldn't be imported."
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleMetadataFieldChange = (fieldName, nextValue) => {
    if (isGeneratingRoute) {
      return;
    }

    replaceActiveDraft((draft) => ({
      ...draft,
      metadata: {
        ...draft.metadata,
        [fieldName]: nextValue,
      },
      currentGeneratedRoute: null,
    }));
  };

  const handleRouteOptionChange = (fieldName, nextValue) => {
    if (isGeneratingRoute) {
      return;
    }

    replaceActiveDraft((draft) => ({
      ...draft,
      routeOptions: {
        ...normalizeRouteOptions(draft.routeOptions),
        [fieldName]: nextValue,
      },
      currentGeneratedRoute: null,
    }));
  };

  const handleGenerateRoute = () => {
    if (!activeDraft || isGeneratingRoute) {
      return;
    }

    setActionError("");
    const requestId = generationRequestIdRef.current + 1;
    const generationNow = Date.now();
    const draftSnapshot =
      commitDistanceInputs(distanceInputs, {
        clearCurrentRoute: false,
      }) ?? {
        ...activeDraft,
        routeOptions: pendingRouteOptions,
      };

    generationRequestIdRef.current = requestId;
    clearPendingGeneration();
    setIsGeneratingRoute(true);
    setGenerationStartedAt(generationNow);
    setGenerationElapsedMs(0);
    setGenerationRouteOptions(draftSnapshot.routeOptions);
    setGenerationProgress({
      consideredCandidateCount: 0,
      totalCandidateCount: null,
      rejectedCandidateCount: 0,
      progressRatio: 0,
    });

    const handleGenerationSuccess = (generatedRoute) => {
      if (generationRequestIdRef.current !== requestId) {
        return;
      }

      const historyEntry = buildRouteHistoryEntry(generatedRoute, draftSnapshot, {
        now: generationNow,
      });

      replaceActiveDraft((draft) => {
        if (draft.id !== draftSnapshot.id) {
          return draft;
        }

        return {
          ...draft,
          currentGeneratedRoute: generatedRoute,
          routeHistory: [...(draft.routeHistory ?? []), historyEntry],
        };
      });
      finishGenerationState();
    };

    const handleGenerationError = (errorMessage) => {
      if (generationRequestIdRef.current !== requestId) {
        return;
      }

      setActionError(
        errorMessage || "The reroute couldn't be generated."
      );
      finishGenerationState();
    };

    if (typeof Worker === "function") {
      try {
        const worker = new Worker(
          new URL("../bannerRerouter/routeGenerator.worker.js", import.meta.url),
          { type: "module" }
        );

        generationWorkerRef.current = worker;
        worker.onmessage = (event) => {
          const message = event.data ?? {};

          if (message.type === "progress") {
            setGenerationProgress(message.progress ?? null);
            return;
          }

          if (message.type === "success") {
            handleGenerationSuccess(message.route);
            return;
          }

          handleGenerationError(message.message);
        };
        worker.onerror = () => {
          handleGenerationError(
            "The reroute worker failed before it could finish."
          );
        };
        worker.postMessage({
          type: "generate",
          draft: draftSnapshot,
          now: generationNow,
        });

        return;
      } catch (error) {
        clearPendingGeneration();
      }
    }

    generationTimeoutRef.current = window.setTimeout(() => {
      generationTimeoutRef.current = null;

      try {
        handleGenerationSuccess(
          generateReroute(draftSnapshot, {
            now: generationNow,
            onProgress(progress) {
              setGenerationProgress(progress);
            },
          })
        );
      } catch (error) {
        handleGenerationError(
          error instanceof Error
            ? error.message
            : "The reroute couldn't be generated."
        );
      }
    }, 0);
  };

  const handleCancelRouteGeneration = () => {
    if (!isGeneratingRoute) {
      return;
    }

    generationRequestIdRef.current += 1;
    finishGenerationState();
  };

  const handleRestoreHistoryEntry = (entry) => {
    if (isGeneratingRoute) {
      return;
    }

    replaceActiveDraft((draft) =>
      restoreDraftFromHistoryEntry(draft, entry, Date.now())
    );
    setActionError("");
  };

  const handleTogglePortalDisabled = (portalKey) => {
    if (isGeneratingRoute) {
      return;
    }

    replaceActiveDraft((draft) => {
      const excludedPortalKeys = new Set(draft.excludedPortalKeys ?? []);
      const requiredPortalKeys = new Set(draft.requiredPortalKeys ?? []);

      if (excludedPortalKeys.has(portalKey)) {
        excludedPortalKeys.delete(portalKey);
      } else {
        requiredPortalKeys.delete(portalKey);
        excludedPortalKeys.add(portalKey);
      }

      return {
        ...draft,
        excludedPortalKeys: Array.from(excludedPortalKeys),
        requiredPortalKeys: Array.from(requiredPortalKeys),
        currentGeneratedRoute: null,
      };
    });
    setActionError("");
  };

  const handleTogglePortalRequired = (portalKey) => {
    if (isGeneratingRoute) {
      return;
    }

    replaceActiveDraft((draft) => {
      const excludedPortalKeys = new Set(draft.excludedPortalKeys ?? []);
      const requiredPortalKeys = new Set(draft.requiredPortalKeys ?? []);

      if (requiredPortalKeys.has(portalKey)) {
        requiredPortalKeys.delete(portalKey);
      } else {
        excludedPortalKeys.delete(portalKey);
        requiredPortalKeys.add(portalKey);
      }

      return {
        ...draft,
        excludedPortalKeys: Array.from(excludedPortalKeys),
        requiredPortalKeys: Array.from(requiredPortalKeys),
        currentGeneratedRoute: null,
      };
    });
    setActionError("");
  };

  const handleDeletePortal = (portalKey) => {
    if (isGeneratingRoute) {
      return;
    }

    replaceActiveDraft((draft) => ({
      ...draft,
      portalPool: (draft.portalPool ?? []).filter(
        (portal) => portal.portalKey !== portalKey
      ),
      excludedPortalKeys: (draft.excludedPortalKeys ?? []).filter(
        (excludedPortalKey) => excludedPortalKey !== portalKey
      ),
      requiredPortalKeys: (draft.requiredPortalKeys ?? []).filter(
        (requiredPortalKey) => requiredPortalKey !== portalKey
      ),
      currentGeneratedRoute: null,
    }));
    setActionError("");
  };

  const handleDeleteHistoryEntry = (entryId) => {
    if (isGeneratingRoute) {
      return;
    }

    replaceActiveDraft((draft) => ({
      ...draft,
      routeHistory: (draft.routeHistory ?? []).filter(
        (entry) => entry.id !== entryId
      ),
      currentGeneratedRoute:
        draft.currentGeneratedRoute?.id ===
        (draft.routeHistory ?? []).find((entry) => entry.id === entryId)?.route?.id
          ? null
          : draft.currentGeneratedRoute,
    }));
  };

  const handleExportCurrentRoute = () => {
    if (isGeneratingRoute) {
      return;
    }

    setActionError("");

    try {
      downloadUmmMissionSet(currentRoute, activeDraft);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The reroute couldn't be exported."
      );
    }
  };

  const handleResetWorkspace = () => {
    setIsResetWorkspaceDialogOpen(true);
  };

  const handleCloseResetWorkspaceDialog = () => {
    setIsResetWorkspaceDialogOpen(false);
  };

  const handleConfirmResetWorkspace = () => {
    generationRequestIdRef.current += 1;
    clearDistanceCommitTimeout();
    finishGenerationState();
    clearBannerRerouterState();
    setPortalQuery("");
    setImportError("");
    setActionError("");
    setIsResetWorkspaceDialogOpen(false);
  };

  return (
    <Box
      sx={{
        width: "100%",
        flex: 1,
        px: { xs: 1.5, sm: 2.5, lg: 3.5 },
        py: { xs: 2, sm: 2.5 },
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.umm,.txt"
        aria-label="Import banner UMM file"
        data-testid="rerouter-file-input"
        disabled={isWorkspaceBusy}
        hidden
        onChange={handleImportChange}
      />

      <Stack spacing={2.5}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, sm: 3 },
            border: "1px solid rgba(255,255,255,0.08)",
            background:
              "linear-gradient(135deg, rgba(143,163,181,0.18), rgba(20,27,33,0.92) 60%)",
          }}
        >
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
          >
            <Box>
              <Typography variant="h4">Banner Rerouter</Typography>
              <Typography
                variant="body1"
                color="text.secondary"
                sx={{ maxWidth: 780, mt: 1 }}
              >
                Import an existing banner from an Ultimate Mission Maker (UMM) export, choose a start portal, optional
                end portal, and mission count, generate a reroute, and export the result back to
                UMM. All data you import stays on your machine and is not sent to OpenBanners and will never be.
              </Typography>
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
              <Button
                variant="contained"
                startIcon={<UploadFile />}
                onClick={openImportPicker}
                disabled={isWorkspaceBusy}
              >
                {activeDraft ? "Import another banner" : "Import banner UMM"}
              </Button>
              {activeDraft ? (
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<DeleteOutline />}
                  onClick={handleResetWorkspace}
                  disabled={isWorkspaceBusy}
                >
                  Clear workspace
                </Button>
              ) : null}
            </Stack>
          </Stack>
        </Paper>

        {importError ? <Alert severity="error">{importError}</Alert> : null}
        {actionError ? <Alert severity="error">{actionError}</Alert> : null}
        <Dialog
          open={isResetWorkspaceDialogOpen}
          onClose={handleCloseResetWorkspaceDialog}
          aria-labelledby="rerouter-reset-workspace-title"
        >
          <DialogTitle id="rerouter-reset-workspace-title">
            Clear workspace?
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              This removes the imported banner, the current reroute, and the saved
              route history from this local workspace.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseResetWorkspaceDialog} color="inherit">
              Cancel
            </Button>
            <Button
              onClick={handleConfirmResetWorkspace}
              color="error"
              variant="contained"
              startIcon={<DeleteOutline />}
            >
              Clear workspace
            </Button>
          </DialogActions>
        </Dialog>
        {isGeneratingRoute ? (
          <Alert
            severity="info"
            icon={<CircularProgress color="inherit" size={18} thickness={5} />}
            sx={{
              alignItems: "center",
              alignSelf: "center",
              width: "min(100%, 960px)",
              textAlign: "center",
              "& .MuiAlert-icon": {
                alignItems: "center",
              },
              "& .MuiAlert-message": {
                width: "100%",
              },
            }}
          >
            <Stack spacing={1} aria-live="polite" alignItems="center">
              <Typography fontWeight={700}>Generating reroute locally...</Typography>
              {searchWorkerLabel ? (
                <Typography variant="body2">{searchWorkerLabel}</Typography>
              ) : null}
              {generationStatusLines.map((statusLine) => (
                <Typography key={statusLine} variant="body2">
                  {statusLine}
                </Typography>
              ))}
              {candidateProgressLabel ? (
                <Typography variant="body2">{candidateProgressLabel}</Typography>
              ) : null}
              {generationProgress &&
              Number.isFinite(generationProgress.rejectedCandidateCount) ? (
                <Typography variant="body2" color="text.secondary">
                  Rejected {generationProgress.rejectedCandidateCount.toLocaleString()}{" "}
                  candidate
                  {generationProgress.rejectedCandidateCount === 1 ? "" : "s"} so
                  far.
                </Typography>
              ) : null}
              {generationProgress &&
              Number.isFinite(generationProgress.totalCandidateCount) &&
              generationProgress.totalCandidateCount > 0 ? (
                <LinearProgress
                  variant="determinate"
                  value={Math.max(
                    0,
                    Math.min(100, (generationProgress.progressRatio ?? 0) * 100)
                  )}
                  sx={{
                    borderRadius: 999,
                    bgcolor: "rgba(255,255,255,0.12)",
                    "& .MuiLinearProgress-bar": {
                      borderRadius: 999,
                    },
                  }}
                />
              ) : generationProgress?.isContinuingUniqueSearch ? (
                <LinearProgress
                  sx={{
                    borderRadius: 999,
                    bgcolor: "rgba(255,255,255,0.12)",
                    "& .MuiLinearProgress-bar": {
                      borderRadius: 999,
                    },
                  }}
                />
              ) : null}
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "center" }}
              >
                <Typography variant="body2" color="text.secondary">
                  Elapsed {formatElapsedDuration(generationElapsedMs)}. You can
                  keep this page open or cancel generation to change the draft.
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  onClick={handleCancelRouteGeneration}
                >
                  Cancel generation
                </Button>
              </Stack>
            </Stack>
          </Alert>
        ) : null}

        {activeDraft ? (
          <Stack spacing={2.5}>
            <Box
              sx={{
                display: "grid",
                gap: 2.5,
                gridTemplateColumns: {
                  xs: "1fr",
                  xl: "minmax(0, 1.05fr) minmax(0, 1fr)",
                },
                alignItems: "start",
              }}
            >
              <Stack spacing={2.5}>
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 2, sm: 2.5 },
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="h5">
                      {activeDraft.metadata?.title || "Rerouted Banner"}
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                      Imported from {activeDraft.source?.fileName || "UMM file"} on{" "}
                      {formatTimestamp(activeDraft.source?.importedAt)}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip
                      label={`${activeDraft.importSummary?.importedMissionCount ?? 0} imported missions`}
                    />
                    <Chip
                      label={`${activeDraft.importSummary?.uniquePortalCount ?? 0} unique portals`}
                    />
                    <Chip label={`${activePortalCount} active portals`} color="primary" />
                    {disabledPortalCount > 0 ? (
                      <Chip label={`${disabledPortalCount} disabled`} />
                    ) : null}
                    {requiredPortalSelectionCount > 0 ? (
                      <Chip label={`${requiredPortalSelectionCount} required`} />
                    ) : null}
                  </Stack>
                  {(activeDraft.importedMissionSet?.missionSetDescription ?? "").trim() ? (
                    <Typography color="text.secondary">
                      {activeDraft.importedMissionSet.missionSetDescription}
                    </Typography>
                  ) : null}
                </Stack>
              </Paper>

              <Paper
                elevation={0}
                sx={{
                  p: { xs: 2, sm: 2.5 },
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Stack spacing={2}>
                  <Typography variant="h6">Reroute settings</Typography>
                  <TextField
                    label="Banner title"
                    value={activeDraft.metadata?.title ?? ""}
                    onChange={(event) =>
                      handleMetadataFieldChange("title", event.target.value)
                    }
                    disabled={isGeneratingRoute}
                    fullWidth
                  />
                  <TextField
                    label="Banner description"
                    value={activeDraft.metadata?.description ?? ""}
                    onChange={(event) =>
                      handleMetadataFieldChange("description", event.target.value)
                    }
                    multiline
                    minRows={3}
                    disabled={isGeneratingRoute}
                    fullWidth
                  />
                  <Box
                    sx={{
                      display: "grid",
                      gap: 1.5,
                      gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                    }}
                  >
                    <TextField
                      select
                      label="Banner length"
                      value={activeDraft.metadata?.missionCount ?? ""}
                      onChange={(event) =>
                        handleMetadataFieldChange(
                          "missionCount",
                          Number(event.target.value)
                        )
                      }
                      disabled={isGeneratingRoute}
                      helperText="Mission counts stay in Ingress banner increments of six."
                    >
                      {missionCountOptions.map((missionCount) => (
                        <MenuItem key={missionCount} value={missionCount}>
                          {missionCount} missions
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      label="Start portal"
                      value={activeDraft.selectedStartPortalKey ?? ""}
                      onChange={(event) =>
                        replaceActiveDraft((draft) => ({
                          ...draft,
                          selectedStartPortalKey: event.target.value,
                          currentGeneratedRoute: null,
                        }))
                      }
                      disabled={isGeneratingRoute}
                      helperText="The reroute is anchored to this portal."
                    >
                      {sortedStartPortals.map((portal) => (
                        <MenuItem key={portal.portalKey} value={portal.portalKey}>
                          {portal.title}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      label="End portal"
                      value={activeDraft.selectedEndPortalKey ?? ""}
                      onChange={(event) =>
                        replaceActiveDraft((draft) => ({
                          ...draft,
                          selectedEndPortalKey: event.target.value || null,
                          currentGeneratedRoute: null,
                        }))
                      }
                      disabled={isGeneratingRoute}
                      helperText="Optional. If set, this portal must be the final portal in the reroute."
                    >
                      <MenuItem value="">-</MenuItem>
                      {sortedEndPortals.map((portal) => (
                        <MenuItem key={portal.portalKey} value={portal.portalKey}>
                          {portal.title}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  <Box
                    sx={{
                      display: "grid",
                      gap: 1.5,
                      gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                    }}
                  >
                    <TextField
                      label="Minimum distance (km)"
                      type="number"
                      value={distanceInputs.min}
                      onChange={(event) => {
                        const nextDistanceInputs = {
                          ...distanceInputs,
                          min: event.target.value,
                        };

                        setDistanceInputs(nextDistanceInputs);
                        clearDistanceCommitTimeout();
                        distanceCommitTimeoutRef.current = window.setTimeout(() => {
                          distanceCommitTimeoutRef.current = null;
                          commitDistanceInputs(nextDistanceInputs);
                        }, DISTANCE_INPUT_DEBOUNCE_MS);
                      }}
                      inputProps={{
                        min: 0,
                        step: 0.1,
                      }}
                      disabled={isGeneratingRoute}
                      helperText="Optional hard route-distance floor."
                    />
                    <TextField
                      label="Maximum distance (km)"
                      type="number"
                      value={distanceInputs.max}
                      onChange={(event) => {
                        const nextDistanceInputs = {
                          ...distanceInputs,
                          max: event.target.value,
                        };

                        setDistanceInputs(nextDistanceInputs);
                        clearDistanceCommitTimeout();
                        distanceCommitTimeoutRef.current = window.setTimeout(() => {
                          distanceCommitTimeoutRef.current = null;
                          commitDistanceInputs(nextDistanceInputs);
                        }, DISTANCE_INPUT_DEBOUNCE_MS);
                      }}
                      inputProps={{
                        min: 0,
                        step: 0.1,
                      }}
                      disabled={isGeneratingRoute}
                      helperText="Optional hard route-distance ceiling."
                    />
                    <TextField
                      select
                      label="Loop closure"
                      value={routeOptions.loopClosureMode}
                      onChange={(event) =>
                        handleRouteOptionChange(
                          "loopClosureMode",
                          event.target.value
                        )
                      }
                      disabled={isGeneratingRoute}
                      helperText="Choose whether the reroute should close back near the start or stay open."
                    >
                      {LOOP_CLOSURE_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  {hasInvalidDistanceWindow ? (
                    <Alert severity="warning">
                      Maximum distance must be greater than or equal to minimum
                      distance.
                    </Alert>
                  ) : null}
                  {hasTooManyRequiredPortals ? (
                    <Alert severity="warning">
                      The current start portal, end portal, and required portals
                      need {reservedPortalSelectionCount} route slots, but a{" "}
                      {activeDraft.metadata?.missionCount}-mission reroute only has{" "}
                      {requiredPortalCount}.
                    </Alert>
                  ) : null}
                  {!hasEnoughPortals ? (
                    <Alert severity="warning">
                      This reroute needs {requiredPortalCount} imported portals for{" "}
                      {activeDraft.metadata?.missionCount} missions, but only{" "}
                      {activePortalCount} are currently available.
                    </Alert>
                  ) : null}
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                    <Button
                      variant="contained"
                      startIcon={
                        isGeneratingRoute ? (
                          <CircularProgress color="inherit" size={18} thickness={5} />
                        ) : (
                          <AltRoute />
                        )
                      }
                      onClick={handleGenerateRoute}
                      disabled={!canGenerateRoute}
                    >
                      {isGeneratingRoute ? "Generating reroute..." : "Generate reroute"}
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      startIcon={<Download />}
                      onClick={handleExportCurrentRoute}
                      disabled={!currentRoute || isGeneratingRoute}
                    >
                      Export current UMM
                    </Button>
                  </Stack>
                </Stack>
              </Paper>

              <Accordion
                disableGutters
                elevation={0}
                sx={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 2,
                  overflow: "hidden",
                  backgroundColor: "transparent",
                  "&::before": {
                    display: "none",
                  },
                }}
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    sx={{ width: "100%", pr: 1 }}
                  >
                    <Box>
                      <Typography variant="h6">Route history</Typography>
                    </Box>
                    <Chip
                      icon={<History />}
                      label={`${historyEntries.length} saved reroutes`}
                    />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0 }}>
                  <Stack spacing={1.25}>
                    {historyEntries.map((entry) => (
                      <Paper
                        key={entry.id}
                        elevation={0}
                        sx={{
                          p: 1.5,
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        <Stack spacing={1.25}>
                          <Stack
                            direction={{ xs: "column", md: "row" }}
                            justifyContent="space-between"
                            spacing={1}
                          >
                            <Box>
                              <Typography fontWeight={600}>{entry.label}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {formatTimestamp(entry.createdAt)}
                              </Typography>
                            </Box>
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                              <Button
                                size="small"
                                variant="outlined"
                                color="inherit"
                                startIcon={<Restore />}
                                onClick={() => handleRestoreHistoryEntry(entry)}
                                disabled={isGeneratingRoute}
                              >
                                Restore
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="inherit"
                                startIcon={<Download />}
                                onClick={() => downloadUmmMissionSet(entry.route, activeDraft)}
                                disabled={isGeneratingRoute}
                              >
                                Export
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="inherit"
                                startIcon={<DeleteOutline />}
                                onClick={() => handleDeleteHistoryEntry(entry.id)}
                                disabled={isGeneratingRoute}
                              >
                                Delete
                              </Button>
                            </Stack>
                          </Stack>
                          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                            <Chip label={`${entry.summary?.portalCount ?? 0} portals`} />
                            <Chip label={`${entry.summary?.missionCount ?? 0} missions`} />
                            <Chip
                              label={
                                `${getRouteSummaryDistanceModeLabel(
                                  entry.summary
                                )} ${getRouteSummaryDistanceLabel(entry.summary)}`
                              }
                            />
                            <Chip
                              label={`Target fit ${formatPercentage(entry.summary?.targetFitScore)}`}
                            />
                          </Stack>
                        </Stack>
                      </Paper>
                    ))}
                    {historyEntries.length === 0 ? (
                      <Typography color="text.secondary">
                        No reroutes have been generated yet.
                      </Typography>
                    ) : null}
                  </Stack>
                </AccordionDetails>
              </Accordion>

              <Accordion
                disableGutters
                elevation={0}
                sx={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 2,
                  overflow: "hidden",
                  backgroundColor: "transparent",
                  "&::before": {
                    display: "none",
                  },
                }}
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    sx={{ width: "100%", pr: 1 }}
                  >
                    <Box>
                      <Typography variant="h6">Imported portal pool</Typography>
                    </Box>
                    <Chip label={`${filteredPortals.length} matching portals`} />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0 }}>
                  <Stack spacing={2}>
                    <Typography color="text.secondary">
                      Require a portal to force it into the reroute. Disable keeps
                      it visible but excludes it from routing, and delete removes it
                      from this local workspace.
                    </Typography>
                    <TextField
                      label="Search portals"
                      value={portalQuery}
                      onChange={(event) => setPortalQuery(event.target.value)}
                      placeholder="Search by portal title or imported mission"
                      disabled={isGeneratingRoute}
                      fullWidth
                    />

                    <Stack spacing={1.25}>
                      {visiblePortals.map((portal) => {
                        const isDisabled = excludedPortalKeySet.has(portal.portalKey);
                        const isRequired = requiredPortalKeySet.has(portal.portalKey);

                        return (
                          <Paper
                            key={portal.portalKey}
                            elevation={0}
                            sx={{
                              p: 1.5,
                              border: "1px solid rgba(255,255,255,0.08)",
                              opacity: isDisabled ? 0.68 : 1,
                            }}
                          >
                            <Stack spacing={1.25}>
                              <Stack
                                direction={{ xs: "column", sm: "row" }}
                                justifyContent="space-between"
                                spacing={1}
                                alignItems={{ xs: "flex-start", sm: "center" }}
                              >
                                <Box>
                                  <Typography fontWeight={600}>{portal.title}</Typography>
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ mt: 0.5 }}
                                  >
                                    Imported mission {(portal.sourceMissionIndex ?? 0) + 1}
                                    {portal.sourceMissionTitle
                                      ? ` • ${portal.sourceMissionTitle}`
                                      : ""}
                                  </Typography>
                                </Box>
                                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                  <Chip
                                    size="small"
                                    color={isRequired ? "primary" : "default"}
                                    label={
                                      isRequired
                                        ? "Required"
                                        : isDisabled
                                          ? "Disabled"
                                          : "Active"
                                    }
                                  />
                                </Stack>
                              </Stack>
                              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                                <Button
                                  size="small"
                                  variant={isRequired ? "contained" : "outlined"}
                                  aria-label={`${
                                    isRequired ? "Unrequire" : "Require"
                                  } ${portal.title}`}
                                  onClick={() =>
                                    handleTogglePortalRequired(portal.portalKey)
                                  }
                                  disabled={isGeneratingRoute}
                                  sx={{
                                    ...compactActionButtonBaseSx,
                                    ...portalActionButtonStyles.required.idleSx,
                                    ...(isRequired
                                      ? portalActionButtonStyles.required.activeSx
                                      : null),
                                  }}
                                >
                                  {isRequired ? "Required" : "Require"}
                                </Button>
                                <Button
                                  size="small"
                                  variant={isDisabled ? "contained" : "outlined"}
                                  aria-label={`${
                                    isDisabled ? "Enable" : "Disable"
                                  } ${portal.title}`}
                                  onClick={() =>
                                    handleTogglePortalDisabled(portal.portalKey)
                                  }
                                  disabled={isGeneratingRoute}
                                  sx={{
                                    ...compactActionButtonBaseSx,
                                    ...portalActionButtonStyles.disabled.idleSx,
                                    ...(isDisabled
                                      ? portalActionButtonStyles.disabled.activeSx
                                      : null),
                                  }}
                                >
                                  {isDisabled ? "Disabled" : "Disable"}
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  aria-label={`Delete ${portal.title}`}
                                  onClick={() => handleDeletePortal(portal.portalKey)}
                                  disabled={isGeneratingRoute}
                                  sx={{
                                    ...compactActionButtonBaseSx,
                                    ...portalActionButtonStyles.delete.idleSx,
                                  }}
                                >
                                  Delete
                                </Button>
                              </Stack>
                            </Stack>
                          </Paper>
                        );
                      })}
                      {filteredPortals.length > PORTAL_LIST_LIMIT ? (
                        <Typography variant="body2" color="text.secondary">
                          Showing the first {PORTAL_LIST_LIMIT} matching portals.
                          Narrow the search to inspect a smaller subset.
                        </Typography>
                      ) : null}
                      {filteredPortals.length === 0 ? (
                        <Typography color="text.secondary">
                          No portals match the current filter.
                        </Typography>
                      ) : null}
                    </Stack>
                  </Stack>
                </AccordionDetails>
              </Accordion>

              </Stack>

              <Stack spacing={2.5}>
              <Paper
                elevation={0}
                sx={{
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Box sx={{ p: 2.5, pb: 1.5 }}>
                  <Typography variant="h6">Preview map</Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    {currentRoute
                      ? "The current reroute preview is rendered locally."
                      : "Generate a reroute to preview the updated mission flow."}
                  </Typography>
                </Box>
                <Divider />
                <Box sx={{ height: { xs: 360, lg: 560 } }}>
                  <MapContainer
                    center={DEFAULT_MAP_CENTER}
                    zoom={14}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
                    <PreviewBoundsController coordinates={previewCoordinates} />
                    <BannerMarkers
                      missions={previewMissions}
                      currentMission={0}
                      showStepMarkers={true}
                    />
                  </MapContainer>
                </Box>
              </Paper>

              <Accordion
                disableGutters
                elevation={0}
                expanded={isCurrentRouteExpanded}
                onChange={(_event, expanded) => setIsCurrentRouteExpanded(expanded)}
                sx={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 2,
                  overflow: "hidden",
                  backgroundColor: "transparent",
                  "&::before": {
                    display: "none",
                  },
                }}
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    sx={{ width: "100%", pr: 1 }}
                  >
                    <Typography variant="h6">Current reroute</Typography>
                    {currentRoute ? (
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        <Chip label={`${currentRoute.summary.portalCount} portals`} />
                        <Chip label={`${currentRoute.summary.missionCount} missions`} />
                        <Chip
                          label={`${getRouteSummaryDistanceModeLabel(
                            currentRoute.summary
                          )} ${getRouteSummaryDistanceLabel(currentRoute.summary)}`}
                        />
                        <Chip label={`Tail ${currentRoute.summary.tailGapLabel}`} />
                        <Chip label={`Target fit ${currentRoute.summary.targetFitLabel}`} />
                      </Stack>
                    ) : (
                      <Typography color="text.secondary">No active reroute</Typography>
                    )}
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0 }}>
                  {currentRoute ? (
                    <Stack spacing={1.5}>
                      <Typography color="text.secondary">
                        Starts at {currentRoute.summary.startPortalTitle} and ends at{" "}
                        {currentRoute.summary.endPortalTitle}. Average hop{" "}
                        {currentRoute.summary.averageHopLabel}, longest hop{" "}
                        {currentRoute.summary.maxHopLabel}, target{" "}
                        {getRouteSummaryTargetWindowTypeLabel(currentRoute.summary)}{" "}
                        window {currentRoute.summary.targetWindowLabel}.
                      </Typography>
                      <Stack spacing={1}>
                        {currentRoute.missions.map((mission) => (
                          <Paper
                            key={mission.id}
                            elevation={0}
                            sx={{
                              p: 1.5,
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            <Typography fontWeight={600}>{mission.title}</Typography>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mt: 0.5 }}
                            >
                              {mission.portals.map((portal) => portal.title).join(" → ")}
                            </Typography>
                          </Paper>
                        ))}
                      </Stack>
                    </Stack>
                  ) : (
                    <Typography color="text.secondary">
                      No reroute is active yet. Import a banner and generate a
                      reroute.
                    </Typography>
                  )}
                </AccordionDetails>
              </Accordion>
              </Stack>
            </Box>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}
