import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchBannergress } from "../../bannergressSync";
import { formatLength } from "../../bannerDisplay";
import BannerImage from "../BannerImage";
import { DEFAULT_WALK_BANNER } from "../../walkMode";
import { useViewportCover } from "./useWalk";
import { t, tn } from "../../i18n";
import "./walk.css";

// A banner id from what was typed: an id, or an OpenBanners/Bannergress link.
export function parseBannerInput(value) {
  const text = String(value ?? "").trim();
  const fromLink = text.match(/\/banner\/([^/?#\s]+)/);
  const id = fromLink ? decodeURIComponent(fromLink[1]) : text;
  return /^[\w%.~-]{1,200}$/u.test(id) ? id : "";
}

export const walkLink = (bannerId) => "/banner/" + encodeURIComponent(bannerId) + "/walk";

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
      <div className="wk-index-body">
        <p className="wk-lead">
          {t("For walking a banner with Ingress open: one big button opens the next mission in Ingress and copies its passphrase in the same tap. Switch back here after each mission.")}
        </p>

        <form className="wk-pick" onSubmit={submit}>
          <label htmlFor="wk-banner">{t("Banner (id or link)")}</label>
          <div className="wk-pick-row">
            <input id="wk-banner" value={input} onChange={(event) => setInput(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck="false" />
            <button type="submit" className="wk-small-btn">
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
              </div>
            </>
          ) : banner.status === "loading" ? (
            <span>{t("Loading banner…")}</span>
          ) : (
            <span>{t("Couldn't load this banner.")}</span>
          )}
        </div>

        <Link className="wk-index-open" to={walkLink(bannerId)}>
          {t("Open walk mode")}
        </Link>

        <h2 className="wk-h2">{t("What to try")}</h2>
        <ul className="wk-tips">
          <li>{t("Tap “Open mission 1”: the passphrase is copied and Ingress opens the mission.")}</li>
          <li>{t("Switch back: the button now opens the next mission. A mission with more than one passphrase shows its answers to copy.")}</li>
          <li>{t("The ⋯ menu picks another mission, undoes the last step or resets the banner.")}</li>
        </ul>
        <p className="wk-note">
          <Link to={"/banner/" + encodeURIComponent(bannerId)}>{t("Open the banner page")}</Link>
        </p>
      </div>
    </div>
  );
}
