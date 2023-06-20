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
  const [isBrowsing, setIsBrowsing] = useState(false);
  const { placeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState("");

  const handleBrowseClick = () => {
    setIsBrowsing(true);
    navigate("/browse/");
  };

  const handleSearch = (event) => {
    navigate(`/search/${event}`);
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
        onSearch={handleSearch}
      />
      {!isBrowsing ? (
        searchQuery ? (
          <SearchResults query={searchQuery} />
        ) : (
          <BannersNearMe />
        )
      ) : (
        <BrowsingPage placeId={placeId} />
      )}
    </div>
  );
}
