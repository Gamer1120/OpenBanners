import { useCallback, useEffect, useState } from "react";
import { requestBannergressAccessToken, useBannergressAuth } from "./bannergressSync";

// Client for server/passphrases.mjs. The Bannergress token goes along only so
// the server can ask Bannergress who you are; it never stores it.
export const PASSPHRASES_BASE = "/_openbanners/passphrases/v1";

async function call(path, { method = "GET", body, authenticate = true } = {}) {
  const token = authenticate ? await requestBannergressAccessToken().catch(() => null) : null;
  const headers = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${PASSPHRASES_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw Object.assign(new Error(result?.message || "Couldn't reach the passphrase service."), {
      code: result?.error,
      status: response.status,
    });
  }
  return result;
}

const bannerPath = (bannerId) => `/banners/${encodeURIComponent(bannerId)}`;

export const getPassphrases = (bannerId) => call(bannerPath(bannerId));
export const submitPassphrases = (bannerId, answers) =>
  call(`${bannerPath(bannerId)}/answers`, { method: "POST", body: { answers } });
export const voteOnPassphrase = (answerId, vote) =>
  call(`/answers/${answerId}/vote`, { method: "POST", body: { vote } });
export const authorPassphraseAction = (bannerId, action) =>
  call(`${bannerPath(bannerId)}/author`, { method: "POST", body: action });
export const getMyPassphraseNotices = () => call("/me");

export const stepKey = (missionId, stepIndex) => `${missionId}:${stepIndex}`;

// Answers per waypoint ("missionId:stepIndex" -> answers, best first), plus the
// viewer's role. Loads only when `enabled` (the banner has passphrase steps).
export function useBannerPassphrases(bannerId, enabled) {
  const auth = useBannergressAuth();
  const loggedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const [state, setState] = useState({ status: "idle", data: null, error: "" });

  const apply = useCallback((data) => setState({ status: "ready", data, error: "" }), []);

  useEffect(() => {
    if (!enabled || !bannerId) {
      setState({ status: "idle", data: null, error: "" });
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading" }));
    getPassphrases(bannerId).then(
      (data) => !cancelled && setState({ status: "ready", data, error: "" }),
      (error) => !cancelled && setState({ status: "error", data: null, error: error.message })
    );
    return () => {
      cancelled = true;
    };
  }, [bannerId, enabled, loggedIn]);

  const byStep = new Map();
  for (const answer of state.data?.answers ?? []) {
    const key = stepKey(answer.missionId, answer.stepIndex);
    byStep.set(key, [...(byStep.get(key) ?? []), answer]);
  }

  return {
    ...state,
    loggedIn,
    byStep,
    blocked: state.data?.blocked ?? null,
    viewer: state.data?.viewer ?? null,
    isAuthor: Boolean(state.data?.viewer?.isAuthor),
    pendingDays: state.data?.pendingDays ?? 30,
    apply,
  };
}
