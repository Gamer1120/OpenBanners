import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import BannerTogetherHeader from "./BannerTogetherHeader";
import { BannerTile } from "./BannerWall";
import BannerTogetherGroupComparisonBuilder from "./BannerTogetherGroupComparisonBuilder";
import {
  BANNERGRESS_AUTH_REQUEST_EVENT,
  useBannergressAuth,
  useBannergressDisplayName,
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
import { getLanguage, t, tk, tn } from "../i18n";

const RESULT_PAGE_SIZE = 24;
const MAX_ROOM_PARTICIPANTS = 8;
const ROOM_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const CACHE_WRITE_WARNING = tk(
  "This browser could not cache all comparison data, so a reload may need to fetch it again."
);

// Peer connection states shown on the participant chips.
const PEER_STATE_LABELS = {
  connecting: tk("connecting"),
  connected: tk("connected"),
  disconnected: tk("disconnected"),
  left: tk("left"),
};

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
  return new Intl.DateTimeFormat(getLanguage(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatSnapshotAge(value, now = Date.now()) {
  const ageMs = Math.max(0, now - new Date(value).getTime());
  const ageMinutes = Math.floor(ageMs / (60 * 1000));

  if (ageMinutes < 1) {
    return t("less than a minute old");
  }

  if (ageMinutes < 60) {
    return tn("{count} minute old", "{count} minutes old", ageMinutes);
  }

  const ageHours = Math.floor(ageMinutes / 60);
  const remainingMinutes = ageMinutes % 60;

  return remainingMinutes === 0
    ? tn("{count} hour old", "{count} hours old", ageHours)
    : tn("{count} hour {minutes} minutes old", "{count} hours {minutes} minutes old", ageHours, {
        minutes: remainingMinutes,
      });
}

function getMembershipCount(membership) {
  return Object.values(membership?.lists ?? {}).reduce(
    (total, bannerIds) => total + bannerIds.length,
    0
  );
}

function getPeerLabel(participantId, snapshot = null) {
  return snapshot?.agentName || t("Participant {id}", { id: participantId.slice(0, 4) });
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
  const label = BANNER_TOGETHER_GROUP_STATUS_OPTIONS.find(
    (option) => option.value === status
  )?.label;

  return label ? t(label) : status;
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
        label={t("{count} to do", { count: membership.lists.todo.length })}
        sx={{ borderRadius: 1 }}
      />
      <Chip
        size="small"
        color="success"
        label={t("{count} done", { count: membership.lists.done.length })}
        sx={{ borderRadius: 1 }}
      />
      <Chip
        size="small"
        color="error"
        label={t("{count} hidden", { count: membership.lists.blacklist.length })}
        sx={{ borderRadius: 1 }}
      />
    </Stack>
  );
}

export default function BannerTogetherLivePage({ placeId, roomId = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const authState = useBannergressAuth();
  const hasAuthCredentials = Boolean(
    authState.accessToken || authState.refreshToken
  );
  // Agent name sent with the shared list snapshot: the same Bannergress /user
  // name as the top bar (the sign-in tokens carry none). It can arrive after
  // the room is joined; a shared snapshot is then sent again with it.
  const localAgentName = useBannergressDisplayName(hasAuthCredentials);
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
  const lastPublishedAgentNameRef = useRef(null);
  const cacheWriteFailuresRef = useRef({ catalog: false, membership: false });
  const isPlaceReady = placeStatus === "ready" && place?.id === placeId;
  const recordCacheWriteResult = (source, succeeded) => {
    cacheWriteFailuresRef.current[source] = !succeeded;
    setCacheWarning(
      Object.values(cacheWriteFailuresRef.current).some(Boolean)
        ? t(CACHE_WRITE_WARNING)
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
        setPlaceError(t("This Bannergress place could not be loaded."));
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
          : t("The place banner catalog could not be loaded.")
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
          : t("The private banner lists could not be loaded.")
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
        error instanceof Error ? error.message : t("This live room link is invalid.")
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
              : t("This live room invite is invalid.")
            : t("Room access is not stored on this device. Open the invite link again.")
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
              : t("The live room could not be rejoined.")
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
                  : t("A peer snapshot could not be decrypted."),
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
          message: t("The live connection expired and is rejoining privately."),
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
                : t("A peer connection encountered an error."),
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
              : t("The peer room could not be started.")
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
      (membership.capturedAt === lastPublishedCapturedAtRef.current &&
        (localAgentName ?? null) === lastPublishedAgentNameRef.current)
    ) {
      return undefined;
    }

    let active = true;
    // Only the agent name changed (it loaded after sharing started): send the
    // same lists again with it, without a message. Older clients just see a
    // newer snapshot.
    const nameOnly = membership.capturedAt === lastPublishedCapturedAtRef.current;
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

      lastPublishedAgentNameRef.current = localAgentName ?? null;

      if (active) {
        lastPublishedCapturedAtRef.current = membership.capturedAt;

        if (nameOnly) {
          return;
        }

        const deferredCount = getDeferredDeliveryCount(delivery);
        setFeedback(
          deferredCount > 0
            ? {
                severity: "warning",
                message: tn(
                  "The refreshed snapshot is retained for {count} peer connection that is not ready yet.",
                  "The refreshed snapshot is retained for {count} peer connections that are not ready yet.",
                  deferredCount
                ),
              }
            : {
                severity: "success",
                message: t("The refreshed list snapshot is now shared."),
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
              : t("The refreshed list snapshot could not be shared."),
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
        label: t("You"),
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
            : t("This group comparison is invalid."),
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
        setFeedback({ severity: "success", message: t("Live room invite copied.") });
      } catch {
        setFeedback({
          severity: "warning",
          message: t("The room was created, but the invite could not be copied."),
        });
      }

      navigate(
        `/lists/together/${encodeURIComponent(placeId)}/live/${encodeURIComponent(
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
            : t("The live room could not be created."),
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
        message: t("Joined. Your lists are still private."),
      });
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : t("The live room could not be joined."),
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
          throw new Error(t("Authenticate before sharing your lists."));
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
        lastPublishedAgentNameRef.current = localAgentName ?? null;
        setShareEnabled(true);
        const deferredCount = getDeferredDeliveryCount(delivery);
        setFeedback(
          deferredCount > 0
            ? {
                severity: "warning",
                message: tn(
                  "Sharing is enabled. {count} peer connection is not ready yet and will receive the snapshot after connecting.",
                  "Sharing is enabled. {count} peer connections are not ready yet and will receive the snapshot after connecting.",
                  deferredCount
                ),
              }
            : {
                severity: "success",
                message: t("Your lists are now shared with connected room members."),
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
                message: tn(
                  "You stopped sharing. {count} disconnected peer will receive the withdrawal if they reconnect.",
                  "You stopped sharing. {count} disconnected peers will receive the withdrawal if they reconnect.",
                  deferredCount
                ),
              }
            : {
                severity: "info",
                message: t("You stopped sharing your lists."),
              }
        );
      }
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : t("Your sharing setting could not be changed."),
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
      lastPublishedAgentNameRef.current = localAgentName ?? null;
      setShareWhileOffline(nextEnabled);
      const deferredCount = getDeferredDeliveryCount(delivery);

      setFeedback(
        nextEnabled
          ? {
              severity: deferredCount > 0 ? "warning" : "success",
              message:
                deferredCount > 0
                  ? tn(
                      "Offline sharing is enabled. {count} peer connection is not ready to receive the retained snapshot yet.",
                      "Offline sharing is enabled. {count} peer connections are not ready to receive the retained snapshot yet.",
                      deferredCount
                    )
                  : t("Current room members can keep comparing your shared lists if you go offline."),
            }
          : {
              severity: "info",
              message:
                t("Your shared lists will be removed from comparisons when you go offline."),
            }
      );
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : t("Your offline sharing setting could not be changed."),
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
      setFeedback({ severity: "success", message: t("Live room invite copied.") });
    } catch {
      setFeedback({ severity: "error", message: t("The invite could not be copied.") });
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
    navigate(`/lists/together/${encodeURIComponent(placeId)}`, { replace: true });
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
    <div className="ob-page bt-page">
      <BannerTogetherHeader
        placeLabel={getPlaceLabel(place, placeId)}
        subtitle={roomId ? t("Live peer room") : t("Start a live peer room")}
      />

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
              to={`/lists/together/${encodeURIComponent(placeId)}`}
            >
              {t("Start new")}
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
              {t("Authenticate")}
            </Button>
          }
          sx={{ mb: 2, maxWidth: 960 }}
        >
          {t("Authenticate with Bannergress when you want to compare or share your Todo, Done, and Hide lists.")}
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
              {t("Retry")}
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
              {t("Retry")}
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
              ? t("Rejoining live room...")
              : membershipStatus === "loading" ||
                  membershipStatus === "refreshing"
                ? membershipProgress
                  ? t("Loading private lists ({count})...", { count: membershipProgress })
                  : t("Loading private lists...")
                : catalogStatus === "loading" || catalogStatus === "refreshing"
                  ? catalog.length
                    ? t("Loading place catalog ({count})...", { count: catalog.length })
                    : t("Loading place catalog...")
                  : t("Loading place...")}
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
              {t("Refresh lists")}
            </Button>
          }
          sx={{ mb: 2, maxWidth: 960 }}
        >
          {t("Using browser-cached comparison data from {date} ({age}).", {
            date: formatDateTime(cachedComparisonCapturedAt),
            age: formatSnapshotAge(cachedComparisonCapturedAt, cacheAgeNow),
          })}
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
            bgcolor: "var(--sc-low)",
            border: "1px solid var(--outline-variant)",
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
                  {t("New peer room")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("Up to {count} people", { count: MAX_ROOM_PARTICIPANTS })}
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
              {t("Create and copy invite")}
            </Button>
          </Stack>
          <Alert severity="info" sx={{ mt: 2 }}>
            {t("Creating a room does not share your lists. Keep this tab open while other people join.")}
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
            bgcolor: "var(--sc-low)",
            border: "1px solid var(--outline-variant)",
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
                {t("Join live room")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("Your Bannergress lists remain private after joining.")}
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
              {t("Join room")}
            </Button>
          </Stack>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t("Anyone holding the invite can join and decrypt data that room members explicitly share while connected.")}
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
            bgcolor: "var(--sc-low)",
            border: "1px solid var(--outline-variant)",
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
                  {t("Live peer room")}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    label={t("{count} connected", { count: connectedPeerCount + 1 })}
                    sx={{ borderRadius: 1 }}
                  />
                  <Chip
                    size="small"
                    label={t("Expires {date}", { date: formatDateTime(access.expiresAt) })}
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
                {t("Copy invite")}
              </Button>
              <Tooltip title={t("Leave room")}>
                <span>
                  <IconButton
                    aria-label={t("Leave live room")}
                    color="error"
                    onClick={handleLeaveRoom}
                    disabled={operation !== null}
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 1,
                      border: "1px solid var(--outline-variant)",
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
                      inputProps={{ "aria-label": t("Share my lists") }}
                    />
                  }
                  label={t("Share my lists")}
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
                        "aria-label": t("Continue sharing while offline"),
                      }}
                    />
                  }
                  label={t("Continue sharing while offline")}
                />
              </Stack>
              <MembershipChips membership={membership} />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {shareEnabled
                ? shareWhileOffline
                  ? tn(
                      "{count} list entry shared peer to peer; current peers can keep it if you go offline",
                      "{count} list entries shared peer to peer; current peers can keep them if you go offline",
                      getMembershipCount(membership)
                    )
                  : tn(
                      "{count} list entry shared peer to peer",
                      "{count} list entries shared peer to peer",
                      getMembershipCount(membership)
                    )
                : t("Your list snapshot is not being sent")}
            </Typography>
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t("Participants")}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip
              label={`${
                localAgentName ? t("You ({agent})", { agent: localAgentName }) : t("You")
              } - ${
                shareEnabled
                  ? shareWhileOffline
                    ? t("sharing, including offline")
                    : t("sharing")
                  : t("private")
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
                        ? t("sharing")
                        : t("sharing offline")
                      : t(PEER_STATE_LABELS[peerState] ?? peerState)
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
                    {t(
                      peerState === "connected"
                        ? "{agent}: {todo} to do, {done} done, {hidden} hidden"
                        : "{agent}: {todo} to do, {done} done, {hidden} hidden (offline snapshot from {date})",
                      {
                        agent: getPeerLabel(participantId, peerSnapshot),
                        todo: peerSnapshot.lists.todo.length,
                        done: peerSnapshot.lists.done.length,
                        hidden: peerSnapshot.lists.blacklist.length,
                        date: formatDateTime(peerSnapshot.capturedAt),
                      }
                    )}
                  </Typography>
                );
              })}
            </Stack>
          ) : null}

          {knownPeerIds.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              {t("Waiting for other people. Keep this tab open and send the invite.")}
            </Alert>
          ) : null}
        </Paper>
      ) : null}

      {access &&
      membershipStatus === "ready" &&
      comparisonParticipants.length < 2 ? (
        <Alert severity="info" sx={{ mb: 3, maxWidth: 960 }}>
          {t("A connected participant needs to enable list sharing before comparisons appear.")}
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
            bgcolor: "var(--sc-low)",
            border: "1px solid var(--outline-variant)",
          }}
        >
          <Typography variant="subtitle1" component="h2" sx={{ mb: 2 }}>
            {t("Compare shared list states")}
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
            {t("Matching banners")}
          </Typography>

          {comparison.missingMatchingCatalogCount > 0 ? (
            <Alert severity="warning" sx={{ mb: 2, maxWidth: 960 }}>
              {tn(
                "{count} shared list entry matches this comparison but cannot be shown because it is missing from the current place catalog.",
                "{count} shared list entries match this comparison but cannot be shown because they are missing from the current place catalog.",
                comparison.missingMatchingCatalogCount
              )}
            </Alert>
          ) : comparison.missingCatalogCount > 0 ? (
            <Alert severity="info" sx={{ mb: 2, maxWidth: 960 }}>
              {tn(
                "{count} shared list entry is no longer available in this place catalog.",
                "{count} shared list entries are no longer available in this place catalog.",
                comparison.missingCatalogCount
              )}
            </Alert>
          ) : null}

          {comparison.results.length === 0 ? (
            <Alert severity="info" sx={{ maxWidth: 960 }}>
              {comparison.missingMatchingCatalogCount > 0
                ? t("No matching catalog cards are available.")
                : t("No banners match this comparison.")}
            </Alert>
          ) : (
            <div className="bt-grid" role="list" aria-label={t("Matching banners")}>
              {visibleResults.map((result) => (
                <div key={result.id} className="bt-result" role="listitem">
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                    {comparisonParticipants.map((participant) => {
                      const status = result.participantStatuses[participant.id];

                      return (
                        <Chip
                          key={participant.id}
                          size="small"
                          color={STATUS_COLORS[status]}
                          label={`${participant.label}: ${getStatusLabel(status)}`}
                        />
                      );
                    })}
                  </Stack>
                  <BannerTile
                    banner={result.banner}
                    listType={toCardListType(
                      result.participantStatuses[access.participantId]
                    )}
                  />
                </div>
              ))}
            </div>
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
              {t("Show more")}
            </Button>
          ) : null}
        </Box>
      ) : null}
    </div>
  );
}
