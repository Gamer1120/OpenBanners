import { useState, useEffect, useMemo } from "react";
import { Box, useMediaQuery } from "@mui/material";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import TopMenu from "./TopMenu";
import BannersNearMe from "./BannersNearMe";
import BrowsingPage from "./BrowsingPage";
import SearchResults from "./SearchResults";
import BannerDetailsPage from "./BannerDetailsPage";
import Map from "./Map";
import BannerRerouterPage from "./BannerRerouterPage";
import {
  readDiscoveryMapFilters,
  saveDiscoveryMapFilters,
} from "../discoveryMapState";
import {
  getBrowseStateScope,
  readBrowseFilters,
  saveBrowseFilters,
} from "../browseState";

export default function Home() {
  const { placeId, agentName } = useParams();
  const browseStateScope = useMemo(
    () => getBrowseStateScope({ placeId, authorName: agentName }),
    [agentName, placeId]
  );
  const [currentView, setCurrentView] = useState("bannersNearMe");
  const [bannerFilters, setBannerFilters] = useState(() =>
    readBrowseFilters(browseStateScope)
  );
  const [mapBannerFilters, setMapBannerFiltersState] = useState(
    readDiscoveryMapFilters
  );
  const isMobile = useMediaQuery("(max-width:768px)");
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

  const handleRerouterClick = () => {
    setCurrentView("rerouter");
    navigate("/rerouter");
  };

  const setMapBannerFilters = (nextFilters) => {
    setMapBannerFiltersState((currentFilters) => {
      const resolvedFilters =
        typeof nextFilters === "function"
          ? nextFilters(currentFilters)
          : nextFilters;

      saveDiscoveryMapFilters(resolvedFilters);
      return resolvedFilters;
    });
  };

  const setBrowseBannerFilters = (nextFilters) => {
    setBannerFilters((currentFilters) => {
      const resolvedFilters =
        typeof nextFilters === "function"
          ? nextFilters(currentFilters)
          : nextFilters;

      saveBrowseFilters(browseStateScope, resolvedFilters);
      return resolvedFilters;
    });
  };

  useEffect(() => {
    if (location.pathname.startsWith("/search/")) {
      setCurrentView("searching");
    } else if (location.pathname.startsWith("/browse/")) {
      setCurrentView("browsing");
    } else if (location.pathname.startsWith("/banner/")) {
      setCurrentView("bannerDetails");
    } else if (location.pathname.startsWith("/agent/")) {
      setCurrentView("agentBrowsing");
    } else if (location.pathname.startsWith("/map")) {
      setCurrentView("map");
    } else if (location.pathname.startsWith("/rerouter")) {
      setCurrentView("rerouter");
    } else {
      setCurrentView("bannersNearMe");
    }
  }, [location.pathname]);

  useEffect(() => {
    if (
      location.pathname.startsWith("/browse/") ||
      location.pathname.startsWith("/agent/")
    ) {
      setBannerFilters(readBrowseFilters(browseStateScope));
    }
  }, [browseStateScope, location.pathname]);

  return (
    <Box
      sx={{
        flexGrow: 1,
        bgcolor: "grey.900",
        height:
          currentView === "bannerDetails" || currentView === "map"
            ? "100dvh"
            : "auto",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TopMenu
        onBrowseClick={handleBrowseClick}
        onRerouterClick={handleRerouterClick}
        onTitleClick={handleTitleClick}
        onSearch={handleSearch}
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
            (currentView === "bannerDetails" || currentView === "map")
              ? "hidden"
              : "visible",
        }}
      >
        {currentView === "bannersNearMe" && <BannersNearMe />}
        {currentView === "browsing" && (
          <BrowsingPage
            placeId={placeId}
            bannerFilters={bannerFilters}
            onBannerFiltersChange={setBrowseBannerFilters}
          />
        )}
        {currentView === "agentBrowsing" && (
          <BrowsingPage
            authorName={agentName}
            bannerFilters={bannerFilters}
            onBannerFiltersChange={setBrowseBannerFilters}
          />
        )}
        {currentView === "searching" && <SearchResults />}
        {currentView === "bannerDetails" && <BannerDetailsPage />}
        {currentView === "map" && (
          <Map
            bannerFilters={mapBannerFilters}
            onBannerFiltersChange={setMapBannerFilters}
          />
        )}
        {currentView === "rerouter" && <BannerRerouterPage />}
      </Box>
    </Box>
  );
}
