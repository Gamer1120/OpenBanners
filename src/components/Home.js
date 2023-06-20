import { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import TopMenu from "./TopMenu";
import BannersNearMe from "./BannersNearMe";
import BrowsingPage from "./BrowsingPage";
import SearchResults from "./SearchResults";

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
    backgroundColor: theme.palette.grey[900],
    minHeight: "100vh",
  },
}));

export default function Home() {
  const classes = useStyles();
  const [currentView, setCurrentView] = useState("bannersNearMe");
  const { placeId, searchQuery } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const handleBrowseClick = () => {
    setCurrentView("browsing");
    navigate("/browse/");
  };

  const handleSearch = (query) => {
    setCurrentView("searching");
    navigate(`/search/${encodeURIComponent(query)}`);
  };

  const handleTitleClick = () => {
    setCurrentView("bannersNearMe");
    navigate("/");
  };

  useEffect(() => {
    if (location.pathname.startsWith("/search/")) {
      setCurrentView("searchResults");
    } else if (location.pathname.startsWith("/browse/")) {
      setCurrentView("browsing");
    } else {
      setCurrentView("bannersNearMe");
    }
  }, [location.pathname]);

  return (
    <div className={classes.root}>
      <TopMenu
        onBrowseClick={handleBrowseClick}
        onTitleClick={handleTitleClick}
        onSearch={handleSearch}
      />
      {currentView === "bannersNearMe" && <BannersNearMe />}
      {currentView === "browsing" && <BrowsingPage placeId={placeId} />}
      {currentView === "searching" && <SearchResults query={searchQuery} />}
    </div>
  );
}
