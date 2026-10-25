import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Language,
  LocationCity,
  MyLocation,
  NearMe,
  Place,
  Public,
} from "@mui/icons-material";
import BannerWall from "./BannerWall";
import AboutNotice from "./AboutNotice";
import { loadCachedNearbyLocation, saveCachedNearbyLocation } from "./BannersNearMe";
import { fetchBannergress, useBannergressSync } from "../bannergressSync";
import { useRememberEntry, useRestoredEntry } from "../scrollRestoration";
import { withoutHiddenBanners } from "../bannerFilters";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import {
  getPlaceHierarchy,
  getPlaceLongName,
  readCachedCity,
  resolveCityAt,
} from "../cityPlace";
import { getFlagForPlace } from "./CountryFlags";
import { t, tk, tn } from "../i18n";

const TOP_COUNT = 3;
const LOCATION_OPTIONS = { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 8000 };

function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      reject,
      LOCATION_OPTIONS
    );
  });
}

async function getLocationPermission() {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return "unsupported";
  }

  try {
    return (await navigator.permissions?.query?.({ name: "geolocation" }))?.state ?? "prompt";
  } catch {
    return "prompt";
  }
}

function PlaceButton({ place, icon: Icon, kind }) {
  const flag = kind === "Country" ? getFlagForPlace(place.formattedAddress) : "";

  return (
    <Link
      className="start-btn sl"
      to={`/browse/${encodeURIComponent(place.id)}`}
      onClick={() => resetBrowseState(getBrowseStateScope({ placeId: place.id }))}
    >
      <span className="start-ic" aria-hidden="true">
        {flag ? <span className="flag">{flag}</span> : <Icon />}
      </span>
      <span className="grow">
        <b>{getPlaceLongName(place)}</b>
        <span className="small">
          {t(kind)}
          {Number.isFinite(place.numberOfBanners)
            ? ` · ${tn("{count} banner", "{count} banners", place.numberOfBanners)}`
            : ""}
        </span>
      </span>
      <ChevronRight className="start-go" />
    </Link>
  );
}

// Banners tab start ("/"): the 3 nearest banners, then big buttons at thumb
// height: more near you, all countries, and your country / province / city.
export default function BannersStartPage() {
  const syncState = useBannergressSync();
  const [permission, setPermission] = useState("checking");
  // Back to this page shows the same banners right away (no refetch).
  const { entryKey, restored } = useRestoredEntry("start");
  const restoredRef = useRef(restored);
  const [location, setLocation] = useState(
    () => restored?.location ?? loadCachedNearbyLocation()
  );
  const [locating, setLocating] = useState(false);
  const [banners, setBanners] = useState(restored?.banners ?? null);
  const [bannerError, setBannerError] = useState("");
  const [hierarchy, setHierarchy] = useState(restored?.hierarchy ?? null);
  const savedCity = useMemo(() => readCachedCity()?.place ?? null, []);

  const locate = () => {
    setLocating(true);
    getPosition()
      .then((nextLocation) => {
        saveCachedNearbyLocation(nextLocation);
        setLocation(nextLocation);
        setPermission("granted");
      })
      .catch(() => setPermission((current) => (current === "granted" ? "error" : "denied")))
      .finally(() => setLocating(false));
  };

  useEffect(() => {
    let ignore = false;

    getLocationPermission().then((state) => {
      if (ignore) {
        return;
      }

      setPermission(state);

      // Without location the start page stays: it offers "Use my location"
      // and All countries instead of redirecting to /browse/.
      if (state === "granted" && !location) {
        locate();
      }
    });

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nearest banners + the place hierarchy of where you are.
  useEffect(() => {
    if (!location) {
      return undefined;
    }

    const restoredStart = restoredRef.current;
    restoredRef.current = null;

    if (restoredStart?.location === location && restoredStart.banners) {
      return undefined;
    }

    let ignore = false;
    setBanners(null);
    setBannerError("");

    fetchBannergress(
      `https://api.bannergress.com/bnrs?orderBy=proximityStartPoint&orderDirection=ASC&online=true&proximityLatitude=${location.latitude}&proximityLongitude=${location.longitude}&limit=12&offset=0`
    )
      .then((response) => response.json())
      .then(async (data) => {
        const list = Array.isArray(data) ? data : [];

        if (!ignore) {
          setBanners(list);
        }

        const city = await resolveCityAt(location, list, { ignorePicked: true });

        if (city?.id) {
          const places = await getPlaceHierarchy(city.id);

          if (!ignore) {
            setHierarchy(places);
          }
        } else if (!ignore) {
          setHierarchy({ country: null, region: null, city: null });
        }
      })
      .catch(() => {
        if (!ignore) {
          setBanners((current) => current ?? []);
          setBannerError(t("Couldn't load banners near you."));
          setHierarchy((current) => current ?? { country: null, region: null, city: null });
        }
      });

    return () => {
      ignore = true;
    };
  }, [location]);

  // Without location: the saved city's hierarchy.
  useEffect(() => {
    if (location || !savedCity?.id) {
      return undefined;
    }

    let ignore = false;
    getPlaceHierarchy(savedCity.id)
      .then((places) => !ignore && setHierarchy(places))
      .catch(() => !ignore && setHierarchy({ country: null, region: null, city: savedCity }));

    return () => {
      ignore = true;
    };
  }, [location, savedCity]);

  const top = useMemo(
    () => (banners ? withoutHiddenBanners(banners, syncState).slice(0, TOP_COUNT) : null),
    [banners, syncState]
  );
  const hasLocation = Boolean(location);

  useRememberEntry(
    entryKey,
    "start",
    location && banners && hierarchy && !bannerError
      ? { location, banners, hierarchy }
      : null
  );
  const canAskLocation = permission !== "denied" && permission !== "unsupported";
  const placeButtons = hierarchy
    ? [
        hierarchy.country && { place: hierarchy.country, icon: Public, kind: tk("Country") },
        hierarchy.region && { place: hierarchy.region, icon: Place, kind: tk("Province") },
        hierarchy.city && { place: hierarchy.city, icon: LocationCity, kind: tk("City") },
      ].filter(Boolean)
    : null;

  return (
    <div className="ob-page start-page">
      <header>
        <h1 className="ob-h1">{hasLocation ? t("Near you") : t("Banners")}</h1>
        <p className="small muted">
          {hasLocation
            ? t("The closest start points.")
            : savedCity
              ? t("Around {city}, your last city.", { city: getPlaceLongName(savedCity) })
              : locating || permission === "checking" || permission === "granted"
                ? t("Finding your location…")
                : t("Share your location to see the banners closest to you.")}
        </p>
      </header>

      {hasLocation ? (
        top === null ? (
          <BannerWall banners={[]} skeletonCount={3} label={t("Loading banners near you")} />
        ) : top.length > 0 ? (
          <BannerWall banners={top} here={location} label={t("Banners near you")} />
        ) : (
          <div className="ob-alert">{bannerError || t("No banners found near you.")}</div>
        )
      ) : null}

      <nav className="start-acts" aria-label={t("Where to look")}>
        {hasLocation ? (
          <Link className="start-btn primary sl" to="/near">
            <span className="start-ic" aria-hidden="true">
              <NearMe />
            </span>
            <span className="grow">
              <b>{t("More banners near you")}</b>
              <span className="small">{t("Closest first, with filters")}</span>
            </span>
            <ChevronRight className="start-go" />
          </Link>
        ) : canAskLocation ? (
          <button type="button" className="start-btn primary sl" onClick={locate} disabled={locating}>
            <span className="start-ic" aria-hidden="true">
              <MyLocation />
            </span>
            <span className="grow">
              <b>{locating ? t("Finding you…") : t("Use my location")}</b>
              <span className="small">{t("Show the banners closest to you")}</span>
            </span>
          </button>
        ) : null}

        <Link
          className="start-btn sl"
          to="/browse/"
          onClick={() => resetBrowseState(getBrowseStateScope())}
        >
          <span className="start-ic" aria-hidden="true">
            <Language />
          </span>
          <span className="grow">
            <b>{t("All countries")}</b>
            <span className="small">{t("Every banner, by country")}</span>
          </span>
          <ChevronRight className="start-go" />
        </Link>

        {placeButtons === null && !hasLocation && !savedCity && !locating && permission !== "granted"
          ? null
          : placeButtons === null
          ? Array.from({ length: 3 }).map((_, index) => (
              <span key={index} className="start-btn sk" aria-hidden="true" />
            ))
          : placeButtons.map((entry) => (
              <PlaceButton key={entry.place.id} {...entry} />
            ))}

      </nav>

      <AboutNotice />
    </div>
  );
}
