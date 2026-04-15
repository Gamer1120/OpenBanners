import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppBar,
  Box,
  Checkbox,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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
  CheckCircleOutline,
  Download,
  Explore,
  LocationOn,
  Login,
  Search,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import {
  BANNERGRESS_SYNC_BRIDGE,
  BANNERGRESS_SYNC_READY,
  isBannergressBridgePresent,
  requestBannergressAuthStatus,
  requestBannergressSyncData,
  saveBannergressSyncData,
} from "../bannergressSync";
import BannerFilterButton from "./BannerFilterButton";
import { DEFAULT_BANNER_FILTERS } from "../bannerFilters";

const AUTH_POLL_INTERVAL_MS = 1500;
const AUTH_POLL_TIMEOUT_MS = 120000;
const DEBUG = /(?:^|[?&])openbanners-debug=1(?:&|$)/.test(
  window.location.search
);

function debugLog(...args) {
  if (!DEBUG) {
    return;
  }

  console.log("[OpenBanners TopMenu]", ...args);
}

function getUserscriptInstallUrl() {
  return new URL(
    "/userscripts/openbanners-bannergress-sync.user.js",
    window.location.origin
  ).toString();
}

function getBannergressAuthUrl(origin) {
  const url = new URL("https://bannergress.com/");
  url.searchParams.set("openbanners-origin", origin);
  return url.toString();
}

export default function TopMenu({
  onBrowseClick,
  onTitleClick,
  onSearch,
  showBannerFilters = false,
  bannerFilters = DEFAULT_BANNER_FILTERS,
  onBannerFiltersChange,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [bridgeAvailable, setBridgeAvailable] = useState(
    isBannergressBridgePresent()
  );
  const [authStatus, setAuthStatus] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(
    isBannergressBridgePresent()
  );
  const [isInstallDialogOpen, setIsInstallDialogOpen] = useState(false);
  const [hasAcceptedInstallRisk, setHasAcceptedInstallRisk] = useState(false);
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
  };

  const handleMapClick = () => {
    navigate("/map");
  };

  const closeInstallDialog = () => {
    setIsInstallDialogOpen(false);
    setHasAcceptedInstallRisk(false);
  };

  const handleUserscriptInstall = () => {
    const installUrl = getUserscriptInstallUrl();
    const installWindow = window.open(installUrl, "_blank", "noopener");

    if (installWindow === null) {
      window.location.assign(installUrl);
    }

    closeInstallDialog();
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
    if (!isBannergressBridgePresent() || syncInFlightRef.current) {
      debugLog("Skipped list sync.", {
        bridgePresent: isBannergressBridgePresent(),
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
      bridgePresent: isBannergressBridgePresent(),
    });
    if (!isBannergressBridgePresent()) {
      setBridgeAvailable(false);
      setAuthStatus(null);
      setIsCheckingAuth(false);
      hasAutoSyncedRef.current = false;
      return null;
    }

    setBridgeAvailable(true);

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

  const openAuthenticationPopup = () => {
    const popupUrl = getBannergressAuthUrl(window.location.origin);
    debugLog("Opening Bannergress authentication popup.", { popupUrl });
    const popup =
      authPopupRef.current && !authPopupRef.current.closed
        ? authPopupRef.current
        : window.open(
            popupUrl,
            "openbanners-bannergress-auth",
            "popup=yes,width=580,height=780"
          );

    if (!popup) {
      setFeedback({
        severity: "error",
        message:
          "Couldn't open Bannergress. Allow popups and try again.",
      });
      return;
    }

    popup.focus?.();
    authPopupRef.current = popup;
    setIsAuthenticating(true);

    stopAuthPolling();

    authIntervalRef.current = window.setInterval(() => {
      debugLog("Polling for Bannergress authentication state.");
      if (!authPopupRef.current || authPopupRef.current.closed) {
        stopAuthPolling();
        setIsAuthenticating(false);
        void refreshAuthStatus({ suppressLoading: true });
        return;
      }

      void refreshAuthStatus({
        suppressLoading: true,
        announceAuthenticated: true,
        forceRefresh: true,
      }).then((nextStatus) => {
        if (nextStatus?.authenticated) {
          debugLog("Authentication confirmed during popup polling.");
          closeAuthPopup();
          setIsAuthenticating(false);
        }
      });
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

  const handleBridgeButtonClick = () => {
    debugLog("Bridge button clicked.", {
      bridgeAvailable,
      authenticated: authStatus?.authenticated ?? null,
      isCheckingAuth,
      isAuthenticating,
    });
    setFeedback(null);

    if (!bridgeAvailable) {
      setIsInstallDialogOpen(true);
      return;
    }

    if (authStatus?.authenticated || isCheckingAuth || isAuthenticating) {
      return;
    }

    openAuthenticationPopup();
  };

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (
        !event.data ||
        typeof event.data !== "object" ||
        event.data.bridge !== BANNERGRESS_SYNC_BRIDGE
      ) {
        return;
      }

      if (event.data.type === BANNERGRESS_SYNC_READY) {
        debugLog("Received bridge ready event.");
        setBridgeAvailable(true);
        void refreshAuthStatus({ suppressLoading: true });
      }
    };

    window.addEventListener("message", handleMessage);

    if (isBannergressBridgePresent()) {
      void refreshAuthStatus({ suppressLoading: true });
    } else {
      setIsCheckingAuth(false);
    }

    window.postMessage(
      {
        type: BANNERGRESS_SYNC_READY,
        bridge: BANNERGRESS_SYNC_BRIDGE,
      },
      window.location.origin
    );

    return () => {
      window.removeEventListener("message", handleMessage);
      closeAuthPopup();
    };
  }, []);

  let bridgeButtonLabel = "Install Bannergress Auth Bridge Userscript";
  let bridgeButtonIcon = <Download />;
  let bridgeButtonDisabled = false;

  if (bridgeAvailable) {
    if (authStatus?.authenticated) {
      bridgeButtonLabel = "Authenticated";
      bridgeButtonIcon = <CheckCircleOutline />;
      bridgeButtonDisabled = true;
    } else if (isCheckingAuth) {
      bridgeButtonLabel = "Checking...";
      bridgeButtonIcon = <Login />;
      bridgeButtonDisabled = true;
    } else if (isAuthenticating) {
      bridgeButtonLabel = "Authenticating...";
      bridgeButtonIcon = <Login />;
      bridgeButtonDisabled = true;
    } else {
      bridgeButtonLabel = "Authenticate";
      bridgeButtonIcon = <Login />;
    }
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
            flexWrap: { xs: "wrap", sm: "nowrap" },
            gap: { xs: 1.25, sm: 2 },
            alignItems: "center",
          }}
        >
          <Container
            sx={{
              width: { xs: "100%", sm: "25%" },
              pl: "0 !important",
              pr: "0 !important",
              display: "flex",
              justifyContent: { xs: "center", sm: "flex-start" },
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
              <Typography
                variant="h6"
                component="span"
                sx={{
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
              flexDirection: { xs: "row", sm: "row" },
              alignItems: "center",
              justifyContent: "center",
              width: { xs: "100%", sm: "auto" },
              pl: "0 !important",
              pr: "0 !important",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            <Button
              color="inherit"
              startIcon={<Explore />}
              onClick={onBrowseClick}
              sx={{
                minHeight: 44,
                px: 1.75,
                bgcolor: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Browse
            </Button>
            <Button
              color="inherit"
              startIcon={<LocationOn />}
              onClick={handleMapClick}
              sx={{
                minHeight: 44,
                px: 1.75,
                bgcolor: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Map
            </Button>
            <Button
              color="inherit"
              startIcon={bridgeButtonIcon}
              onClick={handleBridgeButtonClick}
              disabled={bridgeButtonDisabled}
              sx={{
                minHeight: 44,
                px: 1.75,
                bgcolor: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {bridgeButtonLabel}
            </Button>
            {showBannerFilters ? (
              <BannerFilterButton
                filters={bannerFilters}
                onChange={onBannerFiltersChange}
                color="inherit"
                sx={{
                  minHeight: 44,
                  px: 1.75,
                  bgcolor: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              />
            ) : null}
          </Container>

          <Container
            sx={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: { xs: "stretch", sm: "flex-end" },
              width: { xs: "100%", sm: "min(360px, 30vw)" },
              pl: "0 !important",
              pr: "0 !important",
              ml: { sm: "auto" },
              alignSelf: { sm: "center" },
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
      <Dialog
        open={isInstallDialogOpen}
        onClose={closeInstallDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Install Bannergress Auth Bridge Userscript</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            This userscript is unofficial and gives OpenBanners a bridge into your
            logged-in Bannergress session. Install it only if you understand the
            tradeoffs.
          </Typography>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Installing it enables:
          </Typography>
          <Box component="ul" sx={{ pl: 2.5, mt: 0, mb: 2.5, display: "grid", gap: 1 }}>
            <Typography component="li" variant="body2">
              authenticated Bannergress API requests from OpenBanners
            </Typography>
            <Typography component="li" variant="body2">
              syncing your Bannergress `To do`, `Done`, and `Hidden` states into OpenBanners
            </Typography>
            <Typography component="li" variant="body2">
              setting banner status directly from OpenBanners with the Bannergress action buttons
            </Typography>
            <Typography component="li" variant="body2">
              using your Bannergress-authenticated view when browsing banners in OpenBanners
            </Typography>
          </Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Risks and tradeoffs:
          </Typography>
          <Box component="ul" sx={{ pl: 2.5, m: 0, display: "grid", gap: 1 }}>
            <Typography component="li" variant="body2">
              It runs custom JavaScript in pages you visit on `bannergress.com`
              and OpenBanners.
            </Typography>
            <Typography component="li" variant="body2">
              It can access Bannergress authentication material in your browser in
              order to make authenticated Bannergress API requests.
            </Typography>
            <Typography component="li" variant="body2">
              If this userscript or this site is compromised, your Bannergress
              account data could be exposed or misused.
            </Typography>
            <Typography component="li" variant="body2">
              Bannergress may change its site or API at any time, which can break
              this integration.
            </Typography>
            <Typography component="li" variant="body2">
              You should review the userscript and only install it if you trust
              this setup.
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ mt: 2.5 }}>
            This userscript is provided as-is, with no warranty of any kind, and
            no liability is accepted for any loss, damage, account issues, or
            other problems that may result from installing or using it.
          </Typography>
          <FormControlLabel
            sx={{ mt: 2.5, alignItems: "flex-start" }}
            control={
              <Checkbox
                checked={hasAcceptedInstallRisk}
                onChange={(event) => {
                  setHasAcceptedInstallRisk(event.target.checked);
                }}
              />
            }
            label="I understand the risks and tradeoffs and still want to install the Bannergress Auth Bridge userscript."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeInstallDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleUserscriptInstall}
            disabled={!hasAcceptedInstallRisk}
          >
            Install userscript
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
