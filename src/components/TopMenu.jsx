import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
} from "@mui/material";
import {
  AccountCircleOutlined,
  AltRoute,
  BrightnessAuto,
  DarkMode,
  Download,
  GitHub,
  LightMode,
  Login,
  MoreVert,
} from "@mui/icons-material";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BANNERGRESS_AUTH_COMPLETE_MESSAGE,
  BANNERGRESS_AUTH_REQUEST_EVENT,
  BANNERGRESS_AUTH_STORAGE_KEY,
  buildBannergressAuthorizationUrl,
  getBannergressAgentName,
  getBannergressSyncCounts,
  isBannergressAuthSupportedOrigin,
  requestBannergressAuthStatus,
  requestBannergressSyncData,
  saveBannergressSyncData,
  serializeBannergressPendingAuth,
} from "../bannergressSync";
import { saveThemeMode, useThemeMode } from "../themeMode";
import AppLogo from "./AppLogo";
import SearchForm from "./SearchForm";

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
  onRerouterClick,
  onTitleClick,
  onSearch,
  showSearch = true,
  title = "",
}) {
  const authSupportedOrigin = isBannergressAuthSupportedOrigin();
  const shouldShowAndroidDownloadButton =
    isAndroidUserAgent() && !isRunningInAndroidApp();
  const [feedback, setFeedback] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);
  const [moreMenuAnchor, setMoreMenuAnchor] = useState(null);
  const { mode: themeMode } = useThemeMode();
  const [isCheckingAuth, setIsCheckingAuth] = useState(authSupportedOrigin);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isBannerTogetherRoute = /^\/together(?:\/|$)/.test(
    location.pathname
  );
  const authPopupRef = useRef(null);
  const authIntervalRef = useRef(null);
  const authTimeoutRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const hasAutoSyncedRef = useRef(false);

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

      if (!hasAutoSyncedRef.current && !isBannerTogetherRoute) {
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
  }, [authSupportedOrigin, isBannerTogetherRoute]);

  let authButtonLabel = "Authenticate";
  let authButtonDisabled = false;

  if (!authSupportedOrigin) {
    authButtonLabel = "Auth Unavailable Here";
    authButtonDisabled = true;
  } else if (authStatus?.authenticated) {
    authButtonLabel = "Authenticated";
    authButtonDisabled = true;
  } else if (isCheckingAuth) {
    authButtonLabel = "Checking...";
    authButtonDisabled = true;
  } else if (isAuthenticating) {
    authButtonLabel = "Authenticating...";
    authButtonDisabled = true;
  }

  const agentName = authStatus?.authenticated ? getBannergressAgentName() : null;
  const authButtonTitle = authStatus?.authenticated
    ? `Signed in with Bannergress${agentName ? ` as ${agentName}` : ""}`
    : authButtonLabel === "Authenticate"
      ? "Sign in with Bannergress"
      : authButtonLabel;
  const closeMoreMenu = () => setMoreMenuAnchor(null);

  return (
    <>
      <header className={`ob-bar${showSearch ? " searching" : ""}`}>
        <button
          type="button"
          className="ob-brand sl"
          onClick={onTitleClick}
          aria-label="Go to home page"
        >
          <AppLogo />
          <span className="ob-brand-text">{title || "OpenBanners"}</span>
        </button>
        {showSearch ? (
          <SearchForm className="ob-bar-search" onSearch={onSearch} />
        ) : null}
        <div className="ob-bar-actions">
          <button
            type="button"
            className="icon-btn sl"
            aria-label={authButtonLabel}
            title={authButtonTitle}
            onClick={handleAuthButtonClick}
            disabled={authButtonDisabled && !authStatus?.authenticated}
            aria-disabled={authButtonDisabled}
          >
            {authStatus?.authenticated ? (
              <span className="avatar" aria-hidden="true">
                {(agentName || "B").slice(0, 1).toUpperCase()}
              </span>
            ) : authButtonLabel === "Authenticate" ? (
              <Login />
            ) : (
              <AccountCircleOutlined />
            )}
          </button>
          <button
            type="button"
            className="icon-btn sl"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={Boolean(moreMenuAnchor)}
            onClick={(event) => setMoreMenuAnchor(event.currentTarget)}
          >
            <MoreVert />
          </button>
          <Menu
            anchorEl={moreMenuAnchor}
            open={Boolean(moreMenuAnchor)}
            onClose={closeMoreMenu}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <MenuItem
              onClick={() => {
                closeMoreMenu();
                handleRerouterClick();
              }}
            >
              <ListItemIcon>
                <AltRoute fontSize="small" />
              </ListItemIcon>
              <ListItemText>Reroute Banner</ListItemText>
            </MenuItem>
            {shouldShowAndroidDownloadButton ? (
              <MenuItem
                component="a"
                href="/OpenBanners.apk"
                download="OpenBanners.apk"
                onClick={closeMoreMenu}
              >
                <ListItemIcon>
                  <Download fontSize="small" />
                </ListItemIcon>
                <ListItemText>Download App</ListItemText>
              </MenuItem>
            ) : null}
            <Divider />
            {[
              ["system", "System theme", BrightnessAuto],
              ["light", "Light theme", LightMode],
              ["dark", "Dark theme", DarkMode],
            ].map(([mode, label, Icon]) => (
              <MenuItem
                key={mode}
                selected={themeMode === mode}
                onClick={() => {
                  saveThemeMode(mode);
                  closeMoreMenu();
                }}
              >
                <ListItemIcon>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{label}</ListItemText>
              </MenuItem>
            ))}
            <Divider />
            <MenuItem
              component="a"
              href="https://github.com/Gamer1120/OpenBanners"
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMoreMenu}
            >
              <ListItemIcon>
                <GitHub fontSize="small" />
              </ListItemIcon>
              <ListItemText>Source code</ListItemText>
            </MenuItem>
          </Menu>
        </div>
      </header>
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
