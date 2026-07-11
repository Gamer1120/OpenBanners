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
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DeleteForeverRoundedIcon from "@mui/icons-material/DeleteForeverRounded";
import GroupAddRoundedIcon from "@mui/icons-material/GroupAddRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SecurityRoundedIcon from "@mui/icons-material/SecurityRounded";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import BannerCard from "./BannerCard";
import BannerTogetherComparisonBuilder from "./BannerTogetherComparisonBuilder";
import {
  BANNERGRESS_AUTH_REQUEST_EVENT,
  useBannergressAuth,
} from "../bannergressSync";
import {
  BANNER_TOGETHER_DEFAULT_COMPARISON_PRESET_ID,
  createBannerTogetherMembershipIndexFromLists,
  evaluateBannerTogetherComparison,
  getBannerTogetherComparisonPresetClauses,
  getBannerTogetherComparisonRoleLabels,
  getBannerTogetherComparisonStatusLabel,
} from "../bannerTogetherComparison";
import {
  fetchBannerTogetherCatalog,
  fetchBannerTogetherMembership,
} from "../bannerTogetherData";
import {
  clearBannerTogetherPendingJoin,
  clearBannerTogetherRoomAccess,
  createBannerTogetherRoomGuestAccess,
  createBannerTogetherRoomInviteUrl,
  createBannerTogetherRoomSecrets,
  decryptBannerTogetherRoomSnapshot,
  encryptBannerTogetherRoomSnapshot,
  hashBannerTogetherRoomCapability,
  loadBannerTogetherPendingJoin,
  loadBannerTogetherRoomAccess,
  parseBannerTogetherRoomInviteHash,
  saveBannerTogetherPendingJoin,
  saveBannerTogetherRoomAccess,
  BANNER_TOGETHER_ROOM_MAX_AGE_MS,
  BANNER_TOGETHER_ROOM_VERSION,
} from "../bannerTogetherRoomCrypto";
import {
  createBannerTogetherRoom,
  deleteBannerTogetherRoom,
  getBannerTogetherRoom,
  joinBannerTogetherRoom,
  putBannerTogetherRoomSnapshot,
} from "../bannerTogetherRoomApi";

const RESULT_PAGE_SIZE = 24;
const ROOM_POLL_INTERVAL_MS = 5000;

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

function getMembershipCount(membership) {
  return Object.values(membership?.lists ?? {}).reduce(
    (total, bannerIds) => total + bannerIds.length,
    0
  );
}

function membershipsMatch(firstMembership, secondMembership) {
  if (firstMembership?.capturedAt !== secondMembership?.capturedAt) {
    return false;
  }

  return ["todo", "done", "blacklist"].every((listType) => {
    const firstIds = firstMembership?.lists?.[listType];
    const secondIds = secondMembership?.lists?.[listType];

    return (
      Array.isArray(firstIds) &&
      Array.isArray(secondIds) &&
      firstIds.length === secondIds.length &&
      firstIds.every((bannerId, index) => bannerId === secondIds[index])
    );
  });
}

function createInitialAccess({
  roomId,
  placeId,
  role,
  roomKey,
  capability,
  joinCapability,
  expiresAt,
  highestSequences,
}) {
  return {
    version: BANNER_TOGETHER_ROOM_VERSION,
    roomId,
    placeId,
    role,
    roomKey,
    capability,
    joinCapability,
    expiresAt,
    highestSequences,
  };
}

function createProvisionalExpiry() {
  return new Date(Date.now() + BANNER_TOGETHER_ROOM_MAX_AGE_MS).toISOString();
}

function getViewerRole(roomRole) {
  return roomRole === "owner" ? "creator" : "recipient";
}

function getOtherRoomRole(roomRole) {
  return roomRole === "owner" ? "guest" : "owner";
}

function toCardListType(status) {
  if (status === "hidden") {
    return "blacklist";
  }

  return status === "unlisted" ? null : status;
}

function MembershipChips({ membership }) {
  if (!membership) {
    return null;
  }

  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      <Chip
        size="small"
        label={`${membership.lists.todo.length} to do`}
        color="warning"
        sx={{ borderRadius: 1 }}
      />
      <Chip
        size="small"
        label={`${membership.lists.done.length} done`}
        color="success"
        sx={{ borderRadius: 1 }}
      />
      <Chip
        size="small"
        label={`${membership.lists.blacklist.length} hidden`}
        color="error"
        sx={{ borderRadius: 1 }}
      />
    </Stack>
  );
}

export default function BannerTogetherRoomPage({ placeId, roomId = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const authState = useBannergressAuth();
  const hasAuthCredentials = Boolean(
    authState.accessToken || authState.refreshToken
  );
  const [place, setPlace] = useState(null);
  const [placeStatus, setPlaceStatus] = useState("loading");
  const [placeError, setPlaceError] = useState("");
  const [membership, setMembership] = useState(null);
  const [membershipStatus, setMembershipStatus] = useState("checking-auth");
  const [membershipProgress, setMembershipProgress] = useState(0);
  const [membershipError, setMembershipError] = useState("");
  const [membershipReloadToken, setMembershipReloadToken] = useState(0);
  const [invite, setInvite] = useState(null);
  const [access, setAccess] = useState(null);
  const [room, setRoom] = useState(null);
  const [roomStatus, setRoomStatus] = useState(roomId ? "loading" : "new");
  const [roomError, setRoomError] = useState("");
  const [roomReloadToken, setRoomReloadToken] = useState(0);
  const [remoteSnapshot, setRemoteSnapshot] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [catalogStatus, setCatalogStatus] = useState("idle");
  const [catalogError, setCatalogError] = useState("");
  const [operation, setOperation] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [clauses, setClauses] = useState(() =>
    getBannerTogetherComparisonPresetClauses(
      BANNER_TOGETHER_DEFAULT_COMPARISON_PRESET_ID
    )
  );
  const [visibleResultCount, setVisibleResultCount] = useState(RESULT_PAGE_SIZE);
  const pendingCreateSecretsRef = useRef(null);
  const previousRouteRef = useRef({ placeId, roomId });
  const roomLoadGenerationRef = useRef(0);
  const isPlaceReady = placeStatus === "ready" && place?.id === placeId;

  useEffect(() => {
    let ignore = false;
    setPlace(null);
    setPlaceStatus("loading");
    setPlaceError("");

    fetch(`https://api.bannergress.com/places/${encodeURIComponent(placeId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Place not found.");
        }

        return response.json();
      })
      .then((data) => {
        if (!ignore && data && typeof data === "object" && data.id === placeId) {
          setPlace(data);
          setPlaceStatus("ready");
        } else if (!ignore) {
          setPlaceStatus("error");
          setPlaceError("This Bannergress place could not be loaded.");
        }
      })
      .catch((error) => {
        console.error("Couldn't load Banner Together place.", error);

        if (!ignore) {
          setPlaceStatus("error");
          setPlaceError("This Bannergress place could not be loaded.");
        }
      });

    return () => {
      ignore = true;
    };
  }, [placeId]);

  useEffect(() => {
    const previousRoute = previousRouteRef.current;

    setRoom(null);
    setRemoteSnapshot(null);
    setRoomError("");
    if (
      previousRoute.placeId !== placeId ||
      (previousRoute.roomId !== roomId && previousRoute.roomId !== null)
    ) {
      setFeedback(null);
    }
    previousRouteRef.current = { placeId, roomId };

    if (!roomId) {
      setAccess(null);
      setInvite(null);
      setRoomStatus("new");
      return;
    }

    const storedAccess = loadBannerTogetherRoomAccess(roomId);

    if (storedAccess?.placeId === placeId) {
      clearBannerTogetherPendingJoin(roomId);
      setAccess(storedAccess);
      setInvite(null);
      setRoomStatus("loading");

      if (location.hash) {
        navigate(
          {
            pathname: location.pathname,
            search: location.search,
            hash: "",
          },
          { replace: true }
        );
      }
      return;
    }

    setAccess(null);

    try {
      const parsedInvite = parseBannerTogetherRoomInviteHash(location.hash, {
        roomId,
        placeId,
      });
      setInvite(parsedInvite);
      setRoomStatus("invite");
    } catch (error) {
      setInvite(null);
      setRoomStatus("error");
      setRoomError(
        location.hash
          ? error instanceof Error
            ? error.message
            : "This encrypted room invite is invalid."
          : "Room access is not stored on this device. Open the original invite link."
      );
    }
  }, [location.hash, location.pathname, location.search, navigate, placeId, roomId]);

  useEffect(() => {
    if (!isPlaceReady) {
      setMembership(null);
      setMembershipStatus("checking-auth");
      setMembershipError("");
      return undefined;
    }

    if (!hasAuthCredentials) {
      setMembership(null);
      setMembershipStatus("auth-required");
      setMembershipError("");
      return undefined;
    }

    let ignore = false;
    const abortController = new AbortController();
    setMembership(null);
    setMembershipStatus("loading");
    setMembershipProgress(0);
    setMembershipError("");

    fetchBannerTogetherMembership(placeId, {
      signal: abortController.signal,
      onProgress: (nextProgress) => {
        if (!ignore) {
          setMembershipProgress(nextProgress);
        }
      },
    })
      .then((nextMembership) => {
        if (ignore) {
          return;
        }

        setMembership(nextMembership);
        setMembershipStatus("ready");
      })
      .catch((error) => {
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
    authState.refreshToken,
    hasAuthCredentials,
    isPlaceReady,
    membershipReloadToken,
    placeId,
  ]);

  useEffect(() => {
    const loadGeneration = ++roomLoadGenerationRef.current;

    if (!access || !roomId || !isPlaceReady) {
      return undefined;
    }

    let ignore = false;
    const abortController = new AbortController();
    setRoomStatus((currentStatus) =>
      currentStatus === "ready" ? currentStatus : "loading"
    );
    setRoomError("");

    getBannerTogetherRoom({
      roomId,
      capability: access.capability,
      signal: abortController.signal,
    })
      .then(async (nextRoom) => {
        if (ignore || roomLoadGenerationRef.current !== loadGeneration) {
          return;
        }

        const storedAccess = loadBannerTogetherRoomAccess(roomId);
        const storedAccessMatches =
          storedAccess?.placeId === access.placeId &&
          storedAccess?.role === access.role &&
          storedAccess?.roomKey === access.roomKey &&
          storedAccess?.capability === access.capability;
        const highestSequences = {
          owner: Math.max(
            access.highestSequences?.owner ?? 0,
            storedAccessMatches ? storedAccess.highestSequences.owner : 0
          ),
          guest: Math.max(
            access.highestSequences?.guest ?? 0,
            storedAccessMatches ? storedAccess.highestSequences.guest : 0
          ),
        };

        ["owner", "guest"].forEach((role) => {
          const observedSequence = highestSequences[role];
          const returnedSequence = nextRoom.snapshots[role]?.sequence ?? 0;

          if (returnedSequence < observedSequence) {
            throw new Error("The encrypted room returned an older snapshot.");
          }
        });

        const remoteRole = getOtherRoomRole(access.role);
        const remoteSlot = nextRoom.snapshots[remoteRole];
        let nextRemoteSnapshot = null;

        if (remoteSlot) {
          nextRemoteSnapshot = await decryptBannerTogetherRoomSnapshot({
            roomKey: access.roomKey,
            roomId,
            placeId,
            participant: remoteRole,
            sequence: remoteSlot.sequence,
            envelope: remoteSlot.envelope,
          });
        }

        if (ignore || roomLoadGenerationRef.current !== loadGeneration) {
          return;
        }

        const nextHighestSequences = {
          owner: Math.max(
            highestSequences.owner,
            nextRoom.snapshots.owner?.sequence ?? 0
          ),
          guest: Math.max(
            highestSequences.guest,
            nextRoom.snapshots.guest?.sequence ?? 0
          ),
        };
        const nextAccess = saveBannerTogetherRoomAccess({
          ...access,
          expiresAt: nextRoom.expiresAt,
          highestSequences: nextHighestSequences,
        });

        setAccess(nextAccess);
        setRoom(nextRoom);
        setRemoteSnapshot(nextRemoteSnapshot);
        setRoomStatus("ready");
      })
      .catch((error) => {
        if (
          ignore ||
          roomLoadGenerationRef.current !== loadGeneration ||
          error?.name === "AbortError"
        ) {
          return;
        }

        console.error("Couldn't load encrypted Banner Together room.", error);
        setRoomStatus("error");
        setRoomError(
          error instanceof Error
            ? error.message
            : "The encrypted comparison room could not be loaded."
        );
      });

    return () => {
      ignore = true;
      abortController.abort();
    };
  }, [
    access?.capability,
    access?.role,
    access?.roomKey,
    isPlaceReady,
    placeId,
    roomId,
    roomReloadToken,
  ]);

  useEffect(() => {
    if (
      access?.role !== "owner" ||
      roomStatus !== "ready" ||
      room?.snapshots.guest
    ) {
      return undefined;
    }

    const interval = window.setInterval(
      () => setRoomReloadToken((currentValue) => currentValue + 1),
      ROOM_POLL_INTERVAL_MS
    );
    return () => window.clearInterval(interval);
  }, [access?.role, room?.snapshots.guest, roomStatus]);

  useEffect(() => {
    if (!remoteSnapshot || membershipStatus !== "ready") {
      setCatalog([]);
      setCatalogStatus("idle");
      setCatalogError("");
      return undefined;
    }

    let ignore = false;
    const abortController = new AbortController();
    setCatalog([]);
    setCatalogStatus("loading");
    setCatalogError("");

    fetchBannerTogetherCatalog(placeId, {
      signal: abortController.signal,
      onPage: (nextCatalog) => {
        if (!ignore) {
          setCatalog(nextCatalog);
        }
      },
    })
      .then((nextCatalog) => {
        if (ignore) {
          return;
        }

        setCatalog(nextCatalog);
        setCatalogStatus("ready");
      })
      .catch((error) => {
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
  }, [membershipStatus, placeId, remoteSnapshot]);

  const viewerRole = access ? getViewerRole(access.role) : "creator";
  const roleLabels = getBannerTogetherComparisonRoleLabels(viewerRole);
  const comparison = useMemo(() => {
    if (!remoteSnapshot || !membership) {
      return { results: [], missingCatalogCount: 0, error: "" };
    }

    try {
      const creatorLists =
        access?.role === "owner" ? membership.lists : remoteSnapshot.lists;
      const recipientLists =
        access?.role === "owner" ? remoteSnapshot.lists : membership.lists;
      return {
        ...evaluateBannerTogetherComparison({
          catalogBanners: catalog,
          creatorMemberships:
            createBannerTogetherMembershipIndexFromLists(creatorLists),
          recipientMemberships:
            createBannerTogetherMembershipIndexFromLists(recipientLists),
          clauses,
        }),
        error: "",
      };
    } catch (error) {
      return {
        results: [],
        missingCatalogCount: 0,
        error:
          error instanceof Error
            ? error.message
            : "This comparison rule is invalid.",
      };
    }
  }, [access?.role, catalog, clauses, membership, remoteSnapshot]);
  const visibleResults = comparison.results.slice(0, visibleResultCount);

  useEffect(() => {
    setVisibleResultCount(RESULT_PAGE_SIZE);
  }, [clauses, roomId]);

  const publishMembership = async (nextMembership, currentAccess = access) => {
    if (!currentAccess || !roomId) {
      throw new Error("Room access is unavailable on this device.");
    }

    const expectedSequence = Math.max(
      room?.snapshots[currentAccess.role]?.sequence ?? 0,
      currentAccess.highestSequences?.[currentAccess.role] ?? 0
    );
    const nextSequence = expectedSequence + 1;
    const envelope = await encryptBannerTogetherRoomSnapshot({
      roomKey: currentAccess.roomKey,
      roomId,
      placeId,
      participant: currentAccess.role,
      sequence: nextSequence,
      capturedAt: nextMembership.capturedAt,
      lists: nextMembership.lists,
    });
    try {
      await putBannerTogetherRoomSnapshot({
        roomId,
        role: currentAccess.role,
        capability: currentAccess.capability,
        expectedSequence,
        envelope,
      });
    } catch (uploadError) {
      const recoveredRoom = await getBannerTogetherRoom({
        roomId,
        capability: currentAccess.capability,
      });
      const recoveredSlot = recoveredRoom.snapshots[currentAccess.role];

      if (recoveredSlot?.sequence !== nextSequence) {
        throw uploadError;
      }

      const recoveredMembership = await decryptBannerTogetherRoomSnapshot({
        roomKey: currentAccess.roomKey,
        roomId,
        placeId,
        participant: currentAccess.role,
        sequence: recoveredSlot.sequence,
        envelope: recoveredSlot.envelope,
      });

      if (!membershipsMatch(recoveredMembership, nextMembership)) {
        throw new Error(
          "The room contains a different encrypted list snapshot."
        );
      }

      setRoom(recoveredRoom);
    }

    const nextAccess = saveBannerTogetherRoomAccess({
      ...currentAccess,
      highestSequences: {
        ...currentAccess.highestSequences,
        [currentAccess.role]: nextSequence,
      },
    });
    setAccess(nextAccess);
    setRoomReloadToken((currentValue) => currentValue + 1);
  };

  const handleCreateRoom = async () => {
    if (!membership) {
      return;
    }

    setOperation("create");
    setFeedback(null);
    let createdRoom = null;
    let secrets = null;
    let snapshotUploadAttempted = false;

    try {
      secrets =
        pendingCreateSecretsRef.current ??
        (await createBannerTogetherRoomSecrets());
      pendingCreateSecretsRef.current = secrets;
      createdRoom = await createBannerTogetherRoom({
        ownerCapabilityHash: secrets.ownerCapabilityHash,
        joinCapabilityHash: secrets.joinCapabilityHash,
        idempotencyKey: secrets.ownerCapabilityHash,
      });
      const envelope = await encryptBannerTogetherRoomSnapshot({
        roomKey: secrets.roomKey,
        roomId: createdRoom.roomId,
        placeId,
        participant: "owner",
        sequence: 1,
        capturedAt: membership.capturedAt,
        lists: membership.lists,
      });
      try {
        snapshotUploadAttempted = true;
        await putBannerTogetherRoomSnapshot({
          roomId: createdRoom.roomId,
          role: "owner",
          capability: secrets.ownerCapability,
          expectedSequence: 0,
          envelope,
        });
      } catch (uploadError) {
        let recoveredRoom;

        try {
          recoveredRoom = await getBannerTogetherRoom({
            roomId: createdRoom.roomId,
            capability: secrets.ownerCapability,
          });
          const recoveredSlot = recoveredRoom.snapshots.owner;

          if (recoveredSlot?.sequence !== 1) {
            throw uploadError;
          }

          const recoveredMembership = await decryptBannerTogetherRoomSnapshot({
            roomKey: secrets.roomKey,
            roomId: createdRoom.roomId,
            placeId,
            participant: "owner",
            sequence: recoveredSlot.sequence,
            envelope: recoveredSlot.envelope,
          });

          if (!membershipsMatch(recoveredMembership, membership)) {
            throw new Error(
              "The room contains a different encrypted list snapshot."
            );
          }
        } catch (recoveryError) {
          if (recoveryError === uploadError) {
            throw uploadError;
          }

          throw recoveryError;
        }

        createdRoom = {
          ...createdRoom,
          expiresAt: recoveredRoom.expiresAt,
        };
      }
      const nextAccess = saveBannerTogetherRoomAccess(
        createInitialAccess({
          roomId: createdRoom.roomId,
          placeId,
          role: "owner",
          roomKey: secrets.roomKey,
          capability: secrets.ownerCapability,
          joinCapability: secrets.joinCapability,
          expiresAt: createdRoom.expiresAt,
          highestSequences: { owner: 1, guest: 0 },
        })
      );
      const inviteUrl = createBannerTogetherRoomInviteUrl({
        origin: window.location.origin,
        placeId,
        roomId: createdRoom.roomId,
        roomKey: secrets.roomKey,
        joinCapability: secrets.joinCapability,
      });

      pendingCreateSecretsRef.current = null;
      setAccess(nextAccess);
      try {
        await copyTextToClipboard(inviteUrl);
        setFeedback({ severity: "success", message: "Short encrypted invite copied." });
      } catch {
        setFeedback({
          severity: "warning",
          message: "The room was created, but the invite could not be copied.",
        });
      }
      navigate(
        `/together/${encodeURIComponent(placeId)}/room/${encodeURIComponent(
          createdRoom.roomId
        )}`,
        { replace: true }
      );
    } catch (error) {
      if (
        createdRoom &&
        secrets?.ownerCapability &&
        !snapshotUploadAttempted
      ) {
        await deleteBannerTogetherRoom({
          roomId: createdRoom.roomId,
          ownerCapability: secrets.ownerCapability,
        }).catch(() => {});
        pendingCreateSecretsRef.current = null;
      }
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "The encrypted room could not be created.",
      });
    } finally {
      setOperation(null);
    }
  };

  const handleJoinRoom = async () => {
    if (!invite || !membership || !roomId) {
      return;
    }

    setOperation("join");
    setFeedback(null);

    try {
      const pendingJoin = loadBannerTogetherPendingJoin(roomId);
      const pendingJoinMatches = Boolean(
        pendingJoin?.placeId === placeId &&
          pendingJoin.roomKey === invite.roomKey &&
          pendingJoin.joinCapability === invite.joinCapability
      );
      const guestAccess = pendingJoinMatches
        ? {
            guestCapability: pendingJoin.guestCapability,
            guestCapabilityHash: await hashBannerTogetherRoomCapability(
              pendingJoin.guestCapability
            ),
          }
        : await createBannerTogetherRoomGuestAccess();
      saveBannerTogetherPendingJoin({
        version: BANNER_TOGETHER_ROOM_VERSION,
        roomId,
        placeId,
        roomKey: invite.roomKey,
        joinCapability: invite.joinCapability,
        guestCapability: guestAccess.guestCapability,
        expiresAt: pendingJoinMatches
          ? pendingJoin.expiresAt
          : createProvisionalExpiry(),
      });
      await joinBannerTogetherRoom({
        roomId,
        joinCapability: invite.joinCapability,
        guestCapabilityHash: guestAccess.guestCapabilityHash,
      });
      let nextAccess = saveBannerTogetherRoomAccess(
        createInitialAccess({
          roomId,
          placeId,
          role: "guest",
          roomKey: invite.roomKey,
          capability: guestAccess.guestCapability,
          joinCapability: null,
          expiresAt: createProvisionalExpiry(),
          highestSequences: { owner: 0, guest: 0 },
        })
      );
      clearBannerTogetherPendingJoin(roomId);
      navigate(
        {
          pathname: location.pathname,
          search: location.search,
          hash: "",
        },
        { replace: true }
      );
      setAccess(nextAccess);
      await publishMembership(membership, nextAccess);
      nextAccess = loadBannerTogetherRoomAccess(roomId) ?? nextAccess;
      setAccess(nextAccess);
      setFeedback({ severity: "success", message: "Joined and shared your lists." });
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "The encrypted room could not be joined.",
      });
    } finally {
      setOperation(null);
    }
  };

  const handleRefreshAndPublish = async () => {
    if (!access) {
      setMembershipReloadToken((currentValue) => currentValue + 1);
      return;
    }

    setOperation("refresh");
    setFeedback(null);

    try {
      const nextMembership = await fetchBannerTogetherMembership(placeId, {
        onProgress: setMembershipProgress,
      });
      setMembership(nextMembership);
      setMembershipStatus("ready");
      await publishMembership(nextMembership);
      setFeedback({ severity: "success", message: "Your shared lists are current." });
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "Your lists could not be refreshed and shared.",
      });
    } finally {
      setOperation(null);
    }
  };

  const handleCopyInvite = async () => {
    if (!access?.joinCapability || !roomId) {
      return;
    }

    try {
      const inviteUrl = createBannerTogetherRoomInviteUrl({
        origin: window.location.origin,
        placeId,
        roomId,
        roomKey: access.roomKey,
        joinCapability: access.joinCapability,
      });
      await copyTextToClipboard(inviteUrl);
      setFeedback({ severity: "success", message: "Short encrypted invite copied." });
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error ? error.message : "The invite could not be copied.",
      });
    }
  };

  const handleRevokeRoom = async () => {
    if (!access || access.role !== "owner" || !roomId) {
      return;
    }

    setOperation("revoke");
    setFeedback(null);

    try {
      await deleteBannerTogetherRoom({
        roomId,
        ownerCapability: access.capability,
      });
      clearBannerTogetherRoomAccess(roomId);
      navigate(`/together/${encodeURIComponent(placeId)}`, { replace: true });
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof Error ? error.message : "The room could not be revoked.",
      });
    } finally {
      setOperation(null);
    }
  };

  return (
    <Container
      maxWidth="xl"
      sx={{ color: "common.white", width: "100%", py: { xs: 2.5, sm: 4 } }}
    >
      <Box sx={{ maxWidth: 960, mb: 3 }}>
        <Typography variant="overline" color="text.secondary">
          {getPlaceLabel(isPlaceReady ? place : null, placeId)}
        </Typography>
        <Typography variant="h4" component="h1" sx={{ mb: 0.75 }}>
          Banner Together
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {roomId ? "Encrypted comparison room" : "Create a short comparison invite"}
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
          sx={{ mb: 3, maxWidth: 960 }}
        >
          Authenticate with Bannergress to load your Todo, Done, and Hide lists.
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
          sx={{ mb: 3, maxWidth: 960 }}
        >
          {membershipError}
        </Alert>
      ) : null}

      {(placeStatus === "loading" || membershipStatus === "loading") &&
      roomStatus !== "error" ? (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">
            {membershipStatus === "loading"
              ? `Loading private lists${membershipProgress ? ` (${membershipProgress})` : ""}...`
              : "Loading place..."}
          </Typography>
        </Stack>
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
              <SecurityRoundedIcon color="primary" />
              <Box>
                <Typography variant="subtitle1" component="h2">
                  Your encrypted snapshot
                </Typography>
                <MembershipChips membership={membership} />
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
              disabled={membershipStatus !== "ready" || operation !== null}
              onClick={handleCreateRoom}
              sx={{ minHeight: 44 }}
            >
              Create and copy invite
            </Button>
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Alert severity="info">
            The room stores only encrypted list IDs. Anyone with the invite can decrypt
            snapshots shared in it until you revoke it or it expires.
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
              <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
                Join this comparison
              </Typography>
              <MembershipChips membership={membership} />
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
              disabled={membershipStatus !== "ready" || operation !== null}
              onClick={handleJoinRoom}
              sx={{ minHeight: 44 }}
            >
              Join and share my lists
            </Button>
          </Stack>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Joining encrypts and shares your Todo, Done, and Hide memberships with the
            inviter. Anyone holding the invite key can decrypt both snapshots.
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
                  {access.role === "owner" ? "Your room" : "Joined room"}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    label={`${getMembershipCount(membership)} listed`}
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
              <Tooltip title="Check for a new collaborator snapshot">
                <span>
                  <IconButton
                    aria-label="Refresh encrypted room"
                    onClick={() =>
                      setRoomReloadToken((currentValue) => currentValue + 1)
                    }
                    disabled={roomStatus === "loading"}
                    sx={{
                      width: 44,
                      height: 44,
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 1,
                    }}
                  >
                    <SyncRoundedIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Button
                variant="outlined"
                startIcon={
                  operation === "refresh" ? (
                    <CircularProgress color="inherit" size={18} />
                  ) : (
                    <RefreshRoundedIcon />
                  )
                }
                onClick={handleRefreshAndPublish}
                disabled={membershipStatus !== "ready" || operation !== null}
                sx={{ minHeight: 44 }}
              >
                Refresh and share mine
              </Button>
              {access.role === "owner" ? (
                <>
                  {!room?.joined ? (
                    <Button
                      variant="contained"
                      startIcon={<ContentCopyRoundedIcon />}
                      onClick={handleCopyInvite}
                      disabled={operation !== null}
                      sx={{ minHeight: 44 }}
                    >
                      Copy invite
                    </Button>
                  ) : null}
                  <Tooltip title="Revoke room">
                    <span>
                      <IconButton
                        aria-label="Revoke encrypted room"
                        color="error"
                        onClick={handleRevokeRoom}
                        disabled={operation !== null}
                        sx={{
                          width: 44,
                          height: 44,
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: 1,
                        }}
                      >
                        <DeleteForeverRoundedIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </>
              ) : null}
            </Stack>
          </Stack>

          {access.role === "owner" && roomStatus === "ready" && !remoteSnapshot ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              Waiting for the other person to join and share their lists.
            </Alert>
          ) : null}
        </Paper>
      ) : null}

      {remoteSnapshot && membershipStatus === "ready" ? (
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
            spacing={1}
            justifyContent="space-between"
            sx={{ mb: 2 }}
          >
            <Typography variant="subtitle1" component="h2">
              Compare list states
            </Typography>
            <Chip
              size="small"
              label={`Other snapshot ${formatDateTime(remoteSnapshot.capturedAt)}`}
              sx={{ borderRadius: 1, alignSelf: { xs: "flex-start", sm: "center" } }}
            />
          </Stack>
          <BannerTogetherComparisonBuilder
            viewerRole={viewerRole}
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

      {catalogStatus === "error" ? (
        <Alert severity="error" sx={{ mb: 3, maxWidth: 960 }}>
          {catalogError}
        </Alert>
      ) : null}

      {remoteSnapshot && catalogStatus === "loading" ? (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">
            Loading place catalog{catalog.length ? ` (${catalog.length})` : ""}...
          </Typography>
        </Stack>
      ) : null}

      {remoteSnapshot &&
      catalogStatus !== "error" &&
      (catalog.length > 0 || catalogStatus === "ready") &&
      !comparison.error ? (
        <Box>
          <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
            Matching banners
          </Typography>

          {catalogStatus === "ready" && comparison.missingCatalogCount > 0 ? (
            <Alert severity="info" sx={{ mb: 2, maxWidth: 960 }}>
              {comparison.missingCatalogCount} listed banners are no longer available in
              this place catalog.
            </Alert>
          ) : null}

          {comparison.results.length === 0 && catalogStatus === "ready" ? (
            <Alert severity="info" sx={{ maxWidth: 960 }}>
              No banners match this comparison.
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
              {visibleResults.map((result) => {
                const viewerStatus =
                  access?.role === "owner"
                    ? result.creatorStatus
                    : result.recipientStatus;

                return (
                  <Stack key={result.id} spacing={1} sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                      <Chip
                        size="small"
                        color={STATUS_COLORS[result.creatorStatus]}
                        label={`${roleLabels.creator}: ${getBannerTogetherComparisonStatusLabel(
                          result.creatorStatus
                        )}`}
                        sx={{ borderRadius: 1 }}
                      />
                      <Chip
                        size="small"
                        color={STATUS_COLORS[result.recipientStatus]}
                        label={`${roleLabels.recipient}: ${getBannerTogetherComparisonStatusLabel(
                          result.recipientStatus
                        )}`}
                        sx={{ borderRadius: 1 }}
                      />
                    </Stack>
                    <Box sx={{ display: "flex", minWidth: 0, flex: 1 }}>
                      <BannerCard
                        banner={{
                          ...result.banner,
                          listType: toCardListType(viewerStatus),
                        }}
                        maxWidth="100%"
                      />
                    </Box>
                  </Stack>
                );
              })}
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
