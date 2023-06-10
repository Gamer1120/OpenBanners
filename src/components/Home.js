import React, { useState } from "react";
import { makeStyles } from "@mui/styles";
import TopMenu from "./TopMenu";
import BannersNearMe from "./BannersNearMe";
import { Typography } from "@mui/material";

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
    backgroundColor: theme.palette.grey[900],
    minHeight: "100vh",
  },
  browsingHeader: {
    marginTop: theme.spacing(2),
    color: theme.palette.common.white,
    // Add this line to make the text white
    color: "white",
  },
}));

export default function Home() {
  const classes = useStyles();
  const [isBrowsing, setIsBrowsing] = useState(false);

  const handleBrowseClick = () => {
    setIsBrowsing(true);
  };

  return (
    <div className={classes.root}>
      <TopMenu onBrowseClick={handleBrowseClick} />
      {!isBrowsing ? (
        <BannersNearMe />
      ) : (
        <Typography variant="h5" className={classes.browsingHeader}>
          Browsing
        </Typography>
      )}
    </div>
  );
}
