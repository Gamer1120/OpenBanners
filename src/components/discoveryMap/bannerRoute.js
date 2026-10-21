import { useEffect, useState } from "react";
import { fetchBannergress } from "../../bannergressSync";
import { getFinish, getStepPosition, getSteps, isOnStartMarker } from "../BannerDetailsPage";

const routeCache = new globalThis.Map();

// Mission-by-mission positions of a banner's walking route, in mission order.
export function buildBannerRoute(details) {
  const missions = Object.values(details?.missions ?? {});
  const missionPositions = missions.map((mission) =>
    getSteps(mission)
      .filter((step) => step?.poi?.type !== "unavailable")
      .map(getStepPosition)
      .filter(Boolean)
  );
  const finish = getFinish(missions);

  return {
    missionPositions,
    allPositions: missionPositions.flat(),
    finish,
    finishShifted: finish ? isOnStartMarker(finish.position, missionPositions) : false,
  };
}

export async function loadBannerRoute(bannerId) {
  if (!routeCache.has(bannerId)) {
    const request = fetchBannergress(`https://api.bannergress.com/bnrs/${bannerId}`)
      .then((response) => response.json())
      .then((details) => {
        if (!details?.id) {
          throw new Error("Unexpected banner response");
        }

        return { details, route: buildBannerRoute(details) };
      });
    routeCache.set(bannerId, request);
    request.catch(() => routeCache.delete(bannerId));
  }

  return routeCache.get(bannerId);
}

export function useBannerRoute(bannerId) {
  const [state, setState] = useState({ status: "idle", data: null });

  useEffect(() => {
    if (!bannerId) {
      setState({ status: "idle", data: null });
      return undefined;
    }

    let ignore = false;
    setState({ status: "loading", data: null });
    loadBannerRoute(bannerId)
      .then((data) => !ignore && setState({ status: "ready", data }))
      .catch(() => !ignore && setState({ status: "error", data: null }));

    return () => {
      ignore = true;
    };
  }, [bannerId]);

  return state;
}
