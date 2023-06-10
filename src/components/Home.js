import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import TopMenu from "./TopMenu";
import BannersNearMe from "./BannersNearMe";
import BrowsingPage from "./BrowsingPage";
import CountryPage from "./CountryPage";
import { useLocation, useNavigate } from "react-router-dom";

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
  const location = useLocation();
  const navigate = useNavigate();

  const handleBrowseClick = () => {
    setIsBrowsing(true);
  };

  const handleTitleClick = () => {
    setIsBrowsing(false);
    navigate("/");
  };

  useEffect(() => {
    setIsBrowsing(location.pathname.startsWith("/browse/"));
  }, [location]);

  const isCountryPage =
    location.pathname.startsWith("/browse/") &&
    !isBrowsing &&
    location.pathname.split("/").length === 3;

  return (
    <div className={classes.root}>
      <TopMenu
        onBrowseClick={handleBrowseClick}
        onTitleClick={handleTitleClick}
      />
      {!isBrowsing ? (
        <BannersNearMe />
      ) : isCountryPage ? (
        <CountryPage />
      ) : (
        <BrowsingPage />
      )}
    </div>
  );
}
