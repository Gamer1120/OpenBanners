import React from "react";
import { Link } from "react-router-dom";
import { t } from "../i18n";

// Any URL no route knows (App.jsx path="*"); the server answers it with 404.
export default function NotFoundPage() {
  return (
    <div className="ob-page ob-crash not-found">
      <h1 className="ob-h1">{t("Page not found")}</h1>
      <p className="muted">{t("There’s no page at this address. The link may be mistyped or out of date.")}</p>
      <div className="ob-crash-acts">
        <Link className="btn filled sl" to="/">
          {t("Go to home page")}
        </Link>
        <Link className="btn tonal sl" to="/map">
          {t("Map")}
        </Link>
        <Link className="btn tonal sl" to="/search">
          {t("Search")}
        </Link>
      </div>
    </div>
  );
}
