import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import ExitToAppRoundedIcon from "@mui/icons-material/ExitToAppRounded";
import GroupAddRoundedIcon from "@mui/icons-material/GroupAddRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SecurityRoundedIcon from "@mui/icons-material/SecurityRounded";
import BannerCard from "./BannerCard";
import BannerTogetherGroupComparisonBuilder from "./BannerTogetherGroupComparisonBuilder";
import {
  BANNERGRESS_AUTH_REQUEST_EVENT,
  getBannergressAgentName,
  useBannergressAuth,
} from "../bannergressSync";
import {
  BANNER_TOGETHER_GROUP_DEFAULT_PRESET_ID,
  BANNER_TOGETHER_GROUP_STATUS_OPTIONS,
  evaluateBannerTogetherGroupComparison,
  getBannerTogetherGroupPresetClauses,
} from "../bannerTogetherGroupComparison";
import {
  fetchBannerTogetherCatalog,
  fetchBannerTogetherMembership,
  loadBannerTogetherCatalogCache,
  loadBannerTogetherMembershipCache,
  saveBannerTogetherCatalogCache,
  saveBannerTogetherMembershipCache,
} from "../bannerTogetherData";
import {
  BANNER_TOGETHER_LIVE_VERSION,
  clearBannerTogetherLivePendingJoin,
  clearBannerTogetherLiveAccess,
  createBannerTogetherLiveInviteUrl,
  createBannerTogetherLiveParticipantIdentity,
  createBannerTogetherLiveSecrets,
  decryptBannerTogetherLiveSnapshot,
  encryptBannerTogetherLiveSnapshot,
  hashBannerTogetherLiveRoomSecret,
  loadBannerTogetherLivePendingJoin,
  loadBannerTogetherLiveAccess,
  parseBannerTogetherLiveInviteHash,
  saveBannerTogetherLivePendingJoin,
  saveBannerTogetherLiveAccess,
} from "../bannerTogetherLiveCrypto";
import {
  createBannerTogetherLiveRoom,
  joinBannerTogetherLiveRoom,
} from "../bannerTogetherLiveApi";
import { createBannerTogetherPeerMeshSession } from "../bannerTogetherPeerMesh";

const RESULT_PAGE_SIZE = 24;
const MAX_ROOM_PARTICIPANTS = 8;
const ROOM_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const CACHE_WRITE_WARNING =
  "This browser could not cache all comparison data, so a reload may need to fetch it again.";

const STATUS_COLORS = {
  todo: "warning",
  done: "success",
  hidden: "error",
  unlisted: "default",
};

function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy failed.");
    }

    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  } finally {
    document.body.removeChild(textArea);
  }
}

function getPlaceLabel(place, fallbackPlaceId) {
  return (
    place?.formattedAddress ||
    place?.longName ||
    place?.shortName ||
    fallbackPlaceId
  );
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatSnapshotAge(value, now = Date.now()) {
  const ageMs = Math.max(0, now - new Date(value).getTime());
  const ageMinutes = Math.floor(ageMs / (60 * 1000));

  if (ageMinutes < 1) {
    return "less than a minute old";
  }

  if (ageMinutes < 60) {
    return `${ageMinutes} ${ageMinutes === 1 ? "minute" : "minutes"} old`;
  }

  const ageHours = Math.floor(ageMinutes / 60);
  const remainingMinutes = ageMinutes % 60;
  const hourLabel = `${ageHours} ${ageHours === 1 ? "hour" : "hours"}`;

  return remainingMinutes === 0
    ? `${hourLabel} old`
    : `${hourLabel} ${remainingMinutes} minutes old`;
}

function getMembershipCount(membership) {
  return Object.values(membership?.lists ?? {}).reduce(
    (total, bannerIds) => total + bannerIds.length,
    0
  );
}

function getPeerLabel(participantId, snapshot = null) {
  return snapshot?.agentName || `Participant ${participantId.slice(0, 4)}`;
}

function isPeerSnapshotAvailable(snapshot, peerState) {
  return Boolean(
    snapshot &&
      (peerState === "connected" || snapshot.shareWhileOffline === true)
  );
}

function getNextSequence(previousSequence) {
  return Math.max(previousSequence + 1, Math.floor(Date.now() / 1000));
}

function toCardListType(status) {
  if (status === "hidden") {
    return "blacklist";
  }

  return status === "unlisted" ? null : status;
}

function getStatusLabel(status) {
  return (
    BANNER_TOGETHER_GROUP_STATUS_OPTIONS.find(
      (option) => option.value === status
    )?.label ?? status
  );
}

function getDeferredDeliveryCount(delivery) {
  return (
    (Array.isArray(delivery?.pendingTo) ? delivery.pendingTo.length : 0) +
    (Array.isArray(delivery?.failedTo) ? delivery.failedTo.length : 0)
  );
}

function MembershipChips({ membership }) {
  if (!membership) {
    return null;
  }

  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      <Chip
        size="small"
        color="warning"
        label={`${membership.lists.todo.length} to do`}
        sx={{ borderRadius: 1 }}
      />
      <Chip
        size="small"
        color="success"
        label={`${membership.lists.done.length} done`}
        sx={{ borderRadius: 1 }}
      />
      <Chip
        size="small"
        color="error"
        label={`${membership.lists.blacklist.length} hidden`}
        sx={{ borderRadius: 1 }}
      />
    </Stack>
  );
}

export default function BannerTogetherLivePage({ placeId, roomId = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const authState = useBannergressAuth();
  const localAgentName = useMemo(
    () => getBannergressAgentName(authState),
    [authState.accessToken, authState.idToken]
  );
  const hasAuthCredentials = Boolean(
    authState.accessToken || authState.refreshToken
  );
  const [place, setPlace] = useState(null);
  const [placeStatus, setPlaceStatus] = useState("loading");
  const [placeError, setPlaceError] = useState("");
  const [membership, setMembership] = useState(null);
  const [membershipStatus, setMembershipStatus] = useState("checking-auth");
  const [membershipSource, setMembershipSource] = useState(null);
  const [membershipProgress, setMembershipProgress] = useState(0);
  const [membershipError, setMembershipError] = useState("");
  const [membershipReloadToken, setMembershipReloadToken] = useState(0);
  const [catalogReloadToken, setCatalogReloadToken] = useState(0);
  const [catalog, setCatalog] = useState([]);
  const [catalogStatus, setCatalogStatus] = useState("idle");
  const [catalogSource, setCatalogSource] = useState(null);
  const [catalogCapturedAt, setCatalogCapturedAt] = useState(null);
  const [catalogError, setCatalogError] = useState("");
  const [invite, setInvite] = useState(null);
  const [access, setAccess] = useState(null);
  const [initialPeers, setInitialPeers] = useState([]);
  const [roomStatus, setRoomStatus] = useState(roomId ? "loading" : "new");
  const [roomReconnectToken, setRoomReconnectToken] = useState(0);
  const [roomError, setRoomError] = useState("");
  const [peerStates, setPeerStates] = useState({});
  const [remoteSnapshots, setRemoteSnapshots] = useState({});
  const [sessionReady, setSessionReady] = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareWhileOffline, setShareWhileOffline] = useState(false);
  const [operation, setOperation] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [cacheWarning, setCacheWarning] = useState("");
  const [clauses, setClauses] = useState([]);
  const [visibleResultCount, setVisibleResultCount] = useState(RESULT_PAGE_SIZE);
  const [cacheAgeNow, setCacheAgeNow] = useState(() => Date.now());
  const sessionRef = useRef(null);
  const skipReconnectRef = useRef(null);
  const pendingCreateSecretsRef = useRef(null);
  const highestRemoteSequencesRef = useRef(new Map());
  const localSequenceRef = useRef(0);
  const lastForcedCatalogReloadRef = useRef(0);
  const lastForcedMembershipReloadRef = useRef(0);
  const lastPublishedCapturedAtRef = useRef(null);
  const cacheWriteFailuresRef = useRef({ catalog: false, membership: false });
  const isPlaceReady = placeStatus === "ready" && place?.id === placeId;
  const recordCacheWriteResult = (source, succeeded) => {
    cacheWriteFailuresRef.current[source] = !succeeded;
    setCacheWarning(
      Object.values(cacheWriteFailuresRef.current).some(Boolean)
        ? CACHE_WRITE_WARNING
        : ""
    );
  };

  useEffect(() => {
    let ignore = false;
    setPlace(null);
    setPlaceStatus("loading");
    setPlaceError("");
    cacheWriteFailuresRef.current = { catalog: false, membership: false };
    setCacheWarning("");

    fetch(`https://api.bannergress.com/places/${encodeURIComponent(placeId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Place not found.");
        }

        return response.json();
      })
      .then((nextPlace) => {
        if (ignore) {
          return;
        }

        if (nextPlace?.id !== placeId) {
          throw new Error("Place not found.");
        }

        setPlace(nextPlace);
        setPlaceStatus("ready");
      })
      .catch((error) => {
        if (ignore) {
          return;
        }

        console.error("Couldn't load Banner Together place.", error);
        setPlaceStatus("error");
        setPlaceError("This Bannergress place could not be loaded.");
      });

    return () => {
      ignore = true;
    };
  }, [placeId]);

  useEffect(() => {
    if (!isPlaceReady) {
      setCatalog([]);
      setCatalogStatus("idle");
      setCatalogSource(null);
      setCatalogCapturedAt(null);
      setCatalogError("");
      return undefined;
    }

    let ignore = false;
    const abortController = new AbortController();
    const forceRefresh =
      catalogReloadToken > lastForcedCatalogReloadRef.current;

    if (forceRefresh) {
      lastForcedCatalogReloadRef.current = catalogReloadToken;
      setCatalogSource(null);
      setCatalogCapturedAt(null);
    } else {
      setCatalog([]);
      setCatalogSource(null);
      setCatalogCapturedAt(null);
    }

    setCatalogStatus(forceRefresh ? "refreshing" : "loading");
    setCatalogError("");

    const loadCatalog = async () => {
      if (!forceRefresh) {
        const cachedCatalog = loadBannerTogetherCatalogCache(placeId);

        if (cachedCatalog) {
          if (!ignore) {
            setCatalog(cachedCatalog.banners);
            setCatalogSource("cache");
            setCatalogCapturedAt(cachedCatalog.capturedAt);
            setCacheAgeNow(Date.now());
            setCatalogStatus("ready");
          }

          return;
        }
      }

      const nextCatalog = await fetchBannerTogetherCatalog(placeId, {
        signal: abortController.signal,
        onPage: (nextPageCatalog) => {
          if (!ignore) {
            setCatalog(nextPageCatalog);
          }
        },
      });

      if (ignore) {
        return;
      }

      setCatalog(nextCatalog);
      setCatalogSource("network");
      setCatalogStatus("ready");

      try {
        const savedCatalog = saveBannerTogetherCatalogCache(
          placeId,
          nextCatalog
        );
        setCatalogCapturedAt(savedCatalog?.capturedAt ?? null);
        recordCacheWriteResult("catalog", Boolean(savedCatalog));
      } catch (error) {
        console.warn("Couldn't cache Banner Together catalog.", error);
        recordCacheWriteResult("catalog", false);
      }
    };

    loadCatalog().catch((error) => {
      if (ignore || error?.name === "AbortError") {
        return;
      }

      console.error("Couldn't load Banner Together catalog.", error);
      setCatalog([]);
      setCatalogStatus("error");
      setCatalogError(
        error instanceof Error
          ? error.message
          : "The place banner catalog could not be loaded."
      );
    });

    return () => {
      ignore = true;
      abortController.abort();
    };
  }, [catalogReloadToken, isPlaceReady, placeId]);

  useEffect(() => {
    if (!isPlaceReady) {
      setMembership(null);
      setMembershipStatus("checking-auth");
      setMembershipSource(null);
      setMembershipError("");
      return undefined;
    }

    if (!hasAuthCredentials) {
      setMembership(null);
      setMembershipStatus("auth-required");
      setMembershipSource(null);
      setMembershipError("");
      return undefined;
    }

    let ignore = false;
    const abortController = new AbortController();
    const forceRefresh =
      membershipReloadToken > lastForcedMembershipReloadRef.current;

    if (forceRefresh) {
      lastForcedMembershipReloadRef.current = membershipReloadToken;
    } else {
      setMembership(null);
      setMembershipSource(null);
    }

    setMembershipStatus(forceRefresh ? "refreshing" : "loading");
    setMembershipProgress(0);
    setMembershipError("");

    const loadMembership = async () => {
      if (!forceRefresh) {
        const cachedMembership = await loadBannerTogetherMembershipCache(
          placeId,
          { authData: authState }
        );

        if (cachedMembership) {
          if (!ignore) {
            setMembership(cachedMembership);
            setMembershipSource("cache");
            setCacheAgeNow(Date.now());
            setMembershipStatus("ready");
          }

          return;
        }
      }

      const nextMembership = await fetchBannerTogetherMembership(placeId, {
        signal: abortController.signal,
        onProgress: (progress) => {
          if (!ignore) {
            setMembershipProgress(progress);
          }
        },
      });

      if (ignore) {
        return;
      }

      setMembership(nextMembership);
      setMembershipSource("network");
      setMembershipStatus("ready");
      const savedMembership = await saveBannerTogetherMembershipCache(
        placeId,
        nextMembership
      );

      if (!ignore) {
        recordCacheWriteResult("membership", Boolean(savedMembership));
      }
    };

    loadMembership().catch((error) => {
      if (ignore || error?.name === "AbortError") {
        return;
      }

      if (error?.code === "AUTH_REQUIRED") {
        setMembershipStatus("auth-required");
        return;
      }

      console.error("Couldn't load Banner Together memberships.", error);
      setMembershipStatus("error");
      setMembershipError(
        error instanceof Error
          ? error.message
          : "The private banner lists could not be loaded."
      );
    });

    return () => {
      ignore = true;
      abortController.abort();
    };
  }, [
    authState.accessToken,
    authState.idToken,
    authState.refreshToken,
    hasAuthCredentials,
    isPlaceReady,
    membershipReloadToken,
    placeId,
  ]);

  useEffect(() => {
    if (membershipSource !== "cache" && catalogSource !== "cache") {
      return undefined;
    }

    const timer = window.setInterval(() => setCacheAgeNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, [catalogSource, membershipSource]);

  useEffect(() => {
    let ignore = false;
    setRoomError("");
    setInvite(null);
    setPeerStates({});
    setRemoteSnapshots({});
    setShareEnabled(false);
    setShareWhileOffline(false);
    setSessionReady(false);
    highestRemoteSequencesRef.current = new Map();

    if (!roomId) {
      setAccess(null);
      setInitialPeers([]);
      setRoomStatus("new");
      return undefined;
    }

    let storedAccess;

    try {
      storedAccess = loadBannerTogetherLiveAccess({ roomId, placeId });
    } catch (error) {
      setRoomStatus("error");
      setRoomError(
        error instanceof Error ? error.message : "This live room link is invalid."
      );
      return undefined;
    }

    if (!storedAccess) {
      try {
        setInvite(
          parseBannerTogetherLiveInviteHash(location.hash, {
            roomId,
            placeId,
          })
        );
        setAccess(null);
        setInitialPeers([]);
        setRoomStatus("invite");
      } catch (error) {
        setAccess(null);
        setRoomStatus("error");
        setRoomError(
          location.hash
            ? error instanceof Error
              ? error.message
              : "This live room invite is invalid."
            : "Room access is not stored on this device. Open the invite link again."
        );
      }

      return undefined;
    }

    clearBannerTogetherLivePendingJoin(roomId);

    const skippedBootstrap = skipReconnectRef.current;

    if (
      skippedBootstrap?.roomId === roomId &&
      skippedBootstrap.participantToken === storedAccess.participantToken
    ) {
      skipReconnectRef.current = null;
      setAccess(storedAccess);
      setInitialPeers(skippedBootstrap.peers);
      setRoomStatus("ready");

      if (location.hash) {
        navigate(
          { pathname: location.pathname, search: location.search, hash: "" },
          { replace: true }
        );
      }

      return undefined;
    }

    setRoomStatus("reconnecting");
    hashBannerTogetherLiveRoomSecret(storedAccess.roomSecret)
      .then((roomVerifier) =>
        joinBannerTogetherLiveRoom({
          roomId,
          roomVerifier,
          participantId: storedAccess.participantId,
          participantVerifier: storedAccess.participantVerifier,
          participantToken: storedAccess.participantToken,
        })
      )
      .then((response) => {
        if (ignore) {
          return;
        }

        const nextAccess = saveBannerTogetherLiveAccess({
          ...storedAccess,
          participantToken: response.participantToken,
          expiresAt: response.expiresAt,
        });
        setAccess(nextAccess);
        setInitialPeers(response.peers);
        setRoomStatus("ready");

        if (location.hash) {
          navigate(
            { pathname: location.pathname, search: location.search, hash: "" },
            { replace: true }
          );
        }
      })
      .catch((error) => {
        if (!ignore) {
          setRoomStatus("error");
          setRoomError(
            error instanceof Error
              ? error.message
              : "The live room could not be rejoined."
          );
        }
      });

    return () => {
      ignore = true;
    };
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    placeId,
    roomReconnectToken,
    roomId,
  ]);

  useEffect(() => {
    if (!access || !roomId || roomStatus !== "ready") {
      return undefined;
    }

    let active = true;
    const session = createBannerTogetherPeerMeshSession({
      roomId,
      participantId: access.participantId,
      participantToken: access.participantToken,
      initialPeers,
      onParticipantState: ({ participantId, state }) => {
        if (!active || participantId === access.participantId) {
          return;
        }

        setPeerStates((currentStates) => ({
          ...currentStates,
          [participantId]: state,
        }));

        if (state === "left") {
          setRemoteSnapshots((currentSnapshots) => {
            if (currentSnapshots[participantId]?.shareWhileOffline === true) {
              return currentSnapshots;
            }

            const nextSnapshots = { ...currentSnapshots };
            delete nextSnapshots[participantId];
            return nextSnapshots;
          });
          highestRemoteSequencesRef.current.delete(participantId);
        }
      },
      onSnapshot: async ({ participantId, sequence, envelope }) => {
        if (!active || participantId === access.participantId) {
          return;
        }

        const highestSequence =
          highestRemoteSequencesRef.current.get(participantId) ?? 0;

        if (sequence <= highestSequence) {
          return;
        }

        if (envelope === null) {
          highestRemoteSequencesRef.current.set(participantId, sequence);
          setRemoteSnapshots((currentSnapshots) => {
            const nextSnapshots = { ...currentSnapshots };
            delete nextSnapshots[participantId];
            return nextSnapshots;
          });
          return;
        }

        try {
          const snapshot = await decryptBannerTogetherLiveSnapshot({
            roomSecret: access.roomSecret,
            roomId,
            placeId,
            participantId,
            sequence,
            envelope,
          });

          if (
            !active ||
            sequence <=
              (highestRemoteSequencesRef.current.get(participantId) ?? 0)
          ) {
            return;
          }

          highestRemoteSequencesRef.current.set(participantId, sequence);
          setRemoteSnapshots((currentSnapshots) => ({
            ...currentSnapshots,
            [participantId]: snapshot,
          }));
        } catch (error) {
          if (active) {
            setFeedback({
              severity: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "A peer snapshot could not be decrypted.",
            });
          }
        }
      },
      onSessionState: ({ state }) => {
        if (!active || state !== "reconnect-required") {
          return;
        }

        setSessionReady(false);
        setFeedback({
          severity: "info",
          message: "The live connection expired and is rejoining privately.",
        });
        setRoomStatus("reconnecting");
        setRoomReconnectToken((currentValue) => currentValue + 1);
      },
      onError: (error) => {
        if (active) {
          setFeedback({
            severity: "warning",
            message:
              error instanceof Error
                ? error.message
                : "A peer connection encountered an error.",
          });
        }
      },
    });

    sessionRef.current = session;
    Promise.resolve()
      .then(() => session.start({ after: 0 }))
      .then(async () => {
        if (!active) {
          return;
        }

        const sequence = getNextSequence(localSequenceRef.current);
        localSequenceRef.current = sequence;
        await session.clearPublishedSnapshot({ sequence });

        if (!active) {
          return;
        }

        lastPublishedCapturedAtRef.current = null;
        setSessionReady(true);
      })
      .catch((error) => {
        if (active) {
          setRoomStatus("error");
          setRoomError(
            error instanceof Error
              ? error.message
              : "The peer room could not be started."
          );
        }
      });

    return () => {
      active = false;
      setSessionReady(false);

      if (sessionRef.current === session) {
        sessionRef.current = null;
      }

      Promise.resolve(session.close({ notifyServer: false })).catch(() => {});
    };
  }, [access, initialPeers, placeId, roomId, roomStatus]);

  useEffect(() => {
    if (
      !shareEnabled ||
      !sessionReady ||
      !sessionRef.current ||
      !access ||
      !membership ||
      membership.capturedAt === lastPublishedCapturedAtRef.current
    ) {
      return undefined;
    }

    let active = true;
    const publishRefreshedMembership = async () => {
      const sequence = getNextSequence(localSequenceRef.current);
      localSequenceRef.current = sequence;
      const envelope = await encryptBannerTogetherLiveSnapshot({
        roomSecret: access.roomSecret,
        roomId: access.roomId,
        placeId,
        participantId: access.participantId,
        sequence,
        capturedAt: membership.capturedAt,
        agentName: localAgentName,
        shareWhileOffline,
        lists: membership.lists,
      });
      const delivery = await sessionRef.current.publishSnapshot({
        sequence,
        envelope,
      });

      if (active) {
        lastPublishedCapturedAtRef.current = membership.capturedAt;
        const deferredCount = getDeferredDeliveryCount(delivery);
        setFeedback(
          deferredCount > 0
            ? {
                severity: "warning",
                message: `The refreshed snapshot is retained for ${deferredCount} peer ${
                  deferredCount === 1 ? "connection" : "connections"
                } that are not ready yet.`,
              }
            : {
                severity: "success",
                message: "The refreshed list snapshot is now shared.",
              }
        );
      }
    };

    publishRefreshedMembership().catch((error) => {
      if (active) {
        setFeedback({
          severity: "error",
          message:
            error instanceof Error
              ? error.message
              : "The refreshed list snapshot could not be shared.",
        });
      }
    });

    return () => {
      active = false;
    };
  }, [
    access,
    localAgentName,
    membership,
    placeId,
    sessionReady,
    shareEnabled,
    shareWhileOffline,
  ]);

  const comparisonParticipants = useMemo(() => {
    if (!access || !membership || catalogStatus !== "ready") {
      return [];
    }

    return [
      {
        id: access.participantId,
        label: "You",
        lists: membership.lists,
      },
      ...Object.entries(remoteSnapshots)
        .filter(([participantId, snapshot]) =>
          isPeerSnapshotAvailable(snapshot, peerStates[participantId])
        )
        .sort(([participantIdA], [participantIdB]) =>
          participantIdA.localeCompare(participantIdB)
        )
        .map(([participantId, snapshot]) => ({
          id: participantId,
          label: getPeerLabel(participantId, snapshot),
          lists: snapshot.lists,
        })),
    ];
  }, [access, catalogStatus, membership, peerStates, remoteSnapshots]);
  const participantSignature = comparisonParticipants
    .map((participant) => participant.id)
    .join("|");

  useEffect(() => {
    if (comparisonParticipants.length < 2 || !access) {
      setClauses([]);
      return;
    }

    setClauses(
      getBannerTogetherGroupPresetClauses(
        BANNER_TOGETHER_GROUP_DEFAULT_PRESET_ID,
        comparisonParticipants,
        access.participantId
      )
    );
  }, [access?.participantId, participantSignature]);

  const comparison = useMemo(() => {
    if (
      !access ||
      comparisonParticipants.length < 2 ||
      catalogStatus !== "ready" ||
      clauses.length === 0
    ) {
      return {
        results: [],
        missingCatalogCount: 0,
        missingMatchingCatalogCount: 0,
        error: "",
      };
    }

    try {
      return {
        ...evaluateBannerTogetherGroupComparison({
          catalogBanners: catalog,
          participants: comparisonParticipants,
          localParticipantId: access.participantId,
          clauses,
        }),
        error: "",
      };
    } catch (error) {
      return {
        results: [],
        missingCatalogCount: 0,
        missingMatchingCatalogCount: 0,
        error:
          error instanceof Error
            ? error.message
            : "This group comparison is invalid.",
      };
    }
  }, [access, catalog, catalogStatus, clauses, comparisonParticipants]);
  const visibleResults = comparison.results.slice(0, visibleResultCount);

  useEffect(() => {
    setVisibleResultCount(RESULT_PAGE_SIZE);
  }, [clauses, participantSignature, roomId]);

  const persistAccess = (
    response,
    roomSecret,
    participantId,
    participantVerifier
  ) => {
    const nextAccess = saveBannerTogetherLiveAccess({
      version: BANNER_TOGETHER_LIVE_VERSION,
      roomId: response.roomId,
      placeId,
      roomSecret,
      participantId,
      participantVerifier,
      participantToken: response.participantToken,
      expiresAt: response.expiresAt,
    });
    skipReconnectRef.current = {
      roomId: response.roomId,
      participantToken: response.participantToken,
      peers: response.peers,
    };
    setAccess(nextAccess);
    setInitialPeers(response.peers);
    return nextAccess;
  };

  const handleCreateRoom = async () => {
    setOperation("create");
    setFeedback(null);

    try {
      const secrets =
        pendingCreateSecretsRef.current ??
        (await createBannerTogetherLiveSecrets());
      pendingCreateSecretsRef.current = secrets;
      const response = await createBannerTogetherLiveRoom({
        roomVerifier: secrets.roomVerifier,
        participantId: secrets.participantId,
        participantVerifier: secrets.participantVerifier,
      });
      persistAccess(
        response,
        secrets.roomSecret,
        secrets.participantId,
        secrets.participantVerifier
      );
      pendingCreateSecretsRef.current = null;
      const inviteUrl = createBannerTogetherLiveInviteUrl({
        origin: window.location.origin,
        placeId,
        roomId: response.roomId,
        roomSecret: secrets.roomSecret,
      });

      try {
        await copyTextToClipboard(inviteUrl);
        setFeedback({ severity: "success", message: "Live room invite copied." });
      } catch {
        setFeedback({
          severity: "warning",
          message: "The room was created, but the invite could not be copied.",
        });
      }

      navigate(
        `/together/${encodeURIComponent(placeId)}/live/${encodeURIComponent(
          response.roomId
        )}`,
        { replace: true }
      );
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "The live room could not be created.",
      });
    } finally {
      setOperation(null);
    }
  };

  const handleJoinRoom = async () => {
    if (!invite || !roomId) {
      return;
    }

    setOperation("join");
    setFeedback(null);

    try {
      const storedPendingJoin = loadBannerTogetherLivePendingJoin({
        roomId,
        placeId,
      });
      const pendingJoinMatches = Boolean(
        storedPendingJoin?.roomSecret === invite.roomSecret
      );
      const participantIdentity = pendingJoinMatches
        ? {
            participantId: storedPendingJoin.participantId,
            participantVerifier: storedPendingJoin.participantVerifier,
          }
        : createBannerTogetherLiveParticipantIdentity();
      const pendingJoin = saveBannerTogetherLivePendingJoin({
        version: BANNER_TOGETHER_LIVE_VERSION,
        roomId,
        placeId,
        roomSecret: invite.roomSecret,
        participantId: participantIdentity.participantId,
        participantVerifier: participantIdentity.participantVerifier,
        expiresAt: pendingJoinMatches
          ? storedPendingJoin.expiresAt
          : new Date(Date.now() + ROOM_MAX_AGE_MS).toISOString(),
      });
      const roomVerifier = await hashBannerTogetherLiveRoomSecret(
        invite.roomSecret
      );
      const response = await joinBannerTogetherLiveRoom({
        roomId,
        roomVerifier,
        participantId: pendingJoin.participantId,
        participantVerifier: pendingJoin.participantVerifier,
      });
      persistAccess(
        response,
        invite.roomSecret,
        pendingJoin.participantId,
        pendingJoin.participantVerifier
      );
      clearBannerTogetherLivePendingJoin(roomId);
      navigate(
        { pathname: location.pathname, search: location.search, hash: "" },
        { replace: true }
      );
      setFeedback({
        severity: "success",
        message: "Joined. Your lists are still private.",
      });
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "The live room could not be joined.",
      });
    } finally {
      setOperation(null);
    }
  };

  const handleShareChange = async (nextEnabled) => {
    if (!sessionRef.current || !access) {
      return;
    }

    setOperation(nextEnabled ? "share" : "withdraw");
    setFeedback(null);

    try {
      const sequence = getNextSequence(localSequenceRef.current);
      localSequenceRef.current = sequence;

      if (nextEnabled) {
        if (!membership) {
          throw new Error("Authenticate before sharing your lists.");
        }

        const envelope = await encryptBannerTogetherLiveSnapshot({
          roomSecret: access.roomSecret,
          roomId: access.roomId,
          placeId,
          participantId: access.participantId,
          sequence,
          capturedAt: membership.capturedAt,
          agentName: localAgentName,
          shareWhileOffline,
          lists: membership.lists,
        });
        const delivery = await sessionRef.current.publishSnapshot({
          sequence,
          envelope,
        });
        lastPublishedCapturedAtRef.current = membership.capturedAt;
        setShareEnabled(true);
        const deferredCount = getDeferredDeliveryCount(delivery);
        setFeedback(
          deferredCount > 0
            ? {
                severity: "warning",
                message: `Sharing is enabled. ${deferredCount} peer ${
                  deferredCount === 1 ? "connection is" : "connections are"
                } not ready yet and will receive the snapshot after connecting.`,
              }
            : {
                severity: "success",
                message: "Your lists are now shared with connected room members.",
              }
        );
      } else {
        const delivery = await sessionRef.current.clearPublishedSnapshot({
          sequence,
        });
        lastPublishedCapturedAtRef.current = null;
        setShareEnabled(false);
        setShareWhileOffline(false);
        const deferredCount = getDeferredDeliveryCount(delivery);
        setFeedback(
          deferredCount > 0
            ? {
                severity: "warning",
                message: `You stopped sharing. ${deferredCount} disconnected ${
                  deferredCount === 1 ? "peer" : "peers"
                } will receive the withdrawal if they reconnect.`,
              }
            : {
                severity: "info",
                message: "You stopped sharing your lists.",
              }
        );
      }
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "Your sharing setting could not be changed.",
      });
    } finally {
      setOperation(null);
    }
  };

  const handleOfflineSharingChange = async (nextEnabled) => {
    if (
      !shareEnabled ||
      !sessionRef.current ||
      !access ||
      !membership
    ) {
      return;
    }

    setOperation("offline-sharing");
    setFeedback(null);

    try {
      const sequence = getNextSequence(localSequenceRef.current);
      localSequenceRef.current = sequence;
      const envelope = await encryptBannerTogetherLiveSnapshot({
        roomSecret: access.roomSecret,
        roomId: access.roomId,
        placeId,
        participantId: access.participantId,
        sequence,
        capturedAt: membership.capturedAt,
        agentName: localAgentName,
        shareWhileOffline: nextEnabled,
        lists: membership.lists,
      });
      const delivery = await sessionRef.current.publishSnapshot({
        sequence,
        envelope,
      });
      lastPublishedCapturedAtRef.current = membership.capturedAt;
      setShareWhileOffline(nextEnabled);
      const deferredCount = getDeferredDeliveryCount(delivery);

      setFeedback(
        nextEnabled
          ? {
              severity: deferredCount > 0 ? "warning" : "success",
              message:
                deferredCount > 0
                  ? `Offline sharing is enabled. ${deferredCount} peer ${
                      deferredCount === 1 ? "connection is" : "connections are"
                    } not ready to receive the retained snapshot yet.`
                  : "Current room members can keep comparing your shared lists if you go offline.",
            }
          : {
              severity: "info",
              message:
                "Your shared lists will be removed from comparisons when you go offline.",
            }
      );
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "Your offline sharing setting could not be changed.",
      });
    } finally {
      setOperation(null);
    }
  };

  const handleCopyInvite = async () => {
    if (!access) {
      return;
    }

    setOperation("copy");

    try {
      await copyTextToClipboard(
        createBannerTogetherLiveInviteUrl({
          origin: window.location.origin,
          placeId,
          roomId: access.roomId,
          roomSecret: access.roomSecret,
        })
      );
      setFeedback({ severity: "success", message: "Live room invite copied." });
    } catch {
      setFeedback({ severity: "error", message: "The invite could not be copied." });
    } finally {
      setOperation(null);
    }
  };

  const handleLeaveRoom = async () => {
    if (!access) {
      return;
    }

    setOperation("leave");
    setFeedback(null);

    try {
      await sessionRef.current?.close({ notifyServer: true });
    } catch {
      // Local room secrets are removed even when the departure signal fails.
    }

    sessionRef.current = null;
    clearBannerTogetherLiveAccess(access.roomId);
    setAccess(null);
    navigate(`/together/${encodeURIComponent(placeId)}`, { replace: true });
    setOperation(null);
  };

  const connectedPeerCount = Object.values(peerStates).filter(
    (state) => state === "connected"
  ).length;
  const knownPeerIds = [...new Set([
    ...initialPeers,
    ...Object.keys(peerStates),
    ...Object.keys(remoteSnapshots),
  ])]
    .filter(
      (participantId) =>
        participantId !== access?.participantId &&
        (peerStates[participantId] !== "left" ||
          remoteSnapshots[participantId]?.shareWhileOffline === true)
    )
    .sort();
  const cachedComparisonCapturedAt = [
    membershipSource === "cache" ? membership?.capturedAt : null,
    catalogSource === "cache" ? catalogCapturedAt : null,
  ]
    .filter(Boolean)
    .sort()[0] ?? null;

  return (
    <Container maxWidth={false} sx={{ py: { xs: 3, md: 5 } }}>
      <Box sx={{ maxWidth: 960, mb: 3 }}>
        <Typography variant="overline" color="text.secondary">
          {getPlaceLabel(place, placeId)}
        </Typography>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Banner Together
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {roomId ? "Live peer room" : "Start a live peer room"}
        </Typography>
      </Box>

      {placeError ? (
        <Alert severity="error" sx={{ mb: 2, maxWidth: 960 }}>
          {placeError}
        </Alert>
      ) : null}

      {roomError ? (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              component={Link}
              to={`/together/${encodeURIComponent(placeId)}`}
            >
              Start new
            </Button>
          }
          sx={{ mb: 2, maxWidth: 960 }}
        >
          {roomError}
        </Alert>
      ) : null}

      {feedback ? (
        <Alert severity={feedback.severity} sx={{ mb: 2, maxWidth: 960 }}>
          {feedback.message}
        </Alert>
      ) : null}

      {cacheWarning ? (
        <Alert severity="warning" sx={{ mb: 2, maxWidth: 960 }}>
          {cacheWarning}
        </Alert>
      ) : null}

      {membershipStatus === "auth-required" && isPlaceReady ? (
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent(BANNERGRESS_AUTH_REQUEST_EVENT)
                )
              }
            >
              Authenticate
            </Button>
          }
          sx={{ mb: 2, maxWidth: 960 }}
        >
          Authenticate with Bannergress when you want to compare or share your
          Todo, Done, and Hide lists.
        </Alert>
      ) : null}

      {membershipStatus === "error" ? (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              onClick={() =>
                setMembershipReloadToken((currentValue) => currentValue + 1)
              }
            >
              Retry
            </Button>
          }
          sx={{ mb: 2, maxWidth: 960 }}
        >
          {membershipError}
        </Alert>
      ) : null}

      {catalogStatus === "error" ? (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              onClick={() =>
                setCatalogReloadToken((currentValue) => currentValue + 1)
              }
            >
              Retry
            </Button>
          }
          sx={{ mb: 2, maxWidth: 960 }}
        >
          {catalogError}
        </Alert>
      ) : null}

      {(placeStatus === "loading" ||
        membershipStatus === "loading" ||
        membershipStatus === "refreshing" ||
        catalogStatus === "loading" ||
        catalogStatus === "refreshing" ||
        roomStatus === "reconnecting") &&
      roomStatus !== "error" ? (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">
            {roomStatus === "reconnecting"
              ? "Rejoining live room..."
              : membershipStatus === "loading" ||
                  membershipStatus === "refreshing"
                ? `Loading private lists${
                    membershipProgress ? ` (${membershipProgress})` : ""
                  }...`
                : catalogStatus === "loading" || catalogStatus === "refreshing"
                  ? `Loading place catalog${
                      catalog.length ? ` (${catalog.length})` : ""
                    }...`
                  : "Loading place..."}
          </Typography>
        </Stack>
      ) : null}

      {(membershipSource === "cache" || catalogSource === "cache") &&
      cachedComparisonCapturedAt ? (
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => {
                setMembershipReloadToken((currentValue) => currentValue + 1);
                setCatalogReloadToken((currentValue) => currentValue + 1);
              }}
              disabled={
                membershipStatus === "refreshing" ||
                catalogStatus === "refreshing"
              }
            >
              Refresh lists
            </Button>
          }
          sx={{ mb: 2, maxWidth: 960 }}
        >
          Using browser-cached comparison data from{" "}
          {formatDateTime(cachedComparisonCapturedAt)} ({
            formatSnapshotAge(
              cachedComparisonCapturedAt,
              cacheAgeNow
            )
          }).
        </Alert>
      ) : null}

      {!roomId && isPlaceReady ? (
        <Paper
          elevation={0}
          sx={{
            maxWidth: 960,
            p: { xs: 2, sm: 2.5 },
            mb: 3,
            borderRadius: 1,
            bgcolor: "rgba(18,25,31,0.92)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <Stack direction="row" spacing={1.25} alignItems="center">
              <GroupsRoundedIcon color="primary" />
              <Box>
                <Typography variant="subtitle1" component="h2">
                  New peer room
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Up to {MAX_ROOM_PARTICIPANTS} people
                </Typography>
              </Box>
            </Stack>
            <Button
              variant="contained"
              startIcon={
                operation === "create" ? (
                  <CircularProgress color="inherit" size={18} />
                ) : (
                  <GroupAddRoundedIcon />
                )
              }
              disabled={operation !== null || placeStatus !== "ready"}
              onClick={handleCreateRoom}
              sx={{ minHeight: 44 }}
            >
              Create and copy invite
            </Button>
          </Stack>
          <Alert severity="info" sx={{ mt: 2 }}>
            Creating a room does not share your lists. Keep this tab open while
            other people join.
          </Alert>
        </Paper>
      ) : null}

      {roomId && invite && !access && roomStatus !== "error" ? (
        <Paper
          elevation={0}
          sx={{
            maxWidth: 960,
            p: { xs: 2, sm: 2.5 },
            mb: 3,
            borderRadius: 1,
            bgcolor: "rgba(18,25,31,0.92)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <Box>
              <Typography variant="subtitle1" component="h2">
                Join live room
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Your Bannergress lists remain private after joining.
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={
                operation === "join" ? (
                  <CircularProgress color="inherit" size={18} />
                ) : (
                  <GroupAddRoundedIcon />
                )
              }
              disabled={operation !== null}
              onClick={handleJoinRoom}
              sx={{ minHeight: 44 }}
            >
              Join room
            </Button>
          </Stack>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Anyone holding the invite can join and decrypt data that room members
            explicitly share while connected.
          </Alert>
        </Paper>
      ) : null}

      {roomId && access ? (
        <Paper
          elevation={0}
          sx={{
            maxWidth: 960,
            p: { xs: 2, sm: 2.5 },
            mb: 3,
            borderRadius: 1,
            bgcolor: "rgba(18,25,31,0.92)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", md: "center" }}
          >
            <Stack direction="row" spacing={1.25} alignItems="center">
              <SecurityRoundedIcon color="primary" />
              <Box>
                <Typography variant="subtitle1" component="h2">
                  Live peer room
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    label={`${connectedPeerCount + 1} connected`}
                    sx={{ borderRadius: 1 }}
                  />
                  <Chip
                    size="small"
                    label={`Expires ${formatDateTime(access.expiresAt)}`}
                    sx={{ borderRadius: 1 }}
                  />
                </Stack>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button
                variant="outlined"
                startIcon={<ContentCopyRoundedIcon />}
                onClick={handleCopyInvite}
                disabled={operation !== null}
                sx={{ minHeight: 44 }}
              >
                Copy invite
              </Button>
              <Tooltip title="Leave room">
                <span>
                  <IconButton
                    aria-label="Leave live room"
                    color="error"
                    onClick={handleLeaveRoom}
                    disabled={operation !== null}
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 1,
                      border: "1px solid rgba(255,255,255,0.2)",
                    }}
                  >
                    <ExitToAppRoundedIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <Box>
              <Stack spacing={0}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={shareEnabled}
                      onChange={(event) =>
                        handleShareChange(event.target.checked)
                      }
                      disabled={
                        !sessionReady ||
                        membershipStatus !== "ready" ||
                        operation !== null
                      }
                      inputProps={{ "aria-label": "Share my lists" }}
                    />
                  }
                  label="Share my lists"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={shareWhileOffline}
                      onChange={(event) =>
                        handleOfflineSharingChange(event.target.checked)
                      }
                      disabled={
                        !shareEnabled ||
                        !sessionReady ||
                        membershipStatus !== "ready" ||
                        operation !== null
                      }
                      inputProps={{
                        "aria-label": "Continue sharing while offline",
                      }}
                    />
                  }
                  label="Continue sharing while offline"
                />
              </Stack>
              <MembershipChips membership={membership} />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {shareEnabled
                ? `${getMembershipCount(membership)} list entries shared peer to peer${
                    shareWhileOffline
                      ? "; current peers can keep them if you go offline"
                      : ""
                  }`
                : "Your list snapshot is not being sent"}
            </Typography>
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Participants
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip
              label={`${
                localAgentName ? `You (${localAgentName})` : "You"
              } - ${
                shareEnabled
                  ? shareWhileOffline
                    ? "sharing, including offline"
                    : "sharing"
                  : "private"
              }`}
              color={shareEnabled ? "success" : "default"}
              sx={{ borderRadius: 1, maxWidth: "100%" }}
            />
            {knownPeerIds.map((participantId) => {
              const peerState = peerStates[participantId] ?? "connecting";
              const peerSnapshot = remoteSnapshots[participantId];
              const peerSharing = isPeerSnapshotAvailable(
                peerSnapshot,
                peerState
              );

              return (
                <Chip
                  key={participantId}
                  label={`${getPeerLabel(participantId, peerSnapshot)} - ${
                    peerSharing
                      ? peerState === "connected"
                        ? "sharing"
                        : "sharing offline"
                      : peerState
                  }`}
                  color={peerSharing ? "success" : "default"}
                  sx={{ borderRadius: 1, maxWidth: "100%" }}
                />
              );
            })}
          </Stack>

          {knownPeerIds.some((participantId) =>
            isPeerSnapshotAvailable(
              remoteSnapshots[participantId],
              peerStates[participantId]
            )
          ) ? (
            <Stack spacing={0.25} sx={{ mt: 1 }}>
              {knownPeerIds.map((participantId) => {
                const peerSnapshot = remoteSnapshots[participantId];
                const peerState = peerStates[participantId];

                if (!isPeerSnapshotAvailable(peerSnapshot, peerState)) {
                  return null;
                }

                return (
                  <Typography
                    key={participantId}
                    variant="caption"
                    color="text.secondary"
                    sx={{ overflowWrap: "anywhere" }}
                  >
                    {getPeerLabel(participantId, peerSnapshot)}: {" "}
                    {peerSnapshot.lists.todo.length} to do, {" "}
                    {peerSnapshot.lists.done.length} done, {" "}
                    {peerSnapshot.lists.blacklist.length} hidden
                    {peerState === "connected"
                      ? ""
                      : ` (offline snapshot from ${formatDateTime(
                          peerSnapshot.capturedAt
                        )})`}
                  </Typography>
                );
              })}
            </Stack>
          ) : null}

          {knownPeerIds.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              Waiting for other people. Keep this tab open and send the invite.
            </Alert>
          ) : null}
        </Paper>
      ) : null}

      {access &&
      membershipStatus === "ready" &&
      comparisonParticipants.length < 2 ? (
        <Alert severity="info" sx={{ mb: 3, maxWidth: 960 }}>
          A connected participant needs to enable list sharing before comparisons
          appear.
        </Alert>
      ) : null}

      {comparisonParticipants.length >= 2 && access ? (
        <Paper
          elevation={0}
          sx={{
            maxWidth: 960,
            p: { xs: 2, sm: 2.5 },
            mb: 3,
            borderRadius: 1,
            bgcolor: "rgba(18,25,31,0.92)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Typography variant="subtitle1" component="h2" sx={{ mb: 2 }}>
            Compare shared list states
          </Typography>
          <BannerTogetherGroupComparisonBuilder
            participants={comparisonParticipants}
            localParticipantId={access.participantId}
            clauses={clauses}
            onChange={setClauses}
            resultCount={comparison.results.length}
          />
          {comparison.error ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {comparison.error}
            </Alert>
          ) : null}
        </Paper>
      ) : null}

      {comparisonParticipants.length >= 2 &&
      catalogStatus === "ready" &&
      !comparison.error ? (
        <Box>
          <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
            Matching banners
          </Typography>

          {comparison.missingMatchingCatalogCount > 0 ? (
            <Alert severity="warning" sx={{ mb: 2, maxWidth: 960 }}>
              {comparison.missingMatchingCatalogCount} {" "}
              {comparison.missingMatchingCatalogCount === 1
                ? "shared list entry matches"
                : "shared list entries match"} {" "}
              this comparison but cannot be shown because {" "}
              {comparison.missingMatchingCatalogCount === 1 ? "it is" : "they are"} {" "}
              missing from the current place catalog.
            </Alert>
          ) : comparison.missingCatalogCount > 0 ? (
            <Alert severity="info" sx={{ mb: 2, maxWidth: 960 }}>
              {comparison.missingCatalogCount} shared list {" "}
              {comparison.missingCatalogCount === 1 ? "entry is" : "entries are"} {" "}
              no longer available in this place catalog.
            </Alert>
          ) : null}

          {comparison.results.length === 0 ? (
            <Alert severity="info" sx={{ maxWidth: 960 }}>
              {comparison.missingMatchingCatalogCount > 0
                ? "No matching catalog cards are available."
                : "No banners match this comparison."}
            </Alert>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "minmax(0, 1fr)",
                  sm: "repeat(2, minmax(0, 1fr))",
                  md: "repeat(3, minmax(0, 1fr))",
                  xl: "repeat(4, minmax(0, 1fr))",
                },
                gap: 2.5,
                alignItems: "stretch",
              }}
            >
              {visibleResults.map((result) => (
                <Stack key={result.id} spacing={1} sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                    {comparisonParticipants.map((participant) => {
                      const status = result.participantStatuses[participant.id];

                      return (
                        <Chip
                          key={participant.id}
                          size="small"
                          color={STATUS_COLORS[status]}
                          label={`${participant.label}: ${getStatusLabel(status)}`}
                          sx={{ borderRadius: 1 }}
                        />
                      );
                    })}
                  </Stack>
                  <Box sx={{ display: "flex", minWidth: 0, flex: 1 }}>
                    <BannerCard
                      banner={{
                        ...result.banner,
                        listType: toCardListType(
                          result.participantStatuses[access.participantId]
                        ),
                      }}
                      maxWidth="100%"
                    />
                  </Box>
                </Stack>
              ))}
            </Box>
          )}

          {visibleResultCount < comparison.results.length ? (
            <Button
              variant="outlined"
              onClick={() =>
                setVisibleResultCount((currentValue) =>
                  Math.min(
                    currentValue + RESULT_PAGE_SIZE,
                    comparison.results.length
                  )
                )
              }
              sx={{ minHeight: 44, mt: 2 }}
            >
              Show more
            </Button>
          ) : null}
        </Box>
      ) : null}
    </Container>
  );
}
