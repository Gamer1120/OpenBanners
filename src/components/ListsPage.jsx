import React, { useCallback, useEffect, useRef, useState } from "react";
import { Login } from "@mui/icons-material";
import { useLocation, useNavigate } from "react-router-dom";
import BannerTogetherLauncher from "./BannerTogetherLauncher";
import BannerWall, { BannerRows, useInfiniteScroll } from "./BannerWall";
import ViewModeToggle, { useBannerViewMode } from "./ViewModeToggle";
import {
  BANNERGRESS_AUTH_REQUEST_EVENT,
  fetchBannergress,
  formatBannergressSyncTime,
  getBannergressSyncCounts,
  isBannergressAuthSupportedOrigin,
  useBannergressAuth,
  useBannergressSync,
} from "../bannergressSync";

const LISTS = [
  { key: "todo", label: "To do" },
  { key: "done", label: "Done" },
  { key: "blacklist", label: "Hidden" },
];
const PAGE_SIZE = 24;

export default function ListsPage() {
  const authData = useBannergressAuth();
  const syncState = useBannergressSync();
  const counts = getBannergressSyncCounts(syncState);
  const location = useLocation();
  const navigate = useNavigate();
  const togetherOpen = location.pathname.startsWith("/lists/together");
  const [listType, setListTypeState] = useState("todo");
  const setListType = (nextListType) => {
    setListTypeState(nextListType);

    if (togetherOpen) {
      navigate("/lists");
    }
  };
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useBannerViewMode();
  const sentinelRef = useRef(null);
  const inFlightRef = useRef(false);
  const signedIn = Boolean(authData?.accessToken || authData?.refreshToken);

  const loadPage = useCallback(
    async (offset) => {
      const url = new URL("https://api.bannergress.com/bnrs");
      url.searchParams.set("listTypes", listType);
      url.searchParams.set("orderBy", "listAdded");
      url.searchParams.set("orderDirection", "DESC");
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      const response = await fetchBannergress(url.toString());

      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Sign in again."), { code: "AUTH" });
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error("Unexpected response.");
      }

      return data;
    },
    [listType]
  );

  useEffect(() => {
    if (!signedIn || togetherOpen) {
      setBanners([]);
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
              ? "Your Bannergress sign-in expired. Sign in again."
              : "Couldn't load this list. Please try again."
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

  useInfiniteScroll(sentinelRef, {
    enabled: signedIn && !togetherOpen && hasMore && !loading && !loadingMore,
    onLoadMore: handleLoadMore,
    itemCount: banners.length,
  });

  return (
    <div className="ob-page">
      <div className="ob-sec-head">
        <div>
          <h1 className="ob-h1">Your lists</h1>
          <p className="small muted">
            Your Bannergress lists
            {syncState?.syncedAt
              ? ` · synced ${formatBannergressSyncTime(syncState.syncedAt)}`
              : ""}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="List">
          {LISTS.map((list) => (
            <button
              type="button"
              key={list.key}
              className="sl"
              aria-pressed={!togetherOpen && listType === list.key}
              onClick={() => setListType(list.key)}
            >
              {list.label}
              <span className="small muted">{counts[list.key] ?? 0}</span>
            </button>
          ))}
          <button
            type="button"
            className="sl"
            aria-pressed={togetherOpen}
            onClick={() => navigate("/lists/together")}
          >
            Together
          </button>
        </div>
        <span className="grow" />
        {togetherOpen || !signedIn ? null : (
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        )}
      </div>
      {togetherOpen ? (
        <BannerTogetherLauncher />
      ) : !signedIn ? (
        <div className="loc-card">
          <span className="loc-ic">
            <Login />
          </span>
          <div className="grow">
            <b>Sign in to see your lists</b>
            <span className="small">
              To do, Done and Hidden come from your Bannergress account.
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
                Sign in with Bannergress
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {error ? (
            <div className="ob-alert bad" role="alert">
              <div className="grow">{error}</div>
            </div>
          ) : null}
          {loading ? (
            <BannerWall banners={[]} skeletonCount={8} label="Loading list" />
          ) : banners.length === 0 && !error ? (
            <div className="ob-alert">Nothing on this list yet.</div>
          ) : viewMode === "compact" ? (
            <BannerRows banners={banners} loadingMore={loadingMore} label="List banners" />
          ) : (
            <BannerWall banners={banners} loadingMore={loadingMore} label="List banners" />
          )}
          {hasMore ? <div ref={sentinelRef} style={{ height: 1 }} /> : null}
        </>
      )}
    </div>
  );
}
