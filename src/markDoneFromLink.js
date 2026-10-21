import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BANNERGRESS_AUTH_REQUEST_EVENT,
  isBannergressAuthSupportedOrigin,
  requestBannergressAccessToken,
  updateBannergressBannerListType,
  useBannergressAuth,
} from "./bannergressSync";

// /banner/{id}?markDone=1 marks the banner as done on Bannergress. The
// OpenBanners Overlay app opens it from "Close and mark as done".
export const MARK_DONE_PARAM = "markDone";
// Survives the Bannergress sign-in (and a reload of the tab while it's open).
export const MARK_DONE_PENDING_STORAGE_KEY = "openbanners:mark-done-pending";
export const MARK_DONE_PENDING_MAX_AGE_MS = 30 * 60 * 1000;

export function isMarkDoneRequested(search) {
  const value = new URLSearchParams(search ?? "").get(MARK_DONE_PARAM);
  return value === "1" || value === "true";
}

// The search string without the markDone parameter ("" when nothing is left).
export function stripMarkDoneParam(search) {
  const params = new URLSearchParams(search ?? "");
  params.delete(MARK_DONE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

export function savePendingMarkDone(bannerId, now = Date.now()) {
  try {
    window.sessionStorage.setItem(
      MARK_DONE_PENDING_STORAGE_KEY,
      JSON.stringify({ bannerId, createdAt: now })
    );
  } catch {
    // Storage blocked: it still runs once on this page.
  }
}

export function hasPendingMarkDone(bannerId, now = Date.now()) {
  try {
    const pending = JSON.parse(
      window.sessionStorage.getItem(MARK_DONE_PENDING_STORAGE_KEY) ?? "null"
    );
    return (
      Boolean(bannerId) &&
      pending?.bannerId === bannerId &&
      Number.isFinite(pending?.createdAt) &&
      now - pending.createdAt <= MARK_DONE_PENDING_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

export function clearPendingMarkDone() {
  try {
    window.sessionStorage.removeItem(MARK_DONE_PENDING_STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}

function isAuthError(error) {
  return (
    error?.code === "AUTH_REQUIRED" ||
    error?.status === 401 ||
    error?.status === 403
  );
}

// Runs a pending "mark as done" for the banner on this page.
// status: idle | working | needs-auth | done | error | unavailable
export function useMarkDoneFromLink(bannerId) {
  const location = useLocation();
  const navigate = useNavigate();
  const authState = useBannergressAuth();
  const [status, setStatus] = useState("idle");
  const [pending, setPending] = useState(() => hasPendingMarkDone(bannerId));
  const runningRef = useRef(false);

  // Take the parameter off the URL straight away, so a reload or going back
  // doesn't mark it again; the pending action lives in sessionStorage.
  useEffect(() => {
    if (!bannerId) {
      return;
    }

    if (new URLSearchParams(location.search).has(MARK_DONE_PARAM)) {
      if (isMarkDoneRequested(location.search)) {
        savePendingMarkDone(bannerId);
      }

      navigate(
        {
          pathname: location.pathname,
          search: stripMarkDoneParam(location.search),
          hash: location.hash,
        },
        { replace: true, state: location.state }
      );
    }

    setPending(hasPendingMarkDone(bannerId));
  }, [bannerId, location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async () => {
    if (!bannerId || runningRef.current) {
      return;
    }

    if (!isBannergressAuthSupportedOrigin()) {
      clearPendingMarkDone();
      setPending(false);
      setStatus("unavailable");
      return;
    }

    runningRef.current = true;
    setStatus("working");

    try {
      const token = await requestBannergressAccessToken();

      if (!token) {
        setStatus("needs-auth");
        return;
      }

      await updateBannergressBannerListType(bannerId, "done");
      clearPendingMarkDone();
      setPending(false);
      setStatus("done");
    } catch (error) {
      if (isAuthError(error)) {
        setStatus("needs-auth");
      } else {
        console.error("Couldn't mark the banner as done.", error);
        setStatus("error");
      }
    } finally {
      runningRef.current = false;
    }
  }, [bannerId]);

  // Start, and try again once a sign-in has stored new tokens.
  useEffect(() => {
    if (pending && (status === "idle" || status === "needs-auth")) {
      void run();
    }
  }, [pending, authState]); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback(() => {
    // From a click, so the Bannergress sign-in popup isn't blocked.
    window.dispatchEvent(new CustomEvent(BANNERGRESS_AUTH_REQUEST_EVENT));
  }, []);

  const cancel = useCallback(() => {
    clearPendingMarkDone();
    setPending(false);
    setStatus("idle");
  }, []);

  const dismiss = useCallback(() => setStatus("idle"), []);

  return { status, signIn, retry: run, cancel, dismiss };
}
