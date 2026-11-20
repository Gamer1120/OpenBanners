import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchBannergress } from "../../bannergressSync";
import { formatLength } from "../../bannerDisplay";
import BannerImage from "../BannerImage";
import { DEFAULT_WALK_BANNER, WALK_PROGRESS_PREFIX } from "../../walkMode";
import { useViewportCover } from "./useWalk";
import { t, tk, tn } from "../../i18n";
import "./walk.css";

// A banner id from what was typed: an id, or an OpenBanners/Bannergress link.
export function parseBannerInput(value) {
  const text = String(value ?? "").trim();
  const fromLink = text.match(/\/banner\/([^/?#\s]+)/);
  const id = fromLink ? decodeURIComponent(fromLink[1]) : text;
  return /^[\w%.~-]{1,200}$/u.test(id) ? id : "";
}

const VARIANTS = [
  {
    id: "a",
    name: tk("Big arrow"),
    text: tk("One big card: a large compass arrow and distance to the next waypoint, its name and what to do there, with big Copy passphrase / Navigate / Mark done buttons."),
  },
  {
    id: "b",
    name: tk("Map"),
    text: tk("Map first: the route on a full-screen map with you on it, and a bottom sheet with the next waypoint (tap the handle to see the mission's steps)."),
  },
  {
    id: "c",
    name: tk("Steps list"),
    text: tk("The current mission as a list of steps: done ones ticked off, the next one opened with its arrow and buttons, the others with their distance."),
  },
];

export default function WalkMockups() {
  useViewportCover();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const initial = parseBannerInput(search.get("banner")) || DEFAULT_WALK_BANNER;
  const [input, setInput] = useState(initial);
  const [bannerId, setBannerId] = useState(initial);
  const [banner, setBanner] = useState({ status: "loading", data: null });

  useEffect(() => {
    let ignore = false;
    setBanner({ status: "loading", data: null });
    fetchBannergress("https://api.bannergress.com/bnrs/" + encodeURIComponent(bannerId))
      .then(async (response) => {
        const data = response?.ok ? await response.json() : null;
        if (!ignore) {
          setBanner(data?.id ? { status: "ready", data } : { status: "error", data: null });
        }
      })
      .catch(() => !ignore && setBanner({ status: "error", data: null }));
    return () => {
      ignore = true;
    };
  }, [bannerId]);

  useEffect(() => {
    const previous = document.title;
    document.title = t("Walk mode mockups") + " · OpenBanners";
    return () => {
      document.title = previous;
    };
  }, []);

  const submit = (event) => {
    event.preventDefault();
    const id = parseBannerInput(input);
    if (id) {
      setBannerId(id);
      navigate({ search: "?banner=" + encodeURIComponent(id) }, { replace: true });
    }
  };

  let saved = 0;
  try {
    saved = JSON.parse(window.localStorage.getItem(WALK_PROGRESS_PREFIX + bannerId) || "null")?.done?.length ?? 0;
  } catch {
    saved = 0;
  }

  const walkLink = (variant) => "/banner/" + encodeURIComponent(bannerId) + "/walk?variant=" + variant;

  return (
    <div className="wk wk-index">
      <header className="wk-top">
        <Link className="wk-back" to="/" aria-label={t("Home")}>
          ‹
        </Link>
        <div className="wk-top-title">
          <span className="wk-top-name">{t("Walk mode mockups")}</span>
          <span className="wk-top-sub">{t("Preview on test.openbanners.org only")}</span>
        </div>
      </header>
      <div className="wk-body wk-index-body">
        <p className="wk-lead">
          {t("Walk mode is meant for iPhone players: iOS can't show the Overlay over Ingress, so you walk the banner with this page open (best added to the Home Screen) and switch to Ingress for each mission. It works the same in Chrome on Android.")}
        </p>

        <form className="wk-pick" onSubmit={submit}>
          <label htmlFor="wk-banner">{t("Banner (id or link)")}</label>
          <div className="wk-pick-row">
            <input id="wk-banner" value={input} onChange={(event) => setInput(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck="false" />
            <button type="submit" className="wk-btn small primary">
              {t("Use")}
            </button>
          </div>
        </form>

        <div className="wk-index-banner">
          {banner.status === "ready" ? (
            <>
              <span className="wk-index-pic">
                <BannerImage banner={banner.data} mode="natural" />
              </span>
              <div>
                <strong>{banner.data.title}</strong>
                <span>
                  {banner.data.formattedAddress} · {formatLength(banner.data.lengthMeters)} · {tn("{count} mission", "{count} missions", banner.data.numberOfMissions)}
                </span>
                {saved ? <span>{t("Saved progress on this device: {count} waypoints", { count: String(saved) })}</span> : null}
              </div>
            </>
          ) : banner.status === "loading" ? (
            <span>{t("Loading banner…")}</span>
          ) : (
            <span>{t("Couldn't load this banner.")}</span>
          )}
        </div>

        <ul className="wk-index-list">
          {VARIANTS.map((variant) => (
            <li key={variant.id}>
              <Link className="wk-index-card" to={walkLink(variant.id)}>
                <span className="wk-index-letter">{variant.id.toUpperCase()}</span>
                <span>
                  <strong>{variant.id.toUpperCase()} · {t(variant.name)}</strong>
                  <span>{t(variant.text)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <h2 className="wk-h2">{t("What to try")}</h2>
        <ul className="wk-tips">
          <li>{t("“Simulate walking (demo)” at the bottom moves a fake position along the route; waypoints tick off within 40 m, like the Overlay.")}</li>
          <li>{t("“Use real GPS” uses your real position (the arrow follows your phone's compass when it has one).")}</li>
          <li>{t("Progress is kept on this device per banner; Undo and Reset progress are at the bottom.")}</li>
          <li>{t("The A / B / C buttons at the top switch between the designs and keep your progress.")}</li>
          <li>
            {t("To see the iPhone “Add to Home Screen” hint on Android, open a design with &hint=ios:")}{" "}
            <Link to={walkLink("a") + "&hint=ios"}>{t("design A with the hint")}</Link>
          </li>
        </ul>
        <p className="wk-note">
          <Link to={"/banner/" + encodeURIComponent(bannerId)}>{t("Open the banner page")}</Link>
        </p>
      </div>
    </div>
  );
}
