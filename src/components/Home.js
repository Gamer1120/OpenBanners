import React, { useState } from "react";
import { makeStyles } from "@mui/styles";
import TopMenu from "./TopMenu";
import BannersNearMe from "./BannersNearMe";
import BrowsingPage from "./BrowsingPage";

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
    backgroundColor: theme.palette.grey[900],
    minHeight: "100vh",
  },
}));

export default function Home() {
  const classes = useStyles();
  const [isBrowsing, setIsBrowsing] = useState(false);

  const handleBrowseClick = () => {
    setIsBrowsing(true);
  };

  const handleTitleClick = () => {
    setIsBrowsing(false);
  };

  return (
    <div className={classes.root}>
      <TopMenu
        onBrowseClick={handleBrowseClick}
        onTitleClick={handleTitleClick}
      />
      {!isBrowsing ? <BannersNearMe /> : <BrowsingPage />}
    </div>
  );
}
