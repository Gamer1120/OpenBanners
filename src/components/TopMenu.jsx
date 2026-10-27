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
  Download,
  EventNote,
  InstallMobile,
  GitHub,
  Login,
  MoreVert,
  Settings as SettingsIcon,
  Translate,
} from "@mui/icons-material";
import SettingsDialog from "./SettingsDialog";
import InstallAppDialog from "./InstallAppDialog";
import OverlayDownloadDialog from "./OverlayDownloadDialog";
import { promptInstall, useInstallMode } from "../pwaInstall";
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
import { t, tk, tn } from "../i18n";
import AppLogo from "./AppLogo";

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

export default function TopMenu({
  onRerouterClick,
  onTitleClick,
  title = "",
}) {
  const authSupportedOrigin = isBannergressAuthSupportedOrigin();
  const installMode = useInstallMode();
  const [feedback, setFeedback] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [installHelpMode, setInstallHelpMode] = useState(null);
  const [overlayDownloadOpen, setOverlayDownloadOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);
  const [moreMenuAnchor, setMoreMenuAnchor] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(authSupportedOrigin);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isBannerTogetherRoute = /^\/(?:lists\/)?together(?:\/|$)/.test(
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
          message: tn(
            "Synced {count} banner list state from Bannergress.",
            "Synced {count} banner list states from Bannergress.",
            savedTotal
          ),
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
              : t("Bannergress sync failed."),
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
          message: t("Bannergress authenticated."),
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
          t("Bannergress auth is currently only available on supported OpenBanners domains."),
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
        message: t("Couldn't open Bannergress. Allow popups and try again."),
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
            : t("Bannergress authentication couldn't be started."),
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
          t("Authentication is still pending. Finish signing in on Bannergress, then return here."),
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
            : t("Bannergress authentication failed."),
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

  // English keys (compared below); translated where shown.
  let authButtonLabel = tk("Authenticate");
  let authButtonDisabled = false;

  if (!authSupportedOrigin) {
    authButtonLabel = tk("Auth Unavailable Here");
    authButtonDisabled = true;
  } else if (authStatus?.authenticated) {
    authButtonLabel = tk("Authenticated");
    authButtonDisabled = true;
  } else if (isCheckingAuth) {
    authButtonLabel = tk("Checking...");
    authButtonDisabled = true;
  } else if (isAuthenticating) {
    authButtonLabel = tk("Authenticating...");
    authButtonDisabled = true;
  }

  const agentName = authStatus?.authenticated ? getBannergressAgentName() : null;
  const authButtonTitle = authStatus?.authenticated
    ? agentName
      ? t("Signed in with Bannergress as {agent}", { agent: agentName })
      : t("Signed in with Bannergress")
    : authButtonLabel === "Authenticate"
      ? t("Sign in with Bannergress")
      : t(authButtonLabel);
  const closeMoreMenu = () => setMoreMenuAnchor(null);

  const handleInstallClick = async () => {
    closeMoreMenu();

    if (installMode === "prompt") {
      const outcome = await promptInstall();

      if (outcome !== "unavailable") {
        return;
      }
    }

    setInstallHelpMode(installMode === "prompt" ? "manual" : installMode);
  };

  return (
    <>
      <header className="ob-bar">
        <button
          type="button"
          className="ob-brand sl"
          onClick={onTitleClick}
          aria-label={t("Go to home page")}
        >
          <AppLogo />
          <span className="ob-brand-text">{title || "OpenBanners"}</span>
        </button>
        <div className="ob-bar-actions">
          <button
            type="button"
            className="icon-btn sl"
            aria-label={t(authButtonLabel)}
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
            aria-label={t("More options")}
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
              <ListItemText>{t("Reroute Banner")}</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={() => {
                closeMoreMenu();
                navigate("/planner");
              }}
            >
              <ListItemIcon>
                <EventNote fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("Mission Day planner")}</ListItemText>
            </MenuItem>
            {installMode !== "installed" ? (
              <MenuItem onClick={handleInstallClick}>
                <ListItemIcon>
                  <InstallMobile fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("Install app")}</ListItemText>
              </MenuItem>
            ) : null}
            <MenuItem
              onClick={() => {
                closeMoreMenu();
                setOverlayDownloadOpen(true);
              }}
            >
              <ListItemIcon>
                <Download fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("Download OpenBanners Overlay")}</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={() => {
                closeMoreMenu();
                navigate("/translate");
              }}
            >
              <ListItemIcon>
                <Translate fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("Translation editor")}</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={() => {
                closeMoreMenu();
                setSettingsOpen(true);
              }}
            >
              <ListItemIcon>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("Settings")}</ListItemText>
            </MenuItem>
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
              <ListItemText>{t("Source code")}</ListItemText>
            </MenuItem>
          </Menu>
        </div>
      </header>
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {installHelpMode ? (
        <InstallAppDialog mode={installHelpMode} onClose={() => setInstallHelpMode(null)} />
      ) : null}
      {overlayDownloadOpen ? <OverlayDownloadDialog onClose={() => setOverlayDownloadOpen(false)} /> : null}
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
