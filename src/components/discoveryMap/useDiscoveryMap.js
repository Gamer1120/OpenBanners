import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBannergressSync } from "../../bannergressSync";
import { getVisibleAreaFromBounds, useDiscoveryMapBanners } from "../../discoveryMapData";
import { readDiscoveryMapState, saveDiscoveryMapViewport } from "../../discoveryMapState";
import { withStatus } from "./mapStatus";

export const DEFAULT_CENTER = [52.221058, 6.893297];
export const DEFAULT_ZOOM = 15;
const LOAD_FILTERS = Object.freeze({ showOfflineBanners: false, showHiddenBanners: false });

// Discovery-map state: viewport (remembered across visits), user
// location, and the Bannergress banners for the searched area with their list status.
// Banners reload (debounced) for every new view.
export default function useDiscoveryMap() {
  const [initialState] = useState(readDiscoveryMapState);
  const restoredViewport = initialState.viewport;
  const [map, setMap] = useState(null);
  const [liveArea, setLiveArea] = useState(null);
  const [searchArea, setSearchArea] = useState(null);
  const [zoom, setZoom] = useState(restoredViewport?.zoom ?? DEFAULT_ZOOM);
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const syncState = useBannergressSync();
  const centeredRef = useRef(Boolean(restoredViewport));
  const { banners: loadedBanners, loading, error } = useDiscoveryMapBanners(
    searchArea,
    userLocation,
    LOAD_FILTERS
  );
  const banners = useMemo(() => withStatus(loadedBanners, syncState), [loadedBanners, syncState]);

  const handleViewportChange = useCallback(
    (mapInstance) => {
      if (!mapInstance) {
        return;
      }

      setMap(mapInstance);
      const nextArea = getVisibleAreaFromBounds(mapInstance.getBounds());
      const center = mapInstance.getCenter();
      setZoom(mapInstance.getZoom());
      setLiveArea(nextArea);
      saveDiscoveryMapViewport({
        center: { latitude: center.lat, longitude: center.lng },
        zoom: mapInstance.getZoom(),
      });
      setSearchArea(nextArea);
    },
    []
  );

  const flyToUser = useCallback(
    (location, mapInstance = map) => {
      if (!mapInstance || !location) {
        return;
      }

      mapInstance.setView([location.latitude, location.longitude], Math.max(mapInstance.getZoom(), 14));
    },
    [map]
  );

  const requestLocation = useCallback(
    ({ recenter = false } = {}) => {
      if (!("geolocation" in navigator)) {
        return;
      }

      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          setLocating(false);
          setUserLocation(next);

          if (recenter) {
            centeredRef.current = true;
            flyToUser(next);
          }
        },
        () => setLocating(false),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    },
    [flyToUser]
  );

  // Use the location silently when permission was already given.
  useEffect(() => {
    let ignore = false;

    navigator.permissions
      ?.query?.({ name: "geolocation" })
      .then((result) => {
        if (!ignore && result.state === "granted") {
          requestLocation();
        }
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (userLocation && map && !centeredRef.current) {
      centeredRef.current = true;
      flyToUser(userLocation, map);
    }
  }, [flyToUser, map, userLocation]);

  return {
    map,
    initialCenter: restoredViewport
      ? [restoredViewport.center.latitude, restoredViewport.center.longitude]
      : DEFAULT_CENTER,
    initialZoom: restoredViewport?.zoom ?? DEFAULT_ZOOM,
    zoom,
    liveArea,
    searchArea,
    banners,
    loading,
    error,
    syncState,
    userLocation,
    locating,
    requestLocation,
    handleViewportChange,
  };
}
