import { useState, useEffect } from "react";
import { Box } from "@mui/material";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import TopMenu from "./TopMenu";
import BannersNearMe from "./BannersNearMe";
import BrowsingPage from "./BrowsingPage";
import SearchResults from "./SearchResults";
import BannerDetailsPage from "./BannerDetailsPage";

export default function Home() {
  const [currentView, setCurrentView] = useState("bannersNearMe");
  const { placeId } = useParams();
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
      setCurrentView("searching");
    } else if (location.pathname.startsWith("/browse/")) {
      setCurrentView("browsing");
    } else if (location.pathname.startsWith("/banner/")) {
      setCurrentView("bannerDetails");
    } else {
      setCurrentView("bannersNearMe");
    }
  }, [location.pathname]);

  return (
    <Box sx={{ flexGrow: 1, bgcolor: "grey.900", minHeight: "100vh" }}>
      <TopMenu
        onBrowseClick={handleBrowseClick}
        onTitleClick={handleTitleClick}
        onSearch={handleSearch}
      />
      {currentView === "bannersNearMe" && <BannersNearMe />}
      {currentView === "browsing" && <BrowsingPage placeId={placeId} />}
      {currentView === "searching" && <SearchResults />}
      {currentView === "bannerDetails" && <BannerDetailsPage />}
    </Box>
  );
}
