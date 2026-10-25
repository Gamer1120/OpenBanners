import React, { useCallback, useEffect, useRef, useState } from "react";
import { Login } from "@mui/icons-material";
import { useLocation, useNavigate } from "react-router-dom";
import BannerTogetherLauncher from "./BannerTogetherLauncher";
import BannerWall, { BannerRows, useInfiniteScroll } from "./BannerWall";
import { useRememberEntry, useRestoredEntry } from "../scrollRestoration";
import ViewModeToggle, { useBannerViewMode } from "./ViewModeToggle";
import {
  BANNERGRESS_AUTH_REQUEST_EVENT,
  BANNERGRESS_REQUEST_TIMEOUT_MS,
  fetchBannergress,
  formatBannergressSyncTime,
  isBannergressAuthSupportedOrigin,
  requestBannergressSyncData,
  saveBannergressSyncData,
  useBannergressAuth,
  useBannergressSync,
  withTimeout,
} from "../bannergressSync";
import { t, tk } from "../i18n";

const LISTS = [
  { key: "todo", label: tk("To do") },
  { key: "done", label: tk("Done") },
  { key: "blacklist", label: tk("Hidden") },
  { key: "yours", label: tk("Yours") },
];
const BANNERGRESS_ACCOUNT_URL = "https://bannergress.com/account";
const BANNERGRESS_CREATE_URL = "https://bannergress.com/new-banner";

// "Yours" = banners whose missions were made by the Ingress agent linked to the
// Bannergress account (same as Bannergress's agent page: /bnrs?author=<agent>).
export async function fetchOwnAgentName() {
  const response = await fetchBannergress("https://api.bannergress.com/user");

  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Sign in again."), { code: "AUTH" });
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const user = await response.json();
  const name = typeof user?.agent?.name === "string" ? user.agent.name.trim() : "";

  if (!name) {
    throw Object.assign(new Error("No agent linked."), { code: "NO_AGENT" });
  }

  return name;
}
const PAGE_SIZE = 24;
const COUNT_SYNC_INTERVAL_MS = 60 * 1000;
let lastCountSync = { at: 0, promise: null };

// The list sync feeds the To do / Done / Hidden tile colours and hides Hidden
// banners elsewhere. Opening Lists syncs again (at most once a minute; Retry
// forces it). Bannergress has no count endpoint, so the tabs show no numbers.
// Resolves to null on success or the error; never rejects.
function syncCountsNow({ force = false } = {}) {
  if (lastCountSync.promise) {
    return lastCountSync.promise;
  }

  if (!force && Date.now() - lastCountSync.at < COUNT_SYNC_INTERVAL_MS) {
    return null;
  }

  lastCountSync.promise = requestBannergressSyncData()
    .then((payload) => {
      saveBannergressSyncData(payload);
      lastCountSync.at = Date.now();
      return null;
    })
    .catch((error) => {
      console.error("Couldn't sync Bannergress list counts.", error);
      return error ?? new Error("Sync failed.");
    })
    .finally(() => {
      lastCountSync.promise = null;
    });
  return lastCountSync.promise;
}

export function describeSyncError(error) {
  if (error?.code === "TIMEOUT") {
    return t("timed out");
  }

  if (error?.code === "NETWORK") {
    return t("no connection");
  }

  if (Number.isFinite(error?.status)) {
    return `HTTP ${error.status}`;
  }

  return error?.code ? String(error.code).toLowerCase().replace(/_/g, " ") : "error";
}

export default function ListsPage() {
  const authData = useBannergressAuth();
  const syncState = useBannergressSync();
  const location = useLocation();
  const navigate = useNavigate();
  const togetherOpen = location.pathname.startsWith("/lists/together");
  // Back to this page brings the same tab and loaded pages (no refetch).
  const { entryKey, restored } = useRestoredEntry("lists");
  const skipInitialLoadRef = useRef(Boolean(restored));
  const [listType, setListTypeState] = useState(restored?.listType ?? "todo");
  const setListType = (nextListType) => {
    setListTypeState(nextListType);

    if (togetherOpen) {
      navigate("/lists");
    }
  };
  const [banners, setBanners] = useState(restored?.banners ?? []);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(restored?.hasMore ?? false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useBannerViewMode();
  const sentinelRef = useRef(null);
  const inFlightRef = useRef(false);
  const agentNameRef = useRef(null);
  const signedIn = Boolean(authData?.accessToken || authData?.refreshToken);
  const [countsSyncing, setCountsSyncing] = useState(false);
  const [countsError, setCountsError] = useState(null);
  const [countsAttempt, setCountsAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn || !isBannergressAuthSupportedOrigin()) {
      return undefined;
    }

    let ignore = false;
    const pending = syncCountsNow({ force: countsAttempt > 0 });

    if (pending) {
      setCountsSyncing(true);
      pending.then((syncError) => {
        if (!ignore) {
          setCountsSyncing(false);
          setCountsError(syncError);
        }
      });
    }

    return () => {
      ignore = true;
    };
  }, [signedIn, countsAttempt]);
  const countsAuthError = countsError?.code === "AUTH_REQUIRED";

  const loadPage = useCallback(
    async (offset) => {
      const url = new URL("https://api.bannergress.com/bnrs");

      if (listType === "yours") {
        agentNameRef.current = agentNameRef.current ?? (await fetchOwnAgentName());
        url.searchParams.set("author", agentNameRef.current);
        url.searchParams.set("orderBy", "created");
      } else {
        url.searchParams.set("listTypes", listType);
        url.searchParams.set("orderBy", "listAdded");
      }

      url.searchParams.set("orderDirection", "DESC");
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      const data = await withTimeout(async (signal) => {
        const response = await fetchBannergress(url.toString(), { signal });

        if (response.status === 401 || response.status === 403) {
          throw Object.assign(new Error("Sign in again."), { code: "AUTH" });
        }

        return response.json();
      }, BANNERGRESS_REQUEST_TIMEOUT_MS, "list page");

      if (!Array.isArray(data)) {
        throw new Error("Unexpected response.");
      }

      return data;
    },
    [listType]
  );

  useEffect(() => {
    if (!signedIn || togetherOpen) {
      skipInitialLoadRef.current = false;
      setBanners([]);
      return undefined;
    }

    if (skipInitialLoadRef.current) {
      skipInitialLoadRef.current = false;
      return undefined;
    }

    let ignore = false;
    inFlightRef.current = true;
    setLoading(true);
    setError("");

    loadPage(0)
      .then((data) => {
        if (!ignore) {
          setBanners(data);
          setHasMore(data.length === PAGE_SIZE);
        }
      })
      .catch((loadError) => {
        if (!ignore) {
          setBanners([]);
          setHasMore(false);
          setError(
            loadError?.code === "AUTH"
              ? t("Your Bannergress sign-in expired. Sign in again.")
              : loadError?.code === "NO_AGENT"
                ? "NO_AGENT"
                : t("Couldn't load this list. Please try again.")
          );
        }
      })
      .finally(() => {
        inFlightRef.current = false;

        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [loadPage, signedIn, togetherOpen]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loading || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setLoadingMore(true);
    loadPage(banners.length)
      .then((data) => {
        setBanners((current) => {
          const seen = new Set(current.map((banner) => banner.id));
          return [...current, ...data.filter((banner) => !seen.has(banner.id))];
        });
        setHasMore(data.length === PAGE_SIZE);
      })
      .catch(() => setHasMore(false))
      .finally(() => {
        inFlightRef.current = false;
        setLoadingMore(false);
      });
  }, [banners.length, hasMore, loadPage, loading]);

  useRememberEntry(
    entryKey,
    "lists",
    signedIn && !togetherOpen && !loading && !error
      ? { listType, banners, hasMore }
      : null
  );

  useInfiniteScroll(sentinelRef, {
    enabled: signedIn && !togetherOpen && hasMore && !loading && !loadingMore,
    onLoadMore: handleLoadMore,
    itemCount: banners.length,
  });

  // Sentences with a link in the middle: one key each, split at the link.
  const [accountBeforeLink, accountAfterLink] = t(
    "Your banners are the ones made from your agent’s missions. Link your agent on your {link}, then come back here."
  ).split("{link}");
  const [createBeforeLink, createAfterLink] = t(
    "Made missions in Ingress? {link} and it shows up here."
  ).split("{link}");

  return (
    <div className="ob-page">
      <div className="ob-sec-head">
        <div>
          <h1 className="ob-h1">{t("Your lists")}</h1>
          <p className="small muted">
            {syncState?.syncedAt
              ? t("Your Bannergress lists · synced {time}", {
                  time: formatBannergressSyncTime(syncState.syncedAt),
                })
              : t("Your Bannergress lists")}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg lists-seg" role="group" aria-label={t("List")}>
          {LISTS.map((list) => (
            <button
              type="button"
              key={list.key}
              className="sl"
              aria-pressed={!togetherOpen && listType === list.key}
              onClick={() => setListType(list.key)}
            >
              {t(list.label)}
            </button>
          ))}
          <button
            type="button"
            className="sl"
            aria-pressed={togetherOpen}
            onClick={() => navigate("/lists/together")}
          >
            {t("Together")}
          </button>
        </div>
        <span className="grow" />
        {togetherOpen || !signedIn ? null : (
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        )}
      </div>
      {signedIn && countsError && !countsSyncing ? (
        <div className="ob-alert bad lists-sync-error" role="alert">
          <div className="grow">
            {countsAuthError
              ? t("Your Bannergress sign-in expired.")
              : t("Couldn’t load your lists from Bannergress ({reason}).", {
                  reason: describeSyncError(countsError),
                })}
          </div>
          <button
            type="button"
            className="btn sl"
            onClick={() =>
              countsAuthError
                ? window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT))
                : setCountsAttempt((attempt) => attempt + 1)
            }
          >
            {countsAuthError ? t("Sign in again") : t("Retry")}
          </button>
        </div>
      ) : null}
      {togetherOpen ? (
        <BannerTogetherLauncher />
      ) : !signedIn ? (
        <div className="loc-card">
          <span className="loc-ic">
            <Login />
          </span>
          <div className="grow">
            <b>{t("Sign in to see your lists")}</b>
            <span className="small">
              {t("To do, Done and Hidden come from your Bannergress account.")}
            </span>
            <div className="acts">
              <button
                type="button"
                className="btn filled sl"
                disabled={!isBannergressAuthSupportedOrigin()}
                onClick={() =>
                  window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT))
                }
              >
                {t("Sign in with Bannergress")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {error === "NO_AGENT" ? (
            <div className="ob-alert" role="note">
              <div className="grow">
                <b>{t("Link your Ingress agent first")}</b>
                <span className="small">
                  {accountBeforeLink}
                  <a href={BANNERGRESS_ACCOUNT_URL} target="_blank" rel="noreferrer">
                    {t("Bannergress account page")}
                  </a>
                  {accountAfterLink}
                </span>
              </div>
            </div>
          ) : error ? (
            <div className="ob-alert bad" role="alert">
              <div className="grow">{error}</div>
            </div>
          ) : null}
          {loading ? (
            <BannerWall banners={[]} skeletonCount={8} label={t("Loading list")} />
          ) : banners.length === 0 && !error ? (
            listType === "yours" ? (
              <div className="ob-alert">
                <div className="grow">
                  <b>{t("You haven’t created any banners yet")}</b>
                  <span className="small">
                    {createBeforeLink}
                    <a href={BANNERGRESS_CREATE_URL} target="_blank" rel="noreferrer">
                      {t("Create the banner on Bannergress")}
                    </a>
                    {createAfterLink}
                  </span>
                </div>
              </div>
            ) : (
              <div className="ob-alert">{t("Nothing on this list yet.")}</div>
            )
          ) : viewMode === "compact" ? (
            <BannerRows banners={banners} loadingMore={loadingMore} label={t("List banners")} />
          ) : (
            <BannerWall banners={banners} loadingMore={loadingMore} label={t("List banners")} />
          )}
          {hasMore ? <div ref={sentinelRef} style={{ height: 1 }} /> : null}
        </>
      )}
    </div>
  );
}
