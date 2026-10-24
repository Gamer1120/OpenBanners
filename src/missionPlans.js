import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "./passphraseApi";
import { BANNERGRESS_ORIGIN } from "./bannerDisplay";

// Mission Day plans (server/passphrases.mjs /plans): pick missions from one or
// more banners and put them in your own order. Anyone with the link edits it.
export const planPath = (planId) => `/planner/${encodeURIComponent(planId)}`;
export const planUrl = (planId) => `${window.location.origin}${planPath(planId)}`;

export const createPlan = ({ banners, title }) => call("/plans", { method: "POST", body: { banners, title } });
export const getPlan = (planId) => call(`/plans/${encodeURIComponent(planId)}`, { authenticate: false });
export const editPlan = (planId, ops) =>
  call(`/plans/${encodeURIComponent(planId)}`, { method: "POST", body: { ops }, authenticate: false });

// Plans you made or opened, newest first (this browser only).
const RECENT_KEY = "openbanners-recent-plans";
const MAX_RECENT = 20;

export function readRecentPlans() {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberPlan(plan) {
  const entry = { id: plan.id, title: plan.title, missions: plan.items?.length ?? 0, readOnly: Boolean(plan.readOnly), openedAt: Date.now() };
  const next = [entry, ...readRecentPlans().filter((other) => other.id !== plan.id)].slice(0, MAX_RECENT);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export function forgetPlan(planId) {
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(readRecentPlans().filter((entry) => entry.id !== planId)));
}

// Active Mission Days, as on the Bannergress home page: banners whose event is
// on now, newest first.
export async function fetchActiveMissionDays() {
  const nowIso = new Date().toISOString();
  const url = new URL(`${BANNERGRESS_ORIGIN}/bnrs`);
  url.searchParams.set("minEventTimestamp", nowIso);
  url.searchParams.set("maxEventTimestamp", nowIso);
  url.searchParams.set("orderBy", "created");
  url.searchParams.set("orderDirection", "DESC");
  url.searchParams.set("online", "true");
  url.searchParams.set("limit", "50");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Bannergress didn't answer.");
  }
  return response.json();
}

export async function searchBanners(query) {
  const url = new URL(`${BANNERGRESS_ORIGIN}/bnrs`);
  const trimmed = query.trim();
  url.searchParams.set("query", trimmed.endsWith("*") ? trimmed : `${trimmed}*`);
  url.searchParams.set("orderBy", "relevance");
  url.searchParams.set("orderDirection", "DESC");
  url.searchParams.set("limit", "20");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Bannergress didn't answer.");
  }
  return response.json();
}

// Full banners (with missions and steps), cached for the session.
const bannerCache = new Map();
export function fetchBannerWithMissions(bannerId) {
  if (!bannerCache.has(bannerId)) {
    const request = fetch(`${BANNERGRESS_ORIGIN}/bnrs/${encodeURIComponent(bannerId)}`).then((response) => {
      if (!response.ok) {
        throw new Error("Couldn't load this banner from Bannergress.");
      }
      return response.json();
    });
    request.catch(() => bannerCache.delete(bannerId));
    bannerCache.set(bannerId, request);
  }
  return bannerCache.get(bannerId);
}

// The part of the titles all missions share ("MD 2026: Paris, "), cut at a word break.
export function sharedTitlePrefix(titles) {
  if (titles.length < 2) {
    return "";
  }
  let prefix = titles[0];
  for (const title of titles) {
    while (!title.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  // Prefer punctuation, so "Pont de Sully" / "Pont Neuf" keep their shared "Pont".
  const punctuation = Math.max(...[":", ",", "|", " - ", "–", "—"].map((mark) => prefix.lastIndexOf(mark)));
  const cut = punctuation !== -1 ? punctuation : prefix.lastIndexOf(" ");
  return cut === -1 ? "" : prefix.slice(0, cut + 1);
}

// Missions of a banner in banner order, with their number and first/last portal.
// shortTitle leaves out what every mission title of the banner starts with.
export function missionsOf(banner) {
  const missions = Object.entries(banner?.missions ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, mission], index) => {
      const pois = Object.values(mission?.steps ?? {})
        .map((step) => step?.poi)
        .filter((poi) => Number.isFinite(poi?.latitude) && Number.isFinite(poi?.longitude));
      return {
        id: mission?.id,
        number: index + 1,
        title: mission?.title || `Mission ${index + 1}`,
        picture: mission?.picture || "",
        steps: Object.keys(mission?.steps ?? {}).length,
        lengthMeters: mission?.lengthMeters ?? null,
        offline: mission?.status && mission.status !== "published",
        path: pois.map((poi) => [poi.latitude, poi.longitude]),
        start: pois[0] ?? null,
        end: pois[pois.length - 1] ?? null,
      };
    })
    .filter((mission) => mission.id);
  const prefix = sharedTitlePrefix(missions.map((mission) => mission.title));
  return missions.map((mission) => ({
    ...mission,
    shortTitle: mission.title.slice(prefix.length).replace(/^[\s:,|–—-]+/, "") || mission.title,
  }));
}

// The server's plan changes, applied locally so the screen follows at once.
export function applyOps(plan, ops) {
  let { title, banners, items } = plan;
  banners = [...banners];
  items = [...items];
  const at = (missionId) => items.findIndex((item) => item.missionId === missionId);
  const clamp = (index, length) => (Number.isInteger(index) ? Math.max(0, Math.min(index, length)) : length);
  for (const change of ops) {
    if (change.op === "title") {
      title = change.title.trim() || title;
    } else if (change.op === "addBanner" && !banners.includes(change.bannerId)) {
      banners.push(change.bannerId);
    } else if (change.op === "removeBanner") {
      banners = banners.filter((id) => id !== change.bannerId);
      items = items.filter((item) => item.bannerId !== change.bannerId);
    } else if (change.op === "add" && at(change.missionId) === -1) {
      if (!banners.includes(change.bannerId)) {
        banners.push(change.bannerId);
      }
      items.splice(clamp(change.index, items.length), 0, { bannerId: change.bannerId, missionId: change.missionId, done: false });
    } else if (change.op === "remove" && at(change.missionId) !== -1) {
      items.splice(at(change.missionId), 1);
    } else if (change.op === "move" && at(change.missionId) !== -1) {
      const [item] = items.splice(at(change.missionId), 1);
      items.splice(clamp(change.index, items.length), 0, item);
    } else if (change.op === "done" && at(change.missionId) !== -1) {
      items[at(change.missionId)] = { ...items[at(change.missionId)], done: Boolean(change.done) };
    }
  }
  return { ...plan, title, banners, items };
}

const POLL_MS = 10 * 1000;

// { status, plan, error, apply(ops) } — follows other people's edits every 10 s.
export function usePlan(planId) {
  const [state, setState] = useState({ status: "loading", plan: null, error: "" });
  const versionRef = useRef(0);

  const accept = useCallback((plan) => {
    if (plan.version >= versionRef.current) {
      versionRef.current = plan.version;
      setState({ status: "ready", plan, error: "" });
      rememberPlan(plan);
    }
  }, []);

  useEffect(() => {
    versionRef.current = 0;
    setState({ status: "loading", plan: null, error: "" });
    let cancelled = false;
    const load = () =>
      getPlan(planId).then(
        (plan) => !cancelled && accept(plan),
        (error) => {
          if (!cancelled && !versionRef.current) {
            setState({ status: "error", plan: null, error: error.message });
          }
        }
      );
    load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [planId, accept]);

  // Shown at once; the server's answer (with everyone's changes) replaces it.
  const apply = useCallback(
    (ops) => {
      setState((current) => (current.plan ? { ...current, plan: applyOps(current.plan, ops) } : current));
      return editPlan(planId, ops).then(accept, (error) => {
        getPlan(planId).then((plan) => {
          versionRef.current = 0;
          accept(plan);
        });
        throw error;
      });
    },
    [planId, accept]
  );
  return { ...state, apply };
}
