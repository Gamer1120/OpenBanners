import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import TopMenu from "./TopMenu";
import AppNav from "./AppNav";
import BannersNearMe from "./BannersNearMe";
import BannersStartPage from "./BannersStartPage";
import SearchPage from "./SearchPage";
import ListsPage from "./ListsPage";
import BrowsingPage from "./BrowsingPage";
import AuthorPassphraseNotice from "./AuthorPassphraseNotice";
import NotFoundPage from "./NotFoundPage";
import ErrorBoundary from "./ErrorBoundary";
import {
  getBrowseStateScope,
  readBrowseFilters,
  saveBrowseFilters,
} from "../browseState";
import { applyPageMetadata } from "../seo";
import { buildAppTheme } from "../appTheme";
import { t, tk } from "../i18n";

// Loaded only when opened: it carries every UI text (keys.json).
const TranslationEditor = lazy(() => import("./TranslationEditor"));
const PrivacyPage = lazy(() => import("./PrivacyPage"));
const OverlayConnectPage = lazy(() => import("./OverlayConnectPage"));
// Pages with a map (Leaflet) or a lot of code of their own come as separate
// chunks, so the home page, search and browse don't download them.
const BannerDetailsPage = lazy(() => import("./BannerDetailsPage"));
const DiscoveryMap = lazy(() => import("./discoveryMap/DiscoveryMap"));
const BannerRerouterPage = lazy(() => import("./BannerRerouterPage"));
const MissionDayPlanner = lazy(() => import("./MissionDayPlanner"));
const BannerTogetherPage = lazy(() => import("./BannerTogetherPage"));

const legacyDarkTheme = buildAppTheme("dark");

function LegacyDark({ children, fill = false }) {
  return (
    <ThemeProvider theme={legacyDarkTheme}>
      <div className={`legacy-dark${fill ? " fill" : ""}`}>{children}</div>
    </ThemeProvider>
  );
}

const VIEW_TITLES = {
  start: tk("Banners"),
  near: tk("Banners"),
  browsing: tk("Banners"),
  agentBrowsing: tk("Banners"),
  search: tk("Search"),
  map: tk("Map"),
  lists: tk("Lists"),
  searching: tk("Search"),
  together: "Banner Together",
  rerouter: tk("Reroute Banner"),
  planner: tk("Mission Day planner"),
  translate: tk("Translation editor"),
  privacy: tk("Privacy"),
  overlayConnect: tk("Connect OpenBanners Overlay"),
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

function getRouteMetadata({ pathname, placeId, agentName, query, notFound }) {
  if (notFound) {
    return {
      title: t("Page not found"),
      description: t("There’s no page at this address. The link may be mistyped or out of date."),
    };
  }

  if (pathname.startsWith("/banner/")) {
    return null;
  }

  if (pathname.startsWith("/search/")) {
    const searchQuery = typeof query === "string" ? query.trim() : "";

    return {
      title: searchQuery ? t("Search: {query}", { query: searchQuery }) : t("Search"),
      description: t("Search Bannergress places and banners on OpenBanners."),
    };
  }

  if (pathname.startsWith("/browse/")) {
    const placeLabel = formatRouteParam(placeId);

    return {
      title: placeLabel ? t("Browse: {place}", { place: placeLabel }) : t("Browse Banners"),
      description: t("Explore Bannergress banners by place on OpenBanners."),
    };
  }

  if (pathname.startsWith("/agent/")) {
    const agentLabel =
      typeof agentName === "string" && agentName.trim() !== ""
        ? agentName.trim()
        : t("Agent");

    return {
      title: t("Agent: {agent}", { agent: agentLabel }),
      description: t("Banners created by {agent}.", { agent: agentLabel }),
    };
  }

  if (pathname.startsWith("/map")) {
    return {
      title: t("Discovery Map"),
      description: t("Explore Bannergress banners on an interactive map."),
    };
  }

  if (pathname.startsWith("/lists/together/")) {
    return {
      title: "Banner Together",
      description:
        t("Compare Bannergress banner list states in a live peer room."),
    };
  }

  if (pathname.startsWith("/lists")) {
    return {
      title: t("Your lists"),
      description: t("Your Bannergress to-do, done and hidden banners."),
    };
  }

  if (pathname.startsWith("/planner")) {
    return {
      title: t("Mission Day planner"),
      description: t("Plan which missions to do and in what order, together."),
    };
  }

  if (pathname === "/overlay/connect") {
    return {
      title: t("Connect OpenBanners Overlay"),
      description: t("Back up or restore the OpenBanners Overlay app's settings with your account."),
    };
  }

  if (pathname === "/privacy") {
    return {
      title: t("Privacy"),
      description: t("What OpenBanners stores and logs, and how to delete it."),
    };
  }

  if (pathname.startsWith("/translate")) {
    return {
      title: t("Translation editor"),
      description: t("Help translate OpenBanners into your language."),
    };
  }

  if (pathname.startsWith("/rerouter")) {
    return {
      title: t("Banner Rerouter"),
      description: t("Build rerouted banners from imported UMM data."),
    };
  }

  return {
    title: t("Banners Near Me"),
    description: t("Find live Bannergress banners near your current location."),
  };
}

function getCurrentView(pathname) {
  if (pathname === "/search" || pathname === "/search/") {
    return "search";
  }

  if (pathname.startsWith("/search/")) {
    return "searching";
  }

  if (pathname === "/near") {
    return "near";
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

  if (pathname.startsWith("/planner")) {
    return "planner";
  }

  if (pathname.startsWith("/translate")) {
    return "translate";
  }

  if (pathname === "/privacy") {
    return "privacy";
  }

  if (pathname === "/overlay/connect") {
    return "overlayConnect";
  }

  if (pathname.startsWith("/lists")) {
    return "lists";
  }

  return "start";
}

export default function Home({ notFound = false }) {
  const { placeId, roomId, agentName, query, planId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const browseStateScope = useMemo(
    () => getBrowseStateScope({ placeId, authorName: agentName }),
    [agentName, placeId]
  );
  // Derived in render so the old view unmounts in the same commit as the
  // route change; Back then restores scroll against the right list.
  const currentView = notFound ? "notFound" : getCurrentView(location.pathname);
  const [bannerFilters, setBannerFilters] = useState(() =>
    readBrowseFilters(browseStateScope)
  );

  const handleTitleClick = () => {
    navigate("/");
  };

  const handleRerouterClick = () => {
    navigate("/rerouter");
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

  // "/" opens search (laptop keyboards), unless you are already typing.
  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;

      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented ||
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName)
      ) {
        return;
      }

      event.preventDefault();

      if (location.pathname === "/search" || location.pathname.startsWith("/search/")) {
        document.querySelector(".search-page input[type=search]")?.focus();
      } else {
        navigate("/search");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (
      location.pathname.startsWith("/browse/") ||
      location.pathname.startsWith("/agent/") ||
      location.pathname === "/near"
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
      notFound,
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
  }, [agentName, location.pathname, location.search, notFound, placeId, query]);

  const fillViewport = currentView === "bannerDetails" || currentView === "map";

  return (
    <div className={`ob-app${fillViewport ? " fill" : ""}`}>
      <a className="sr" href="#main-content">
        {t("Skip to content")}
      </a>
      <AppNav />
      <div className="ob-col">
        <TopMenu
          onRerouterClick={handleRerouterClick}
          onTitleClick={handleTitleClick}
          title={VIEW_TITLES[currentView] ? t(VIEW_TITLES[currentView]) : ""}
        />
        <main className="ob-main" id="main-content" tabIndex={-1}>
          <ErrorBoundary resetKey={location.pathname}>
          {/* The lazy pages' fallback is empty: the banner page and the map
              fill the viewport (.ob-app.fill) either way, so nothing moves. */}
          <Suspense fallback={null}>
          {currentView === "notFound" && <NotFoundPage />}
          {currentView === "privacy" && <PrivacyPage />}
          {currentView === "overlayConnect" && <OverlayConnectPage />}
          {currentView === "start" || currentView === "lists" ? <AuthorPassphraseNotice /> : null}
          {currentView === "start" && <BannersStartPage />}
          {currentView === "near" && (
            <BannersNearMe
              bannerFilters={bannerFilters}
              onBannerFiltersChange={setBrowseBannerFilters}
            />
          )}
          {/* One element for /search and /search/<query>: typing changes the
              URL without remounting the field (focus and caret stay). */}
          {(currentView === "search" || currentView === "searching") && <SearchPage />}
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
          {currentView === "bannerDetails" && <BannerDetailsPage />}
          {currentView === "lists" && <ListsPage />}
          {currentView === "together" && (
            <BannerTogetherPage placeId={placeId} roomId={roomId} />
          )}
          {currentView === "map" && (
            <LegacyDark fill>
              <DiscoveryMap />
            </LegacyDark>
          )}
          {currentView === "planner" && <MissionDayPlanner planId={planId} />}
          {currentView === "translate" && (
            <Suspense fallback={<p className="ob-page small muted">{t("Loading…")}</p>}>
              <TranslationEditor />
            </Suspense>
          )}
          {currentView === "rerouter" && (
            <LegacyDark>
              <BannerRerouterPage />
            </LegacyDark>
          )}
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
