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

// The route of bannerId; answers for a banner that is no longer asked for are
// ignored, and an earlier banner's state is never returned for a new one.
export function useBannerRoute(bannerId) {
  const [state, setState] = useState({ id: null, status: "idle", data: null });

  useEffect(() => {
    if (!bannerId) {
      setState({ id: null, status: "idle", data: null });
      return undefined;
    }

    let ignore = false;
    setState({ id: bannerId, status: "loading", data: null });
    loadBannerRoute(bannerId)
      .then((data) => !ignore && setState({ id: bannerId, status: "ready", data }))
      .catch(() => !ignore && setState({ id: bannerId, status: "error", data: null }));

    return () => {
      ignore = true;
    };
  }, [bannerId]);

  if (state.id !== bannerId) {
    return { status: bannerId ? "loading" : "idle", data: null };
  }

  return { status: state.status, data: state.data };
}
