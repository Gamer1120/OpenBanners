import React from "react";
import PropTypes from "prop-types";
import { makeStyles } from "@mui/styles";
import { Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";

const useStyles = makeStyles((theme) => ({
  bannerInfo: {
    backgroundColor: "#1F1F1F",
    color: "#fff",
    padding: theme.spacing(2),
    margin: theme.spacing(2),
  },
  title: {
    fontSize: 20,
    marginBottom: theme.spacing(1),
  },
  description: {
    fontSize: 16,
    lineHeight: 1.5,
  },
}));

const BannerInfo = ({ banner }) => {
  const classes = useStyles();
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
    <div className={classes.bannerInfo}>
      <Button
        variant="contained"
        color="primary"
        onClick={handleShareBanner}
        className={classes.button}
      >
        Share banner
      </Button>
      <Button
        variant="contained"
        color="primary"
        onClick={handleNavigateToStartPoint}
        className={classes.button}
      >
        Navigate to Start Point
      </Button>
      <Button
        variant="contained"
        color="primary"
        onClick={handleOpenBannerGuider}
        className={classes.button}
      >
        Open BannerGuider
      </Button>
      <Button
        variant="contained"
        color="primary"
        onClick={handleOpenBannerGuiderWithoutLocation}
        className={classes.button}
      >
        Open BannerGuider without location (may prevent "Inaccurate location" in
        Ingress on iOS)
      </Button>
      <Typography variant="body1" className={classes.description}>
        BannerGuider tutorial: Open BannerGuider, tap NEXT to open the next
        mission in your scanner. Do the mission, press NEXT again until you're
        done with the banner.
      </Typography>
      <br />
      <Typography variant="body1" className={classes.description}>
        {banner.description}
      </Typography>
    </div>
  );
};

export default BannerInfo;
