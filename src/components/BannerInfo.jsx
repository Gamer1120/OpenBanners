import React, { useState } from "react";
import { Alert, Snackbar } from "@mui/material";
import {
  Directions,
  Explore,
  Layers,
  OpenInNew,
  Share,
  TouchApp,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";

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

// "Start this banner": share, OpenBanners Overlay, navigation and BannerGuider.
const BannerInfo = ({ banner, loading = false }) => {
  const navigate = useNavigate();
  const [shareFeedback, setShareFeedback] = useState(null);
  const hasStartPoint = Boolean(banner.startLatitude && banner.startLongitude);

  const handleOpenBannerGuider = () => {
    navigate(`/bannerguider/${banner.id}`);
  };

  const handleOpenBannerGuiderWithoutLocation = () => {
    navigate(`/bannerguiderwithoutlocation/${banner.id}`);
  };

  const handleNavigateToStartPoint = () => {
    if (!hasStartPoint) {
      setShareFeedback({
        severity: "warning",
        message: "This banner does not have a valid start point.",
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
      successMessage = "Banner link copied to clipboard.",
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
            message: "Couldn't share this banner.",
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
            message: "Couldn't copy the banner link.",
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
        message: "Couldn't copy the banner link.",
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
        : "OpenBanners banner";
    const shareText = [
      bannerTitle,
      `https://openbanners.org/banner/${encodedBannerId}`,
      `https://bannergress.com/banner/${encodedBannerId}`,
    ].join("\n");

    shareBannerText(shareText, {
      title: bannerTitle,
    });
  };

  const handleShareBannergressOverlay = () => {
    shareBannerText(`https://bannergress.com/banner/${banner.id}`, {
      title: banner.title,
      successMessage: "OpenBanners Overlay link copied to clipboard.",
    });
  };

  return (
    <>
      <div className="card">
        <h2>Start this banner</h2>
        <ul className="ob-list">
          <ActionItem
            icon={Directions}
            title="Navigate to Start Point"
            subtitle="Google Maps directions to the first waypoint"
            onClick={handleNavigateToStartPoint}
            disabled={loading || !hasStartPoint}
            trailing={<OpenInNew fontSize="small" className="muted" />}
          />
          <ActionItem
            icon={Layers}
            title="Open with OpenBanners Overlay"
            subtitle="Shows the next waypoint on top of Ingress (Android app)"
            onClick={handleShareBannergressOverlay}
            disabled={loading}
          />
          <ActionItem
            icon={Explore}
            title="Open BannerGuider"
            subtitle="Guides you to each next portal using your location"
            onClick={handleOpenBannerGuider}
            disabled={loading}
          />
          <ActionItem
            icon={TouchApp}
            title="Open BannerGuider without location"
            subtitle='Step through manually; may prevent "Inaccurate location" in Ingress on iOS'
            onClick={handleOpenBannerGuiderWithoutLocation}
            disabled={loading}
          />
          <ActionItem
            icon={Share}
            title="Share banner"
            subtitle="Send this banner to a friend"
            onClick={handleShareBanner}
            disabled={loading}
          />
        </ul>
        {!loading && !hasStartPoint ? (
          <p className="small muted">No start-point coordinates are available for navigation.</p>
        ) : null}
        <p className="small muted" style={{ marginTop: 8 }}>
          BannerGuider tutorial: Open BannerGuider, tap NEXT to open the next
          mission in your scanner. Do the mission, then press NEXT again until
          you are done with the banner.
        </p>
      </div>
      <Snackbar
        open={Boolean(shareFeedback)}
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
