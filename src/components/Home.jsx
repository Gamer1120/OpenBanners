import { useState, useEffect, useMemo } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import TopMenu from "./TopMenu";
import AppNav from "./AppNav";
import BannersNearMe from "./BannersNearMe";
import ListsPage from "./ListsPage";
import BrowsingPage from "./BrowsingPage";
import SearchResults from "./SearchResults";
import BannerDetailsPage from "./BannerDetailsPage";
import Map from "./Map";
import BannerRerouterPage from "./BannerRerouterPage";
import BannerTogetherPage from "./BannerTogetherPage";
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
import { buildAppTheme } from "../appTheme";

const legacyDarkTheme = buildAppTheme("dark");

function LegacyDark({ children, fill = false }) {
  return (
    <ThemeProvider theme={legacyDarkTheme}>
      <div className={`legacy-dark${fill ? " fill" : ""}`}>{children}</div>
    </ThemeProvider>
  );
}

const VIEW_TITLES = {
  browsing: "Browse",
  agentBrowsing: "Browse",
  map: "Map",
  lists: "Lists",
  searching: "Search",
  together: "Banner Together",
  rerouter: "Reroute Banner",
};

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

  if (pathname.startsWith("/lists/together/")) {
    return {
      title: "Banner Together",
      description:
        "Compare Bannergress banner list states in a live peer room.",
    };
  }

  if (pathname.startsWith("/lists")) {
    return {
      title: "Your lists",
      description: "Your Bannergress to-do, done and hidden banners.",
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

function getCurrentView(pathname) {
  if (pathname.startsWith("/search/")) {
    return "searching";
  }

  if (pathname.startsWith("/browse/")) {
    return "browsing";
  }

  if (pathname.startsWith("/banner/")) {
    return "bannerDetails";
  }

  if (pathname.startsWith("/agent/")) {
    return "agentBrowsing";
  }

  if (pathname.startsWith("/lists/together/")) {
    return "together";
  }

  if (pathname.startsWith("/map")) {
    return "map";
  }

  if (pathname.startsWith("/rerouter")) {
    return "rerouter";
  }

  if (pathname.startsWith("/lists")) {
    return "lists";
  }

  return "bannersNearMe";
}

export default function Home() {
  const { placeId, roomId, agentName, query } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const browseStateScope = useMemo(
    () => getBrowseStateScope({ placeId, authorName: agentName }),
    [agentName, placeId]
  );
  const [currentView, setCurrentView] = useState(() =>
    getCurrentView(location.pathname)
  );
  const [bannerFilters, setBannerFilters] = useState(() =>
    readBrowseFilters(browseStateScope)
  );
  const [mapBannerFilters, setMapBannerFiltersState] = useState(
    readDiscoveryMapFilters
  );

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
    setCurrentView(getCurrentView(location.pathname));
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

  const fillViewport = currentView === "bannerDetails" || currentView === "map";

  return (
    <div className={`ob-app${fillViewport ? " fill" : ""}`}>
      <a className="sr" href="#main-content">
        Skip to content
      </a>
      <AppNav />
      <div className="ob-col">
        <TopMenu
          onRerouterClick={handleRerouterClick}
          onTitleClick={handleTitleClick}
          onSearch={handleSearch}
          showSearch={currentView !== "bannersNearMe"}
          title={VIEW_TITLES[currentView] ?? ""}
        />
        <main className="ob-main" id="main-content" tabIndex={-1}>
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
          {currentView === "lists" && <ListsPage />}
          {currentView === "together" && (
            <BannerTogetherPage placeId={placeId} roomId={roomId} />
          )}
          {currentView === "map" && (
            <LegacyDark fill>
              <Map
                bannerFilters={mapBannerFilters}
                onBannerFiltersChange={setMapBannerFilters}
              />
            </LegacyDark>
          )}
          {currentView === "rerouter" && (
            <LegacyDark>
              <BannerRerouterPage />
            </LegacyDark>
          )}
        </main>
      </div>
    </div>
  );
}
