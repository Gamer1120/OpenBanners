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
import { applyPageMetadata } from "../seo";

function formatRouteParam(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getRouteMetadata({ pathname, placeId, agentName, query }) {
  if (pathname.startsWith("/banner/")) {
    return null;
  }

  if (pathname.startsWith("/search/")) {
    const searchQuery = typeof query === "string" ? query.trim() : "";

    return {
      title: searchQuery ? `Search: ${searchQuery}` : "Search",
      description: "Search Bannergress places and banners on OpenBanners.",
    };
  }

  if (pathname.startsWith("/browse/")) {
    const placeLabel = formatRouteParam(placeId);

    return {
      title: placeLabel ? `Browse: ${placeLabel}` : "Browse Banners",
      description: "Explore Bannergress banners by place on OpenBanners.",
    };
  }

  if (pathname.startsWith("/agent/")) {
    const agentLabel =
      typeof agentName === "string" && agentName.trim() !== ""
        ? agentName.trim()
        : "Agent";

    return {
      title: `Agent: ${agentLabel}`,
      description: `Banners created by ${agentLabel}.`,
    };
  }

  if (pathname.startsWith("/map")) {
    return {
      title: "Discovery Map",
      description: "Explore Bannergress banners on an interactive map.",
    };
  }

  if (pathname.startsWith("/rerouter")) {
    return {
      title: "Banner Rerouter",
      description: "Build rerouted banners from imported UMM data.",
    };
  }

  return {
    title: "Banners Near Me",
    description: "Find live Bannergress banners near your current location.",
  };
}

export default function Home() {
  const { placeId, agentName, query } = useParams();
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

  useEffect(() => {
    const routeMetadata = getRouteMetadata({
      pathname: location.pathname,
      placeId,
      agentName,
      query,
    });

    if (!routeMetadata) {
      return;
    }

    applyPageMetadata({
      ...routeMetadata,
      url: new URL(
        `${location.pathname}${location.search}`,
        window.location.origin
      ).toString(),
    });
  }, [agentName, location.pathname, location.search, placeId, query]);

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
