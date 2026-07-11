import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppBar,
  Box,
  Container,
  Snackbar,
  Toolbar,
  Typography,
  Button,
  TextField,
  IconButton,
  InputAdornment,
  ButtonBase,
} from "@mui/material";
import {
  AltRoute,
  CheckCircleOutline,
  Download,
  Explore,
  LocationOn,
  Login,
  Search,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import {
  BANNERGRESS_AUTH_COMPLETE_MESSAGE,
  BANNERGRESS_AUTH_REQUEST_EVENT,
  BANNERGRESS_AUTH_STORAGE_KEY,
  buildBannergressAuthorizationUrl,
  getBannergressSyncCounts,
  isBannergressAuthSupportedOrigin,
  requestBannergressAuthStatus,
  requestBannergressSyncData,
  saveBannergressSyncData,
  serializeBannergressPendingAuth,
} from "../bannergressSync";

const AUTH_POLL_INTERVAL_MS = 1500;
const AUTH_POLL_TIMEOUT_MS = 120000;
const DEBUG = /(?:^|[?&])openbanners-debug=1(?:&|$)/.test(
  window.location.search
);

const mobileHiddenLabelSx = {
  display: { xs: "none", lg: "inline" },
};

const topMenuActionButtonSx = {
  minHeight: 44,
  minWidth: { xs: 44, lg: 64 },
  width: { xs: 44, lg: "auto" },
  px: { xs: 0, lg: 1.75 },
  bgcolor: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  "& .MuiButton-startIcon": {
    m: { xs: 0, lg: "0 8px 0 -4px" },
  },
};

const mobileSearchButtonSx = {
  display: { xs: "inline-flex", lg: "none" },
  width: 44,
  height: 44,
  bgcolor: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 1,
};

function debugLog(...args) {
  if (!DEBUG) {
    return;
  }

  console.log("[OpenBanners TopMenu]", ...args);
}

function isAndroidUserAgent() {
  return /Android/i.test(window.navigator?.userAgent ?? "");
}

function isRunningInAndroidApp() {
  const userAgent = window.navigator?.userAgent ?? "";
  const isStandalone =
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator?.standalone === true;
  const launchedFromAndroidApp =
    typeof document !== "undefined" &&
    document.referrer.startsWith("android-app://");

  return (
    isStandalone ||
    /\bwv\b/i.test(userAgent) ||
    /OpenBannersApp/i.test(userAgent) ||
    launchedFromAndroidApp
  );
}

export default function TopMenu({
  onBrowseClick,
  onRerouterClick,
  onTitleClick,
  onSearch,
}) {
  const authSupportedOrigin = isBannergressAuthSupportedOrigin();
  const shouldShowAndroidDownloadButton =
    isAndroidUserAgent() && !isRunningInAndroidApp();
  const [searchQuery, setSearchQuery] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(authSupportedOrigin);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const navigate = useNavigate();
  const authPopupRef = useRef(null);
  const authIntervalRef = useRef(null);
  const authTimeoutRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const hasAutoSyncedRef = useRef(false);

  const handleSearch = (event) => {
    event.preventDefault();
    if (searchQuery.trim() === "") {
      return;
    }
    onSearch(searchQuery);
    setIsMobileSearchOpen(false);
  };

  const handleMapClick = () => {
    navigate("/map");
  };

  const handleRerouterClick = () => {
    if (typeof onRerouterClick === "function") {
      onRerouterClick();
      return;
    }

    navigate("/rerouter");
  };

  const stopAuthPolling = () => {
    window.clearInterval(authIntervalRef.current);
    window.clearTimeout(authTimeoutRef.current);
    authIntervalRef.current = null;
    authTimeoutRef.current = null;
  };

  const closeAuthPopup = () => {
    stopAuthPolling();

    if (authPopupRef.current && !authPopupRef.current.closed) {
      authPopupRef.current.close();
    }

    authPopupRef.current = null;
  };

  async function syncBannergressLists({ silent = true } = {}) {
    if (!authSupportedOrigin || syncInFlightRef.current) {
      debugLog("Skipped list sync.", {
        authSupportedOrigin,
        syncInFlight: syncInFlightRef.current,
      });
      return null;
    }

    debugLog("Starting Bannergress list sync.", { silent });
    syncInFlightRef.current = true;
    setIsSyncing(true);

    try {
      const payload = await requestBannergressSyncData();
      debugLog("Received Bannergress list sync payload.", {
        hasPayload: Boolean(payload),
      });
      const savedData = saveBannergressSyncData(payload);

      if (!silent) {
        const savedCounts = getBannergressSyncCounts(savedData);
        const savedTotal =
          savedCounts.todo + savedCounts.done + savedCounts.blacklist;

        setFeedback({
          severity: "success",
          message: `Synced ${savedTotal} banner list states from Bannergress.`,
        });
      }

      return savedData;
    } catch (error) {
      debugLog("Bannergress list sync failed.", {
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error?.code === "AUTH_REQUIRED") {
        setAuthStatus((currentStatus) => ({
          ...(currentStatus ?? {}),
          authenticated: false,
        }));
        hasAutoSyncedRef.current = false;
      }

      if (!silent) {
        setFeedback({
          severity: "error",
          message:
            error instanceof Error
              ? error.message
              : "Bannergress sync failed.",
        });
      }

      return null;
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
    }
  }

  async function refreshAuthStatus({
    suppressLoading = false,
    announceAuthenticated = false,
    forceRefresh = false,
  } = {}) {
    debugLog("Refreshing auth status.", {
      suppressLoading,
      announceAuthenticated,
      forceRefresh,
      authSupportedOrigin,
    });

    if (!authSupportedOrigin) {
      setAuthStatus(null);
      setIsCheckingAuth(false);
      hasAutoSyncedRef.current = false;
      return null;
    }

    if (!suppressLoading) {
      setIsCheckingAuth(true);
    }

    const nextStatus = await requestBannergressAuthStatus({ forceRefresh });
    debugLog("Resolved auth status.", nextStatus);
    setAuthStatus(nextStatus);
    setIsCheckingAuth(false);

    if (nextStatus?.authenticated) {
      if (announceAuthenticated) {
        setFeedback({
          severity: "success",
          message: "Bannergress authenticated.",
        });
      }

      if (!hasAutoSyncedRef.current) {
        hasAutoSyncedRef.current = true;
        void syncBannergressLists();
      }
    } else {
      hasAutoSyncedRef.current = false;
    }

    return nextStatus;
  }

  const openAuthenticationPopup = async () => {
    if (!authSupportedOrigin) {
      setFeedback({
        severity: "warning",
        message:
          "Bannergress auth is currently only available on supported OpenBanners domains.",
      });
      return;
    }

    debugLog("Opening Bannergress authentication popup.");
    const popup =
      authPopupRef.current && !authPopupRef.current.closed
        ? authPopupRef.current
        : window.open(
            "about:blank",
            "openbanners-bannergress-auth",
            "popup=yes,width=580,height=780"
          );

    if (!popup) {
      setFeedback({
        severity: "error",
        message: "Couldn't open Bannergress. Allow popups and try again.",
      });
      return;
    }

    popup.focus?.();
    authPopupRef.current = popup;
    setIsAuthenticating(true);

    try {
      const { authorizationUrl, pendingAuth } =
        await buildBannergressAuthorizationUrl();
      popup.name = serializeBannergressPendingAuth(pendingAuth);
      popup.location.href = authorizationUrl;
    } catch (error) {
      closeAuthPopup();
      setIsAuthenticating(false);
      setFeedback({
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "Bannergress authentication couldn't be started.",
      });
      return;
    }

    stopAuthPolling();

    authIntervalRef.current = window.setInterval(() => {
      debugLog("Polling popup closure state.");
      if (!authPopupRef.current || authPopupRef.current.closed) {
        stopAuthPolling();
        setIsAuthenticating(false);
        void refreshAuthStatus({ suppressLoading: true, forceRefresh: true });
      }
    }, AUTH_POLL_INTERVAL_MS);

    authTimeoutRef.current = window.setTimeout(() => {
      stopAuthPolling();
      setIsAuthenticating(false);
      setFeedback({
        severity: "warning",
        message:
          "Authentication is still pending. Finish signing in on Bannergress, then return here.",
      });
      debugLog("Authentication popup polling timed out.");
    }, AUTH_POLL_TIMEOUT_MS);
  };

  const handleAuthButtonClick = () => {
    debugLog("Auth button clicked.", {
      authSupportedOrigin,
      authenticated: authStatus?.authenticated ?? null,
      isCheckingAuth,
      isAuthenticating,
    });
    setFeedback(null);

    if (authStatus?.authenticated || isCheckingAuth || isAuthenticating) {
      return;
    }

    void openAuthenticationPopup();
  };

  useEffect(() => {
    const handleStorage = (event) => {
      if (
        event.key === BANNERGRESS_AUTH_STORAGE_KEY ||
        event.key === null
      ) {
        debugLog("Observed auth storage change.");
        void refreshAuthStatus({ suppressLoading: true });
      }
    };

    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (
        !event.data ||
        typeof event.data !== "object" ||
        event.data.type !== BANNERGRESS_AUTH_COMPLETE_MESSAGE
      ) {
        return;
      }

      debugLog("Received auth completion message.", event.data);
      closeAuthPopup();
      setIsAuthenticating(false);

      if (event.data.success) {
        void refreshAuthStatus({
          suppressLoading: true,
          announceAuthenticated: true,
          forceRefresh: true,
        });
        return;
      }

      setFeedback({
        severity: "error",
        message:
          typeof event.data.message === "string"
            ? event.data.message
            : "Bannergress authentication failed.",
      });
      void refreshAuthStatus({ suppressLoading: true, forceRefresh: true });
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("message", handleMessage);
    window.addEventListener(
      BANNERGRESS_AUTH_REQUEST_EVENT,
      openAuthenticationPopup
    );

    if (authSupportedOrigin) {
      void refreshAuthStatus({ suppressLoading: true });
    } else {
      setIsCheckingAuth(false);
    }

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("message", handleMessage);
      window.removeEventListener(
        BANNERGRESS_AUTH_REQUEST_EVENT,
        openAuthenticationPopup
      );
      closeAuthPopup();
    };
  }, [authSupportedOrigin]);

  let authButtonLabel = "Authenticate";
  let authButtonIcon = <Login />;
  let authButtonDisabled = false;

  if (!authSupportedOrigin) {
    authButtonLabel = "Auth Unavailable Here";
    authButtonDisabled = true;
  } else if (authStatus?.authenticated) {
    authButtonLabel = "Authenticated";
    authButtonIcon = <CheckCircleOutline />;
    authButtonDisabled = true;
  } else if (isCheckingAuth) {
    authButtonLabel = "Checking...";
    authButtonDisabled = true;
  } else if (isAuthenticating) {
    authButtonLabel = "Authenticating...";
    authButtonDisabled = true;
  }

  return (
    <>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: "rgba(11, 16, 20, 0.9)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          backgroundImage: "none",
        }}
      >
        <Toolbar
          sx={{
            px: { xs: 1.5, sm: 2.5 },
            py: { xs: 1.25, sm: 1.5 },
            display: "flex",
            flexWrap: { xs: isMobileSearchOpen ? "wrap" : "nowrap", lg: "nowrap" },
            gap: { xs: 0.75, lg: 2 },
            alignItems: "center",
          }}
        >
          <Container
            sx={{
              width: { xs: "auto", lg: "25%" },
              pl: "0 !important",
              pr: "0 !important",
              display: "flex",
              justifyContent: "flex-start",
              flex: { xs: "0 0 auto", lg: "0 1 auto" },
            }}
          >
            <ButtonBase
              onClick={onTitleClick}
              aria-label="Go to home page"
              sx={{
                borderRadius: 1.5,
                px: 1.25,
                py: 0.75,
                border: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <Box
                component="img"
                src="/logo192.png"
                alt=""
                sx={{
                  display: { xs: "block", lg: "none" },
                  width: 26,
                  height: 26,
                }}
              />
              <Typography
                variant="h6"
                component="span"
                sx={{
                  display: { xs: "none", lg: "inline" },
                  color: "text.primary",
                  letterSpacing: "0.08em",
                }}
              >
                OPENBANNERS
              </Typography>
            </ButtonBase>
          </Container>

          <Container
            sx={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: { xs: "flex-end", lg: "center" },
              width: "auto",
              pl: "0 !important",
              pr: "0 !important",
              gap: { xs: 0.5, lg: 1 },
              flex: { xs: 1, lg: "0 0 auto" },
              flexWrap: { xs: "nowrap", lg: "wrap" },
              minWidth: 0,
            }}
          >
            <Button
              color="inherit"
              aria-label="Browse"
              startIcon={<Explore />}
              onClick={onBrowseClick}
              sx={topMenuActionButtonSx}
            >
              <Box component="span" sx={mobileHiddenLabelSx}>
                Browse
              </Box>
            </Button>
            <Button
              color="inherit"
              aria-label="Map"
              startIcon={<LocationOn />}
              onClick={handleMapClick}
              sx={topMenuActionButtonSx}
            >
              <Box component="span" sx={mobileHiddenLabelSx}>
                Map
              </Box>
            </Button>
            <Button
              color="inherit"
              aria-label="Reroute Banner"
              startIcon={<AltRoute />}
              onClick={handleRerouterClick}
              sx={topMenuActionButtonSx}
            >
              <Box component="span" sx={mobileHiddenLabelSx}>
                Reroute Banner
              </Box>
            </Button>
            {shouldShowAndroidDownloadButton ? (
              <Button
                color="inherit"
                aria-label="Download App"
                startIcon={<Download />}
                component="a"
                href="/OpenBanners.apk"
                download="OpenBanners.apk"
                sx={topMenuActionButtonSx}
              >
                <Box component="span" sx={mobileHiddenLabelSx}>
                  Download App
                </Box>
              </Button>
            ) : null}
            <Button
              color="inherit"
              aria-label={authButtonLabel}
              startIcon={authButtonIcon}
              onClick={handleAuthButtonClick}
              disabled={authButtonDisabled}
              sx={topMenuActionButtonSx}
            >
              <Box component="span" sx={mobileHiddenLabelSx}>
                {authButtonLabel}
              </Box>
            </Button>
            <IconButton
              color="inherit"
              aria-label={isMobileSearchOpen ? "Close search" : "Open search"}
              onClick={() =>
                setIsMobileSearchOpen((currentValue) => !currentValue)
              }
              sx={mobileSearchButtonSx}
            >
              <Search />
            </IconButton>
          </Container>

          <Container
            sx={{
              display: {
                xs: isMobileSearchOpen ? "flex" : "none",
                lg: "flex",
              },
              flexDirection: "column",
              justifyContent: "center",
              alignItems: { xs: "stretch", lg: "flex-end" },
              width: { xs: "100%", lg: "min(360px, 30vw)" },
              pl: "0 !important",
              pr: "0 !important",
              ml: { lg: "auto" },
              alignSelf: { lg: "center" },
              order: { xs: 3, lg: 0 },
            }}
          >
            <Box
              component="form"
              onSubmit={handleSearch}
              role="search"
              aria-label="Search banners and places"
              sx={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                minHeight: 44,
              }}
            >
              <TextField
                variant="outlined"
                placeholder="Search banners or places"
                size="small"
                fullWidth
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                inputProps={{ "aria-label": "Search query" }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton type="submit" aria-label="Submit search">
                        <Search />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Box>
          </Container>
        </Toolbar>
      </AppBar>
      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={4500}
        onClose={() => setFeedback(null)}
      >
        {feedback ? (
          <Alert
            severity={feedback.severity}
            onClose={() => setFeedback(null)}
            sx={{ width: "100%" }}
          >
            {feedback.message}
          </Alert>
        ) : null}
      </Snackbar>
    </>
  );
}
