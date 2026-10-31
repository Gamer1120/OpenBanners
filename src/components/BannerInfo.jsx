import React, { useEffect, useRef, useState } from "react";
import { Alert, Snackbar } from "@mui/material";
import { Directions, Explore, Layers, OpenInNew, Share } from "@mui/icons-material";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { t } from "../i18n";
import {
  buildOverlayStartIntentUrl,
  buildOverlayStartLink,
  isAndroidUserAgent,
  isOverlayMissingSearch,
  watchAppLaunch,
  withoutOverlayMissing,
} from "../overlayLink";
import { detectInAppBrowser } from "../inAppBrowser";
import { OverlayMissingDialog } from "./OverlayDownloadDialog";

function RowAction({ icon: Icon, label, title, onClick, disabled, primary = false }) {
  return (
    <li>
      <button
        type="button"
        className={`bi-row-btn sl${primary ? " primary" : ""}`}
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={title}
      >
        <Icon fontSize="small" />
        <span aria-hidden="true">{label}</span>
      </button>
    </li>
  );
}

function ActionItem({ icon: Icon, title, subtitle, onClick, disabled, trailing = null }) {
  return (
    <li>
      <button type="button" className="li sl" onClick={onClick} disabled={disabled}>
        <span className="lead">
          <Icon fontSize="small" />
        </span>
        <span className="txt">
          <span className="t">{title}</span>
          <span className="s">{subtitle}</span>
        </span>
        {trailing}
      </button>
    </li>
  );
}

// "Start this banner": navigation, BannerGuider, OpenBanners Overlay and share.
// variant "list" = card with one row per action; "row" = one row of compact
// buttons (heading optional, e.g. inside a sticky action bar).
const BannerInfo = ({ banner, loading = false, variant = "list", heading = t("Start this banner"), className = "" }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { bannerId: routeBannerId } = useParams();
  const bannerId = banner?.id ?? routeBannerId;
  const [shareFeedback, setShareFeedback] = useState(null);
  // null or the OverlayMissingDialog reason: "missing" (came back from the
  // intent fallback), "notAndroid", "noResponse" (the link didn't leave the
  // page) or "inApp" (in-app browser: explain first, then try).
  const [overlayMissing, setOverlayMissing] = useState(null);
  const stopLaunchWatch = useRef(null);
  useEffect(() => () => stopLaunchWatch.current?.(), []);

  // Chrome opened ?overlay=missing because the Overlay app isn't installed:
  // show the install dialog once and drop the parameter, so reload/back
  // don't open it again. Not while the banner loads: the banner page swaps
  // the loading placeholder (with its own BannerInfo) for the real content, so
  // the dialog would be shown and lost in the placeholder.
  useEffect(() => {
    if (loading || !isOverlayMissingSearch(location.search)) {
      return;
    }
    setOverlayMissing("missing");
    navigate(
      { pathname: location.pathname, search: withoutOverlayMissing(location.search), hash: location.hash },
      { replace: true, state: location.state }
    );
  }, [loading, location.search, location.pathname, location.hash, location.state, navigate]);
  const hasStartPoint = Boolean(banner.startLatitude && banner.startLongitude);

  // BannerGuider without location is the default (the location variant's route
  // still works when typed in, but isn't linked any more).
  const handleOpenBannerGuider = () => {
    navigate(`/bannerguiderwithoutlocation/${banner.id}`);
  };

  const handleNavigateToStartPoint = () => {
    if (!hasStartPoint) {
      setShareFeedback({
        severity: "warning",
        message: t("This banner does not have a valid start point."),
      });
      return;
    }

    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${banner.startLatitude},${banner.startLongitude}`,
      "_self"
    );
  };

  const shareBannerText = (
    text,
    {
      title = "OpenBanners",
      successMessage = t("Banner link copied to clipboard."),
    } = {}
  ) => {
    if (navigator.share) {
      navigator
        .share({
          title,
          text,
        })
        .catch((error) => {
          console.error("Error sharing:", error);
          setShareFeedback({
            severity: "error",
            message: t("Couldn't share this banner."),
          });
        });
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setShareFeedback({
            severity: "success",
            message: successMessage,
          });
        })
        .catch((error) => {
          console.error("Error copying banner URL:", error);
          setShareFeedback({
            severity: "error",
            message: t("Couldn't copy the banner link."),
          });
        });
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand("copy");
      setShareFeedback({
        severity: "success",
        message: successMessage,
      });
    } catch (error) {
      console.error("Error copying banner URL:", error);
      setShareFeedback({
        severity: "error",
        message: t("Couldn't copy the banner link."),
      });
    } finally {
      document.body.removeChild(textarea);
    }
  };

  const handleShareBanner = () => {
    const encodedBannerId = encodeURIComponent(banner.id);
    const bannerTitle =
      typeof banner.title === "string" && banner.title.trim() !== ""
        ? banner.title.trim()
        : t("OpenBanners banner");
    const shareText = [
      bannerTitle,
      `https://openbanners.org/banner/${encodedBannerId}`,
      `https://bannergress.com/banner/${encodedBannerId}`,
    ].join("\n");

    shareBannerText(shareText, {
      title: bannerTitle,
    });
  };

  // Android: open the Overlay app straight at mission 1 (it opens that mission
  // in Ingress); without the app Chrome comes back with ?overlay=missing.
  // Elsewhere the app can't be launched: show the install dialog straight away.
  // In-app browsers (Telegram, …) often ignore app links, so they get the
  // dialog first (with the link as a button). Anywhere on Android, a link that
  // leaves the page in front for 3 s shows the dialog too (and
  // it closes again if the app turns up late).
  const handleStartWithOverlay = () => {
    if (!isAndroidUserAgent(navigator.userAgent)) {
      setOverlayMissing("notAndroid");
      return;
    }

    if (detectInAppBrowser()) {
      setOverlayMissing("inApp");
      return;
    }

    stopLaunchWatch.current?.();
    stopLaunchWatch.current = watchAppLaunch(() => setOverlayMissing("noResponse"), {
      // The app turned up after all: take the "didn't open" dialog away again.
      onLateLaunch: () =>
        setOverlayMissing((reason) => (reason === "noResponse" ? null : reason)),
    });
    window.location.assign(
      buildOverlayStartIntentUrl(banner.id, window.location.origin)
    );
  };

  // The dialog's alternative: the Android share sheet with the Bannergress
  // link (Bannergress Overlay accepts it); copied where sharing isn't possible.
  const handleOpenInBannergress = () => {
    shareBannerText(`https://bannergress.com/banner/${encodeURIComponent(bannerId)}`, {
      title: banner?.title || "OpenBanners",
      successMessage: t("Bannergress link copied to clipboard."),
    });
  };

  const actions = [
    {
      key: "navigate",
      icon: Directions,
      label: t("Navigate"),
      title: t("Navigate to Start Point"),
      subtitle: t("Google Maps directions to the first waypoint"),
      onClick: handleNavigateToStartPoint,
      disabled: loading || !hasStartPoint,
      trailing: <OpenInNew fontSize="small" className="muted" />,
    },
    {
      key: "guider",
      icon: Explore,
      label: "BannerGuider",
      title: t("Open BannerGuider"),
      subtitle: t("Step through the missions one by one"),
      onClick: handleOpenBannerGuider,
      disabled: loading,
      primary: true,
    },
    {
      key: "overlay",
      icon: Layers,
      label: t("Start with Overlay"),
      title: t("Start with OpenBanners Overlay"),
      subtitle: t("Opens mission 1 in Ingress with the overlay on top (Android app)"),
      onClick: handleStartWithOverlay,
      disabled: loading,
    },
    {
      key: "share",
      icon: Share,
      label: t("Share"),
      title: t("Share banner"),
      subtitle: t("Send this banner to a friend"),
      onClick: handleShareBanner,
      disabled: loading,
    },
  ];

  return (
    <>
      {variant === "row" ? (
        <div className={`bi-row ${className}`.trim()}>
          {heading ? <h2 className="bi-row-h">{heading}</h2> : null}
          <ul className="bi-row-list" aria-label={heading || t("Start this banner")}>
            {actions.map(({ key, trailing, subtitle, ...action }) => (
              <RowAction key={key} {...action} />
            ))}
          </ul>
        </div>
      ) : (
        <div className={`card ${className}`.trim()}>
          {heading ? <h2>{heading}</h2> : null}
          <ul className="ob-list">
            {actions.map(({ key, label, primary, ...action }) => (
              <ActionItem key={key} {...action} />
            ))}
          </ul>
          {!loading && !hasStartPoint ? (
            <p className="small muted">{t("No start-point coordinates are available for navigation.")}</p>
          ) : null}
        </div>
      )}
      {overlayMissing ? (
        <OverlayMissingDialog
          reason={overlayMissing}
          appLink={bannerId ? buildOverlayStartLink(bannerId, window.location.origin) : null}
          onClose={() => setOverlayMissing(null)}
          onOpenInBannergress={bannerId ? handleOpenInBannergress : null}
        />
      ) : null}
      <Snackbar
        open={Boolean(shareFeedback)}
        sx={{ zIndex: 1500 }}
        autoHideDuration={2500}
        onClose={() => setShareFeedback(null)}
      >
        {shareFeedback ? (
          <Alert
            severity={shareFeedback.severity}
            onClose={() => setShareFeedback(null)}
            sx={{ width: "100%" }}
          >
            {shareFeedback.message}
          </Alert>
        ) : null}
      </Snackbar>
    </>
  );
};

export default BannerInfo;
