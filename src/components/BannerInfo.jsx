import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Skeleton,
  Snackbar,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

const BannerInfo = ({ banner, loading = false }) => {
  const navigate = useNavigate();
  const [shareFeedback, setShareFeedback] = useState(null);

  const handleOpenBannerGuider = () => {
    navigate(`/bannerguider/${banner.id}`);
  };

  const handleOpenBannerGuiderWithoutLocation = () => {
    navigate(`/bannerguiderwithoutlocation/${banner.id}`);
  };

  const handleNavigateToStartPoint = () => {
    if (!banner.startLatitude || !banner.startLongitude) {
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

  const handleShareBanner = () => {
    const bannerURL = `https://opnb.org/${banner.id}`;

    if (navigator.share) {
      navigator
        .share({
          url: bannerURL,
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
        .writeText(bannerURL)
        .then(() => {
          setShareFeedback({
            severity: "success",
            message: "Banner link copied to clipboard.",
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
    textarea.value = bannerURL;
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand("copy");
      setShareFeedback({
        severity: "success",
        message: "Banner link copied to clipboard.",
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

  return (
    <>
      <Box
        sx={{
          background: "rgba(20, 27, 33, 0.94)",
          color: "#fff",
          p: 2.25,
          m: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.25,
          borderRadius: 3,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "0 20px 45px rgba(0, 0, 0, 0.22)",
        }}
      >
        <Typography
          variant="overline"
          sx={{ color: "text.secondary", letterSpacing: "0.16em" }}
        >
          Banner Tools
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={handleShareBanner}
          disabled={loading}
        >
          Share banner
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleNavigateToStartPoint}
          disabled={loading || !banner.startLatitude || !banner.startLongitude}
        >
          Navigate to Start Point
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleOpenBannerGuider}
          disabled={loading}
        >
          Open BannerGuider
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleOpenBannerGuiderWithoutLocation}
          disabled={loading}
        >
          Open BannerGuider without location (may prevent "Inaccurate location" in
          Ingress on iOS)
        </Button>
        {!loading && (!banner.startLatitude || !banner.startLongitude) ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            No start-point coordinates are available for navigation.
          </Alert>
        ) : null}
        <Typography
          variant="body1"
          sx={{ fontSize: 16, lineHeight: 1.65, mt: 1, color: "text.secondary" }}
        >
          BannerGuider tutorial: Open BannerGuider, tap NEXT to open the next
          mission in your scanner. Do the mission, then press NEXT again until
          you are done with the banner.
        </Typography>
        <Typography variant="body1" sx={{ fontSize: 16, lineHeight: 1.7 }}>
          {loading ? (
            <>
              <Skeleton sx={{ bgcolor: "rgba(255,255,255,0.12)" }} />
              <Skeleton sx={{ bgcolor: "rgba(255,255,255,0.12)" }} />
              <Skeleton width="70%" sx={{ bgcolor: "rgba(255,255,255,0.12)" }} />
            </>
          ) : (
            banner.description || "No banner description is available."
          )}
        </Typography>
      </Box>
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
