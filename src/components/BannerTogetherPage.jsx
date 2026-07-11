import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
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
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import BannerCard from "./BannerCard";
import BannerTogetherLivePage from "./BannerTogetherLivePage";
import {
  BANNERGRESS_AUTH_REQUEST_EVENT,
  clearBannergressAuthData,
  fetchBannergress,
  loadBannergressAuthData,
  requestBannergressAccessToken,
  useBannergressAuth,
} from "../bannergressSync";
import {
  BANNER_TOGETHER_HASH_PREFIX,
  BANNER_TOGETHER_MAX_BANNER_IDS,
  createBannerTogetherInviteUrl,
  getSharedTodoBanners,
  parseBannerTogetherInviteHash,
} from "../bannerTogether";

const TODO_PAGE_SIZE = 100;
const MAX_TODO_PAGES = 50;
const RESULT_PAGE_SIZE = 24;

function getPlaceLabel(place, fallbackPlaceId) {
  return (
    place?.formattedAddress ||
    place?.longName ||
    place?.shortName ||
    fallbackPlaceId
  );
}

function sortBannersByTitle(banners) {
  return [...banners].sort((bannerA, bannerB) =>
    String(bannerA?.title ?? "").localeCompare(String(bannerB?.title ?? ""))
  );
}

function formatSnapshotTime(createdAt) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(createdAt));
}

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

function createAuthRequiredError() {
  return Object.assign(
    new Error("Authenticate with Bannergress to compare to-do lists."),
    { code: "AUTH_REQUIRED" }
  );
}

async function fetchTodoBannersForPlace(
  placeId,
  onPage,
  { maximumBanners = null, signal = null } = {}
) {
  const accessToken = await requestBannergressAccessToken();

  if (!accessToken) {
    throw createAuthRequiredError();
  }

  if (signal?.aborted) {
    throw Object.assign(new Error("Banner Together request was cancelled."), {
      name: "AbortError",
    });
  }

  const requestAuthData = loadBannergressAuthData();
  const bannersById = new Map();
  let offset = 0;

  for (let pageIndex = 0; pageIndex < MAX_TODO_PAGES; pageIndex += 1) {
    const url = new URL("https://api.bannergress.com/bnrs");
    url.searchParams.set("placeId", placeId);
    url.searchParams.set("listTypes", "todo");
    url.searchParams.set("orderBy", "title");
    url.searchParams.set("orderDirection", "ASC");
    url.searchParams.set("limit", String(TODO_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));

    const response = await fetchBannergress(url.toString(), {
      authenticate: false,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      const latestAuthData = loadBannergressAuthData();

      if (
        latestAuthData.accessToken === accessToken &&
        latestAuthData.refreshToken === requestAuthData.refreshToken
      ) {
        clearBannergressAuthData();
      }

      throw createAuthRequiredError();
    }

    if (response.ok === false) {
      throw new Error("Bannergress could not load this to-do list.");
    }

    const page = await response.json();

    if (!Array.isArray(page)) {
      throw new Error("Bannergress returned an unexpected to-do list.");
    }

    page.forEach((banner) => {
      if (typeof banner?.id === "string" && banner.id) {
        bannersById.set(banner.id, banner);
      }
    });

    const sortedBanners = sortBannersByTitle([...bannersById.values()]);
    onPage(sortedBanners);

    if (
      Number.isFinite(maximumBanners) &&
      sortedBanners.length >= maximumBanners
    ) {
      return sortedBanners.slice(0, maximumBanners);
    }

    if (page.length < TODO_PAGE_SIZE) {
      return sortedBanners;
    }

    offset += page.length;
  }

  throw new Error("The Bannergress to-do list exceeded the safe page limit.");
}

export function LegacyBannerTogetherPage({ placeId }) {
  const location = useLocation();
  const authState = useBannergressAuth();
  const hasAuthCredentials = Boolean(
    authState.accessToken || authState.refreshToken
  );
  const [place, setPlace] = useState(null);
  const [placeStatus, setPlaceStatus] = useState("loading");
  const [validatedPlaceId, setValidatedPlaceId] = useState(null);
  const [placeError, setPlaceError] = useState("");
  const hashValue = location.hash;
  const [inviteState, setInviteState] = useState(() => ({
    status: location.hash ? "parsing" : "host",
    invite: null,
    error: "",
  }));
  const [ownTodoBanners, setOwnTodoBanners] = useState([]);
  const [loadStatus, setLoadStatus] = useState("checking-auth");
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [copyStatus, setCopyStatus] = useState(null);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [visibleResultCount, setVisibleResultCount] = useState(RESULT_PAGE_SIZE);

  useEffect(() => {
    let ignore = false;

    if (!hashValue) {
      setInviteState({ status: "host", invite: null, error: "" });
      return undefined;
    }

    if (!hashValue.startsWith(BANNER_TOGETHER_HASH_PREFIX)) {
      setInviteState({
        status: "invalid",
        invite: null,
        error: "This Banner Together invite is not valid.",
      });
      return undefined;
    }

    setInviteState({ status: "parsing", invite: null, error: "" });

    parseBannerTogetherInviteHash(hashValue)
      .then((invite) => {
        if (ignore) {
          return;
        }

        if (invite.placeId !== placeId) {
          throw new Error("This invite belongs to a different place.");
        }

        setInviteState({ status: "guest", invite, error: "" });
      })
      .catch((error) => {
        if (!ignore) {
          setInviteState({
            status: "invalid",
            invite: null,
            error:
              error instanceof Error
                ? error.message
                : "This Banner Together invite is not valid.",
          });
        }
      });

    return () => {
      ignore = true;
    };
  }, [hashValue, placeId]);

  useEffect(() => {
    let ignore = false;
    setPlace(null);
    setPlaceStatus("loading");
    setValidatedPlaceId(null);
    setPlaceError("");

    fetch(`https://api.bannergress.com/places/${encodeURIComponent(placeId)}`)
      .then(async (response) => {
        if (response.ok === false) {
          throw new Error("Place not found.");
        }

        return response.json();
      })
      .then((data) => {
        if (!ignore && data && typeof data === "object" && data.id) {
          setPlace(data);
          setPlaceStatus("ready");
          setValidatedPlaceId(placeId);
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

  const isPlaceReady =
    placeStatus === "ready" && validatedPlaceId === placeId;

  useEffect(() => {
    if (inviteState.status === "parsing" || inviteState.status === "invalid") {
      setOwnTodoBanners([]);
      setLoadStatus("checking-auth");
      return undefined;
    }

    if (!isPlaceReady) {
      setOwnTodoBanners([]);
      setLoadStatus("checking-auth");
      setLoadError("");
      return undefined;
    }

    if (!hasAuthCredentials) {
      setOwnTodoBanners([]);
      setLoadStatus("auth-required");
      setLoadError("");
      return undefined;
    }

    let ignore = false;
    const abortController = new AbortController();
    setOwnTodoBanners([]);
    setLoadStatus("loading");
    setLoadError("");

    fetchTodoBannersForPlace(
      placeId,
      (banners) => {
        if (!ignore) {
          setOwnTodoBanners(banners);
        }
      },
      {
        maximumBanners:
          inviteState.status === "host"
            ? BANNER_TOGETHER_MAX_BANNER_IDS + 1
            : null,
        signal: abortController.signal,
      }
    )
      .then((banners) => {
        if (!ignore) {
          setOwnTodoBanners(banners);
          setLoadStatus("ready");
        }
      })
      .catch((error) => {
        if (ignore || error?.name === "AbortError") {
          return;
        }

        if (error?.code === "AUTH_REQUIRED") {
          setOwnTodoBanners([]);
          setLoadStatus("auth-required");
          setLoadError("");
          return;
        }

        console.error("Couldn't load Banner Together to-do banners.", error);
        setOwnTodoBanners([]);
        setLoadStatus("error");
        setLoadError(
          error instanceof Error
            ? error.message
            : "The to-do list could not be loaded."
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
    inviteState.status,
    isPlaceReady,
    placeId,
    reloadToken,
  ]);

  const displayedBanners = useMemo(
    () =>
      inviteState.status === "guest"
        ? getSharedTodoBanners(
            ownTodoBanners,
            inviteState.invite?.bannerIds ?? []
          )
        : ownTodoBanners,
    [inviteState, ownTodoBanners]
  );
  const placeLabel = getPlaceLabel(isPlaceReady ? place : null, placeId);
  const isGuest = inviteState.status === "guest";
  const inviteHasTooManyBanners =
    ownTodoBanners.length > BANNER_TOGETHER_MAX_BANNER_IDS;
  const canCopyInvite = loadStatus === "ready" && !inviteHasTooManyBanners;
  const visibleBanners = displayedBanners.slice(0, visibleResultCount);

  useEffect(() => {
    setVisibleResultCount(RESULT_PAGE_SIZE);
  }, [hashValue, placeId, reloadToken]);

  const handleCopyInvite = async () => {
    setCopyStatus(null);
    setIsCreatingInvite(true);

    try {
      const inviteUrl = await createBannerTogetherInviteUrl({
        origin: window.location.origin,
        placeId,
        bannerIds: ownTodoBanners.map((banner) => banner.id),
      });
      await copyTextToClipboard(inviteUrl);
      setCopyStatus({
        severity: "success",
        message: "Snapshot invite copied.",
      });
    } catch (error) {
      setCopyStatus({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "The invite could not be copied.",
      });
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const handleCopySharedResult = async () => {
    setCopyStatus(null);
    setIsCreatingInvite(true);

    try {
      const resultUrl = await createBannerTogetherInviteUrl({
        origin: window.location.origin,
        placeId,
        bannerIds: displayedBanners.map((banner) => banner.id),
      });
      await copyTextToClipboard(resultUrl);
      setCopyStatus({
        severity: "success",
        message: "Shared result link copied.",
      });
    } catch (error) {
      setCopyStatus({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "The result link could not be copied.",
      });
    } finally {
      setIsCreatingInvite(false);
    }
  };

  return (
    <Container
      maxWidth="xl"
      sx={{ color: "common.white", width: "100%", py: { xs: 2.5, sm: 4 } }}
    >
      <Box sx={{ maxWidth: 900, mb: 3 }}>
        <Typography variant="overline" color="text.secondary">
          {placeLabel}
        </Typography>
        <Typography variant="h4" component="h1" sx={{ mb: 0.75 }}>
          Banner Together
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {isGuest ? "Shared to-do banners" : "Create a to-do snapshot invite"}
        </Typography>
      </Box>

      {placeError ? (
        <Alert severity="error" sx={{ mb: 2, maxWidth: 900 }}>
          {placeError}
        </Alert>
      ) : null}

      {inviteState.status === "invalid" ? (
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
          sx={{ mb: 2, maxWidth: 900 }}
        >
          {inviteState.error}
        </Alert>
      ) : null}

      {(inviteState.status === "host" || inviteState.status === "guest") &&
      isPlaceReady ? (
        <Paper
          elevation={0}
          sx={{
            maxWidth: 900,
            p: { xs: 2, sm: 2.5 },
            mb: 3,
            borderRadius: 2,
            bgcolor: "rgba(18,25,31,0.92)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ xs: "stretch", sm: "center" }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1.25} alignItems="center">
              <GroupRoundedIcon color="primary" />
              <Box>
                <Typography variant="subtitle1" component="h2">
                  {isGuest ? "Comparison" : "Your snapshot"}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {isGuest ? (
                    <>
                      <Chip
                        size="small"
                        label={`${inviteState.invite?.bannerIds.length ?? 0} in invite`}
                        sx={{ borderRadius: 1 }}
                      />
                      <Chip
                        size="small"
                        label={`Snapshot ${formatSnapshotTime(
                          inviteState.invite.createdAt
                        )}`}
                        sx={{ borderRadius: 1 }}
                      />
                      <Chip
                        size="small"
                        color="primary"
                        label={`${displayedBanners.length} shared`}
                        sx={{ borderRadius: 1 }}
                      />
                    </>
                  ) : (
                    <Chip
                      size="small"
                      label={`${ownTodoBanners.length} to do`}
                      sx={{ borderRadius: 1 }}
                    />
                  )}
                </Stack>
              </Box>
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              flexWrap="wrap"
              alignItems="center"
            >
              <Tooltip title="Refresh my to-do list">
                <span>
                  <IconButton
                    aria-label="Refresh my to-do list"
                    onClick={() =>
                      setReloadToken((currentValue) => currentValue + 1)
                    }
                    disabled={loadStatus === "loading"}
                    sx={{
                      width: 44,
                      height: 44,
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 1,
                    }}
                  >
                    <RefreshRoundedIcon />
                  </IconButton>
                </span>
              </Tooltip>

              {isGuest ? (
                <>
                  <Button
                    variant="contained"
                    startIcon={
                      isCreatingInvite ? (
                        <CircularProgress color="inherit" size={18} />
                      ) : (
                        <ContentCopyRoundedIcon />
                      )
                    }
                    onClick={handleCopySharedResult}
                    disabled={loadStatus !== "ready" || isCreatingInvite}
                    sx={{ minHeight: 44 }}
                  >
                    Copy result link
                  </Button>
                  <Button
                    variant="outlined"
                    component={Link}
                    to={`/browse/${encodeURIComponent(placeId)}`}
                    sx={{ minHeight: 44 }}
                  >
                    Browse place
                  </Button>
                </>
              ) : (
                <Button
                  variant="contained"
                  startIcon={
                    isCreatingInvite ? (
                      <CircularProgress color="inherit" size={18} />
                    ) : (
                      <ContentCopyRoundedIcon />
                    )
                  }
                  onClick={handleCopyInvite}
                  disabled={!canCopyInvite || isCreatingInvite}
                  sx={{ minHeight: 44 }}
                >
                  Copy snapshot invite
                </Button>
              )}
            </Stack>
          </Stack>

          {!isGuest && canCopyInvite ? (
            <>
              <Divider sx={{ my: 2 }} />
              <Alert severity="warning">
                {`Anyone with this link can see your complete to-do list for this place (${ownTodoBanners.length} banner IDs). A copied snapshot cannot be revoked.`}
              </Alert>
            </>
          ) : null}

          {isGuest && loadStatus === "ready" ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              The inviter controls the snapshot. Copying a result link shares every
              matching banner ID.
            </Alert>
          ) : null}

          {!isGuest && inviteHasTooManyBanners ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              Snapshot invites support at most {BANNER_TOGETHER_MAX_BANNER_IDS} to-do
              banners. Choose a more specific place.
            </Alert>
          ) : null}

          {copyStatus ? (
            <Alert severity={copyStatus.severity} sx={{ mt: 2 }}>
              {copyStatus.message}
            </Alert>
          ) : null}
        </Paper>
      ) : null}

      {loadStatus === "auth-required" && inviteState.status !== "invalid" ? (
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
          sx={{ mb: 3, maxWidth: 900 }}
        >
          Authenticate with Bannergress in the top bar to compare to-do lists.
        </Alert>
      ) : null}

      {loadStatus === "error" && inviteState.status !== "invalid" ? (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => setReloadToken((currentValue) => currentValue + 1)}
            >
              Retry
            </Button>
          }
          sx={{ mb: 3, maxWidth: 900 }}
        >
          {loadError}
        </Alert>
      ) : null}

      {(loadStatus === "loading" ||
        inviteState.status === "parsing" ||
        placeStatus === "loading") &&
      inviteState.status !== "invalid" ? (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">
            Loading to-do banners...
          </Typography>
        </Stack>
      ) : null}

      {loadStatus === "ready" && inviteState.status !== "invalid" ? (
        <Box>
          <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
            {isGuest ? "Shared to-do banners" : "To-do banners in this place"}
          </Typography>

          {displayedBanners.length === 0 ? (
            <Alert severity="info" sx={{ maxWidth: 900 }}>
              {isGuest
                ? "You do not share any to-do banners in this place."
                : "You have no to-do banners in this place."}
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
              {visibleBanners.map((banner) => (
                <Box key={banner.id} sx={{ display: "flex", minWidth: 0 }}>
                  <BannerCard banner={banner} maxWidth="100%" />
                </Box>
              ))}
            </Box>
          )}

          {visibleResultCount < displayedBanners.length ? (
            <Button
              variant="outlined"
              onClick={() =>
                setVisibleResultCount(
                  Math.min(
                    visibleResultCount + RESULT_PAGE_SIZE,
                    displayedBanners.length
                  )
                )
              }
              sx={{ mt: 2 }}
            >
              Show more
            </Button>
          ) : null}
        </Box>
      ) : null}
    </Container>
  );
}

export default function BannerTogetherPage({ placeId, roomId = null }) {
  const location = useLocation();

  if (!roomId && location.hash.startsWith(BANNER_TOGETHER_HASH_PREFIX)) {
    return <LegacyBannerTogetherPage placeId={placeId} />;
  }

  return <BannerTogetherLivePage placeId={placeId} roomId={roomId} />;
}
