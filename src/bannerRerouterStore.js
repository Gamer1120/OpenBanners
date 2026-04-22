import { useSyncExternalStore } from "react";
import { normalizeRouteOptions } from "./bannerRerouter/umm";
import {
  compactRouteSnapshot,
  inflateStoredRoute,
} from "./bannerRerouter/routeGenerator";

export const BANNER_REROUTER_STORAGE_KEY = "openbanners-banner-rerouter";
export const BANNER_REROUTER_CHANGE_EVENT =
  "openbanners:banner-rerouter-change";

const EMPTY_REROUTER_STATE = Object.freeze({
  version: 1,
  activeDraftId: null,
  drafts: {},
});

let cachedStorageValue = null;
let cachedSnapshot = EMPTY_REROUTER_STATE;
const MAX_PERSISTED_HISTORY_ENTRIES_PER_DRAFT = 12;

function normalizeHistoryEntry(entry, portalPool = []) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const inflatedRoute = inflateStoredRoute(entry.route, portalPool);

  return {
    id: typeof entry.id === "string" ? entry.id : `history-${Date.now()}`,
    createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
    label:
      typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim()
        : "Saved reroute",
    selectedStartPortalKey:
      typeof entry.selectedStartPortalKey === "string"
        ? entry.selectedStartPortalKey
        : null,
    selectedEndPortalKey:
      typeof entry.selectedEndPortalKey === "string"
        ? entry.selectedEndPortalKey
        : null,
    excludedPortalKeys: Array.isArray(entry.excludedPortalKeys)
      ? entry.excludedPortalKeys.filter((value) => typeof value === "string")
      : [],
    requiredPortalKeys: Array.isArray(entry.requiredPortalKeys)
      ? entry.requiredPortalKeys.filter((value) => typeof value === "string")
      : [],
    routeOptions: normalizeRouteOptions(entry.routeOptions),
    summary:
      entry.summary && typeof entry.summary === "object"
        ? entry.summary
        : inflatedRoute?.summary ?? {},
    route: inflatedRoute,
  };
}

function normalizeDraft(draft) {
  if (!draft || typeof draft !== "object" || typeof draft.id !== "string") {
    return null;
  }

  const portalPool = Array.isArray(draft.portalPool) ? draft.portalPool : [];

  return {
    id: draft.id,
    createdAt: Number.isFinite(draft.createdAt) ? draft.createdAt : Date.now(),
    updatedAt: Number.isFinite(draft.updatedAt) ? draft.updatedAt : Date.now(),
    source:
      draft.source && typeof draft.source === "object"
        ? {
            importType:
              typeof draft.source.importType === "string"
                ? draft.source.importType
                : "umm",
            fileName:
              typeof draft.source.fileName === "string"
                ? draft.source.fileName
                : "imported-banner.json",
            fileFormatVersion: Number.isFinite(draft.source.fileFormatVersion)
              ? draft.source.fileFormatVersion
              : null,
            importedAt: Number.isFinite(draft.source.importedAt)
              ? draft.source.importedAt
              : Date.now(),
          }
        : {
            importType: "umm",
            fileName: "imported-banner.json",
            fileFormatVersion: null,
            importedAt: Date.now(),
          },
    metadata:
      draft.metadata && typeof draft.metadata === "object"
        ? {
            title:
              typeof draft.metadata.title === "string"
                ? draft.metadata.title
                : "Rerouted Banner",
            description:
              typeof draft.metadata.description === "string"
                ? draft.metadata.description
                : "",
            missionCount: Number.isFinite(draft.metadata.missionCount)
              ? draft.metadata.missionCount
              : 12,
          }
        : {
            title: "Rerouted Banner",
            description: "",
            missionCount: 12,
          },
    importedMissionSet:
      draft.importedMissionSet && typeof draft.importedMissionSet === "object"
        ? {
            missionSetName:
              typeof draft.importedMissionSet.missionSetName === "string"
                ? draft.importedMissionSet.missionSetName
                : null,
            missionSetDescription:
              typeof draft.importedMissionSet.missionSetDescription === "string"
                ? draft.importedMissionSet.missionSetDescription
                : null,
            titleFormat:
              typeof draft.importedMissionSet.titleFormat === "string"
                ? draft.importedMissionSet.titleFormat
                : null,
            plannedBannerLength: Number.isFinite(
              draft.importedMissionSet.plannedBannerLength
            )
              ? draft.importedMissionSet.plannedBannerLength
              : null,
            importedMissionCount: Number.isFinite(
              draft.importedMissionSet.importedMissionCount
            )
              ? draft.importedMissionSet.importedMissionCount
              : 0,
          }
        : {
            missionSetName: null,
            missionSetDescription: null,
            titleFormat: null,
            plannedBannerLength: null,
            importedMissionCount: 0,
          },
    portalPool,
    importSummary:
      draft.importSummary && typeof draft.importSummary === "object"
        ? draft.importSummary
        : {},
    excludedPortalKeys: Array.isArray(draft.excludedPortalKeys)
      ? draft.excludedPortalKeys.filter((value) => typeof value === "string")
      : [],
    requiredPortalKeys: Array.isArray(draft.requiredPortalKeys)
      ? draft.requiredPortalKeys.filter((value) => typeof value === "string")
      : [],
    selectedStartPortalKey:
      typeof draft.selectedStartPortalKey === "string"
        ? draft.selectedStartPortalKey
        : null,
    selectedEndPortalKey:
      typeof draft.selectedEndPortalKey === "string"
        ? draft.selectedEndPortalKey
        : null,
    routeOptions: normalizeRouteOptions(draft.routeOptions),
    currentGeneratedRoute: inflateStoredRoute(draft.currentGeneratedRoute, portalPool),
    routeHistory: Array.isArray(draft.routeHistory)
      ? draft.routeHistory
          .map((entry) => normalizeHistoryEntry(entry, portalPool))
          .filter(Boolean)
      : [],
  };
}

function compactHistoryEntryForStorage(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    ...entry,
    route: compactRouteSnapshot(entry.route),
  };
}

function compactDraftForStorage(draft) {
  if (!draft || typeof draft !== "object") {
    return null;
  }

  return {
    ...draft,
    currentGeneratedRoute: compactRouteSnapshot(draft.currentGeneratedRoute),
    routeHistory: Array.isArray(draft.routeHistory)
      ? draft.routeHistory
          .slice(-MAX_PERSISTED_HISTORY_ENTRIES_PER_DRAFT)
          .map(compactHistoryEntryForStorage)
          .filter(Boolean)
      : [],
  };
}

function compactRerouterStateForStorage(state) {
  if (!state || typeof state !== "object") {
    return EMPTY_REROUTER_STATE;
  }

  const drafts = {};

  Object.entries(state.drafts ?? {}).forEach(([draftId, draftValue]) => {
    const compactDraft = compactDraftForStorage(draftValue);

    if (compactDraft) {
      drafts[draftId] = compactDraft;
    }
  });

  return {
    version: 1,
    activeDraftId:
      typeof state.activeDraftId === "string" ? state.activeDraftId : null,
    drafts,
  };
}

function isQuotaExceededError(error) {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22)
  );
}

function pruneStoredStateForQuota(state) {
  const nextState = {
    ...state,
    drafts: Object.fromEntries(
      Object.entries(state.drafts ?? {}).map(([draftId, draftValue]) => [
        draftId,
        {
          ...draftValue,
          routeHistory: Array.isArray(draftValue?.routeHistory)
            ? [...draftValue.routeHistory]
            : [],
        },
      ])
    ),
  };

  while (true) {
    let oldestDraftId = null;
    let oldestEntryIndex = -1;
    let oldestCreatedAt = Number.POSITIVE_INFINITY;

    Object.entries(nextState.drafts).forEach(([draftId, draftValue]) => {
      (draftValue.routeHistory ?? []).forEach((entry, entryIndex) => {
        const createdAt = Number.isFinite(entry?.createdAt)
          ? entry.createdAt
          : Number.POSITIVE_INFINITY;

        if (createdAt < oldestCreatedAt) {
          oldestCreatedAt = createdAt;
          oldestDraftId = draftId;
          oldestEntryIndex = entryIndex;
        }
      });
    });

    if (oldestDraftId === null || oldestEntryIndex < 0) {
      return nextState;
    }

    nextState.drafts[oldestDraftId].routeHistory.splice(oldestEntryIndex, 1);
    return nextState;
  }
}

function normalizeRerouterState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return EMPTY_REROUTER_STATE;
  }

  const drafts = {};

  Object.entries(rawValue.drafts ?? {}).forEach(([draftId, draftValue]) => {
    const normalizedDraft = normalizeDraft({
      ...draftValue,
      id: typeof draftValue?.id === "string" ? draftValue.id : draftId,
    });

    if (normalizedDraft) {
      drafts[normalizedDraft.id] = normalizedDraft;
    }
  });

  const activeDraftId =
    typeof rawValue.activeDraftId === "string" && drafts[rawValue.activeDraftId]
      ? rawValue.activeDraftId
      : Object.keys(drafts)[0] ?? null;

  return {
    version: 1,
    activeDraftId,
    drafts,
  };
}

function emitRerouterChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(BANNER_REROUTER_CHANGE_EVENT));
}

export function loadBannerRerouterState() {
  if (typeof window === "undefined") {
    return EMPTY_REROUTER_STATE;
  }

  try {
    const rawValue = window.localStorage.getItem(BANNER_REROUTER_STORAGE_KEY);

    if (!rawValue) {
      cachedStorageValue = null;
      cachedSnapshot = EMPTY_REROUTER_STATE;
      return EMPTY_REROUTER_STATE;
    }

    if (rawValue === cachedStorageValue) {
      return cachedSnapshot;
    }

    cachedStorageValue = rawValue;
    cachedSnapshot = normalizeRerouterState(JSON.parse(rawValue));
    return cachedSnapshot;
  } catch (error) {
    console.error("Couldn't read banner rerouter state.", error);
    cachedStorageValue = null;
    cachedSnapshot = EMPTY_REROUTER_STATE;
    return EMPTY_REROUTER_STATE;
  }
}

export function saveBannerRerouterState(nextState) {
  if (typeof window === "undefined") {
    return EMPTY_REROUTER_STATE;
  }

  const normalizedState = normalizeRerouterState(nextState);
  let persistedState = compactRerouterStateForStorage(normalizedState);
  let serializedValue = JSON.stringify(persistedState);

  while (true) {
    try {
      window.localStorage.setItem(BANNER_REROUTER_STORAGE_KEY, serializedValue);
      cachedStorageValue = serializedValue;
      cachedSnapshot = normalizedState;
      emitRerouterChange();
      return normalizedState;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw error;
      }

      const prunedState = pruneStoredStateForQuota(persistedState);

      if (JSON.stringify(prunedState) === serializedValue) {
        throw error;
      }

      console.warn(
        "Banner rerouter storage was close to the browser quota. Old reroute history entries were trimmed."
      );
      persistedState = prunedState;
      serializedValue = JSON.stringify(persistedState);
    }
  }
}

export function updateBannerRerouterState(updater) {
  const currentState = loadBannerRerouterState();
  const nextState =
    typeof updater === "function" ? updater(currentState) : updater;

  if (!nextState) {
    return currentState;
  }

  return saveBannerRerouterState(nextState);
}

function subscribeToRerouterChanges(callback) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event) => {
    if (
      !event ||
      event.key === null ||
      event.key === BANNER_REROUTER_STORAGE_KEY
    ) {
      callback();
    }
  };

  window.addEventListener(BANNER_REROUTER_CHANGE_EVENT, callback);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(BANNER_REROUTER_CHANGE_EVENT, callback);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useBannerRerouterState() {
  return useSyncExternalStore(
    subscribeToRerouterChanges,
    loadBannerRerouterState,
    () => EMPTY_REROUTER_STATE
  );
}

export function clearBannerRerouterState() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(BANNER_REROUTER_STORAGE_KEY);
  cachedStorageValue = null;
  cachedSnapshot = EMPTY_REROUTER_STATE;
  emitRerouterChange();
}
