import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { NearMe } from "@mui/icons-material";
import { savePickedCity } from "../cityPlace";
import AboutNotice from "./AboutNotice";
import BrowseBannerList from "./BrowseBannerList";
import PlaceCloud, { getChipName, usePlaces } from "./PlaceCloud";
import { getFlagForPlace } from "./CountryFlags";
import { DEFAULT_BANNER_FILTERS } from "../bannerFilters";
import { getLanguage, t, tn } from "../i18n";

function useCurrentPlace(placeId) {
  const [currentPlace, setCurrentPlace] = useState(null);

  useEffect(() => {
    if (!placeId) {
      setCurrentPlace(null);
      return undefined;
    }

    let ignore = false;
    setCurrentPlace(null);

    fetch(`https://api.bannergress.com/places/${encodeURIComponent(placeId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!ignore) {
          setCurrentPlace(data && typeof data === "object" && data.id ? data : null);
        }
      })
      .catch((fetchError) => {
        console.error(fetchError);

        if (!ignore) {
          setCurrentPlace(null);
        }
      });

    return () => {
      ignore = true;
    };
  }, [placeId]);

  return currentPlace;
}

function getPlaceTrail(place) {
  const trail = [];
  let current = place?.parentPlace;

  while (current && trail.length < 8) {
    trail.unshift(current);
    current = current.parentPlace;
  }

  return trail;
}

export default function BrowsingPage({
  placeId,
  authorName,
  bannerFilters = DEFAULT_BANNER_FILTERS,
  onBannerFiltersChange,
}) {
  const currentPlace = useCurrentPlace(placeId);
  const placesState = usePlaces(placeId, !authorName);
  const placeTrail = useMemo(() => getPlaceTrail(currentPlace), [currentPlace]);

  // A city you browse to becomes the Banners tab's start page when location is off.
  useEffect(() => {
    if (currentPlace?.id && currentPlace.type === "locality") {
      savePickedCity(currentPlace);
    }
  }, [currentPlace]);

  const isAgentView = Boolean(authorName);
  const canUseLocation = typeof navigator !== "undefined" && "geolocation" in navigator;
  const placeName = currentPlace
    ? getChipName(currentPlace, currentPlace.type === "country")
    : "";
  const headerTitle = isAgentView
    ? authorName
    : placeId
      ? placeName || t("Loading…")
      : t("All countries");
  const headerDescription = isAgentView
    ? t("Banners created by {agent}.", { agent: authorName })
    : placeId
      ? currentPlace && Number.isFinite(currentPlace.numberOfBanners)
        ? `${tn("{count} banner", "{count} banners", currentPlace.numberOfBanners, {
            count: currentPlace.numberOfBanners.toLocaleString(getLanguage()),
          })}${
            currentPlace.formattedAddress && currentPlace.formattedAddress !== placeName
              ? ` · ${currentPlace.formattedAddress}`
              : ""
          }`
        : ""
      : placesState.loading
        ? ""
        : tn("{banners} banners in {count} country", "{banners} banners in {count} countries", placesState.places.length, {
            banners: placesState.places
              .reduce((total, place) => total + (Number(place.numberOfBanners) || 0), 0)
              .toLocaleString(getLanguage()),
          });
  const cloudHeading = !placeId
    ? t("Countries")
    : currentPlace?.type === "country"
      ? t("Regions and cities")
      : t("Places");

  return (
    <div className="ob-page">
      <header className="ob-sec-head" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          {!isAgentView ? (
            <nav className="crumbs scope" aria-label={t("Scope")}>
              {canUseLocation ? (
                <>
                  <Link className="scope-near" to="/near">
                    <NearMe fontSize="inherit" />
                    {t("Near you")}
                  </Link>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              {placeId ? (
                <Link to="/browse/">{t("All countries")}</Link>
              ) : (
                <span aria-current="page">{t("All countries")}</span>
              )}
              {placeTrail
                .filter(
                  (place) =>
                    !currentPlace ||
                    getChipName(place, false) !== getChipName(currentPlace, false)
                )
                .map((place) => (
                <React.Fragment key={place.id}>
                  <span aria-hidden="true">›</span>
                  <Link to={`/browse/${encodeURIComponent(place.id)}`}>
                    {getChipName(place, place.type === "country")}
                  </Link>
                </React.Fragment>
              ))}
              {placeId && currentPlace ? (
                <>
                  <span aria-hidden="true">›</span>
                  <span aria-current="page">
                    {getChipName(currentPlace, currentPlace.type === "country")}
                  </span>
                </>
              ) : null}
            </nav>
          ) : null}
          <h1 className="ob-h1">
            {currentPlace?.type === "country" && getFlagForPlace(currentPlace.formattedAddress) ? (
              <span aria-hidden="true">{getFlagForPlace(currentPlace.formattedAddress)} </span>
            ) : null}
            {headerTitle}
          </h1>
          {headerDescription ? <p className="small muted">{headerDescription}</p> : null}
        </div>
      </header>

      {isAgentView ? null : (
        <PlaceCloud
          places={placesState.places}
          loading={placesState.loading}
          error={placesState.error}
          isCountryList={!placeId}
          heading={cloudHeading}
          rows={placeId && currentPlace && currentPlace.type !== "country" ? 3 : 5}
        />
      )}

      <BrowseBannerList
        placeId={placeId}
        authorName={authorName}
        bannerFilters={bannerFilters}
        onBannerFiltersChange={onBannerFiltersChange}
      />

      <AboutNotice />

    </div>
  );
}
