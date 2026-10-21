import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, LocationCity, MyLocation, NearMe, Place, Public } from "@mui/icons-material";
import BannerWall from "./BannerWall";
import AboutNotice from "./AboutNotice";
import { loadCachedNearbyLocation, saveCachedNearbyLocation } from "./BannersNearMe";
import { fetchBannergress, useBannergressSync } from "../bannergressSync";
import { withoutHiddenBanners } from "../bannerFilters";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import {
  getPlaceHierarchy,
  getPlaceLongName,
  readCachedCity,
  resolveCityAt,
} from "../cityPlace";
import { getFlagForPlace } from "./CountryFlags";

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
          {kind}
          {Number.isFinite(place.numberOfBanners) ? ` · ${place.numberOfBanners} banners` : ""}
        </span>
      </span>
      <ChevronRight className="start-go" />
    </Link>
  );
}

// Banners tab start ("/"): the 3 nearest banners, then big buttons at thumb
// height: more near you, and your country / province / city.
export default function BannersStartPage() {
  const navigate = useNavigate();
  const syncState = useBannergressSync();
  const [permission, setPermission] = useState("checking");
  const [location, setLocation] = useState(() => loadCachedNearbyLocation());
  const [locating, setLocating] = useState(false);
  const [banners, setBanners] = useState(null);
  const [bannerError, setBannerError] = useState("");
  const [hierarchy, setHierarchy] = useState(null);
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

      if (state === "granted" && !location) {
        locate();
      } else if (state !== "granted" && !location && !savedCity?.id) {
        // Nothing to go on: show all countries, as before.
        navigate("/browse/", { replace: true });
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
          setBannerError("Couldn't load banners near you.");
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
  const canAskLocation = permission !== "denied" && permission !== "unsupported";
  const placeButtons = hierarchy
    ? [
        hierarchy.country && { place: hierarchy.country, icon: Public, kind: "Country" },
        hierarchy.region && { place: hierarchy.region, icon: Place, kind: "Province" },
        hierarchy.city && { place: hierarchy.city, icon: LocationCity, kind: "City" },
      ].filter(Boolean)
    : null;

  return (
    <div className="ob-page start-page">
      <header>
        <h1 className="ob-h1">{hasLocation ? "Near you" : "Banners"}</h1>
        <p className="small muted">
          {hasLocation
            ? "The closest start points."
            : savedCity
              ? `Around ${getPlaceLongName(savedCity)}, your last city.`
              : "Finding your location…"}
        </p>
      </header>

      {hasLocation ? (
        top === null ? (
          <BannerWall banners={[]} skeletonCount={3} label="Loading banners near you" />
        ) : top.length > 0 ? (
          <BannerWall banners={top} here={location} label="Banners near you" />
        ) : (
          <div className="ob-alert">{bannerError || "No banners found near you."}</div>
        )
      ) : null}

      <nav className="start-acts" aria-label="Where to look">
        {hasLocation ? (
          <Link className="start-btn primary sl" to="/near">
            <span className="start-ic" aria-hidden="true">
              <NearMe />
            </span>
            <span className="grow">
              <b>More banners near you</b>
              <span className="small">Closest first, with filters</span>
            </span>
            <ChevronRight className="start-go" />
          </Link>
        ) : canAskLocation ? (
          <button type="button" className="start-btn primary sl" onClick={locate} disabled={locating}>
            <span className="start-ic" aria-hidden="true">
              <MyLocation />
            </span>
            <span className="grow">
              <b>{locating ? "Finding you…" : "Use my location"}</b>
              <span className="small">Show the banners closest to you</span>
            </span>
          </button>
        ) : null}

        {placeButtons === null
          ? Array.from({ length: 3 }).map((_, index) => (
              <span key={index} className="start-btn sk" aria-hidden="true" />
            ))
          : placeButtons.map((entry) => (
              <PlaceButton key={entry.place.id} {...entry} />
            ))}

        <Link
          className="start-all sl"
          to="/browse/"
          onClick={() => resetBrowseState(getBrowseStateScope())}
        >
          All countries
        </Link>
      </nav>

      <AboutNotice />
    </div>
  );
}
