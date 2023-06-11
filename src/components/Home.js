import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import { useParams, useNavigate, useLocation } from "react-router-dom";
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
  const { placeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const handleBrowseClick = () => {
    setIsBrowsing(true);
    navigate("/browse/"); // Navigate to the "/browse/" route
  };

  const handleTitleClick = () => {
    setIsBrowsing(false);
    navigate("/");
  };

  useEffect(() => {
    setIsBrowsing(location.pathname.startsWith("/browse/"));
  }, [location.pathname]);

  return (
    <div className={classes.root}>
      <TopMenu
        onBrowseClick={handleBrowseClick}
        onTitleClick={handleTitleClick}
      />
      {!isBrowsing ? <BannersNearMe /> : <BrowsingPage placeId={placeId} />}
    </div>
  );
}
