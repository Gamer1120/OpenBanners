import { useState, useEffect } from "react";
import { Box, useMediaQuery } from "@mui/material";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import TopMenu from "./TopMenu";
import BannersNearMe from "./BannersNearMe";
import BrowsingPage from "./BrowsingPage";
import SearchResults from "./SearchResults";
import BannerDetailsPage from "./BannerDetailsPage";
import Map from "./Map";
import { DEFAULT_BANNER_FILTERS } from "../bannerFilters";

export default function Home() {
  const [currentView, setCurrentView] = useState("bannersNearMe");
  const [bannerFilters, setBannerFilters] = useState(DEFAULT_BANNER_FILTERS);
  const isMobile = useMediaQuery("(max-width:768px)");
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
    } else if (location.pathname.startsWith("/map")) {
      setCurrentView("map");
    } else {
      setCurrentView("bannersNearMe");
    }
  }, [location.pathname]);

  return (
    <Box
      sx={{
        flexGrow: 1,
        bgcolor: "grey.900",
        height:
          (currentView === "bannerDetails" || currentView === "map") && !isMobile
            ? "100dvh"
            : "auto",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TopMenu
        onBrowseClick={handleBrowseClick}
        onTitleClick={handleTitleClick}
        onSearch={handleSearch}
        showBannerFilters={currentView === "map"}
        bannerFilters={bannerFilters}
        onBannerFiltersChange={setBannerFilters}
      />
      <Box
        component="main"
        id="main-content"
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow:
            (currentView === "bannerDetails" || currentView === "map") && !isMobile
              ? "hidden"
              : "visible",
        }}
      >
        {currentView === "bannersNearMe" && <BannersNearMe />}
        {currentView === "browsing" && (
          <BrowsingPage
            placeId={placeId}
            bannerFilters={bannerFilters}
            onBannerFiltersChange={setBannerFilters}
          />
        )}
        {currentView === "searching" && <SearchResults />}
        {currentView === "bannerDetails" && <BannerDetailsPage />}
        {currentView === "map" && <Map bannerFilters={bannerFilters} />}
      </Box>
    </Box>
  );
}
