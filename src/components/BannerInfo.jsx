import React from "react";
import { Box, Button, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";

const BannerInfo = ({ banner }) => {
  const navigate = useNavigate();

  const handleOpenBannerGuider = () => {
    navigate(`/bannerguider/${banner.id}`);
  };

  const handleOpenBannerGuiderWithoutLocation = () => {
    navigate(`/bannerguiderwithoutlocation/${banner.id}`);
  };

  const handleNavigateToStartPoint = () => {
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
        .then(() => console.log("Shared successfully."))
        .catch((error) => console.error("Error sharing:", error));
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = bannerURL;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  return (
    <Box
      sx={{
        bgcolor: "#1F1F1F",
        color: "#fff",
        p: 2,
        m: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <Button variant="contained" color="primary" onClick={handleShareBanner}>
        Share banner
      </Button>
      <Button
        variant="contained"
        color="primary"
        onClick={handleNavigateToStartPoint}
      >
        Navigate to Start Point
      </Button>
      <Button variant="contained" color="primary" onClick={handleOpenBannerGuider}>
        Open BannerGuider
      </Button>
      <Button
        variant="contained"
        color="primary"
        onClick={handleOpenBannerGuiderWithoutLocation}
      >
        Open BannerGuider without location (may prevent "Inaccurate location" in
        Ingress on iOS)
      </Button>
      <Typography variant="body1" sx={{ fontSize: 16, lineHeight: 1.5, mt: 1 }}>
        BannerGuider tutorial4: Open BannerGuider, tap NEXT to open the next
        mission in your scanner. Do the mission, press NEXT again until you're
        done with the banner.
      </Typography>
      <Typography variant="body1" sx={{ fontSize: 16, lineHeight: 1.5 }}>
        {banner.description}
      </Typography>
    </Box>
  );
};

export default BannerInfo;
