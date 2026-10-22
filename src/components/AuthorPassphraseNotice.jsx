import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Key } from "@mui/icons-material";
import { useBannergressAuth } from "../bannergressSync";
import { getMyPassphraseNotices } from "../passphraseApi";

// Tells a logged-in, verified author that passphrase answers were suggested
// for their banners, so they can publish or object before they show.
export default function AuthorPassphraseNotice() {
  const auth = useBannergressAuth();
  const loggedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const [pending, setPending] = useState([]);

  useEffect(() => {
    if (!loggedIn) {
      setPending([]);
      return undefined;
    }
    let cancelled = false;
    getMyPassphraseNotices().then(
      (data) => !cancelled && setPending(Array.isArray(data?.pending) ? data.pending : []),
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  if (!pending.length) {
    return null;
  }

  return (
    <div className="ob-alert warn ob-author-notice" role="note">
      <Key />
      <div className="grow">
        <b>
          Passphrase answers were suggested for {pending.length === 1 ? "one of your banners" : `${pending.length} of your banners`}
        </b>
        <span className="small">
          They show after 30 days unless you object. Open the banner’s Missions tab to publish or stop them.
        </span>
        <ul className="ob-author-list">
          {pending.map((item) => (
            <li key={item.bannerId}>
              <Link to={`/banner/${encodeURIComponent(item.bannerId)}`}>{item.title || item.bannerId}</Link>
              <span className="small">
                {" "}
                · {item.count} answer{item.count > 1 ? "s" : ""}, from{" "}
                {new Date(item.visibleAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
