import React from "react";
import { Link } from "react-router-dom";
import { t } from "../i18n";

// /privacy. Keep this true: each statement was checked against the code and
// the server on 2026-10-30 (nginx logs ~15 days and not backed up; no
// analytics, ads or cookies; token never stored by server/passphrases.mjs or
// server/telegram-join.mjs; tables in server/passphrases.mjs; PENDING_DAYS;
// Banner Together rooms in memory for at most 4 hours) and on 2026-10-31
// (synced settings: SYNCED_SETTING_NAMES in src/settingsSync.js and
// server/synced-settings.mjs, only while signed in, picked city only, removed
// in Settings; To do/Done/Hide go to api.bannergress.com /bnrs/:id/settings),
// and again on 2026-10-31 for the Overlay backup (server/overlay-backup.mjs:
// one per account, one-time code + 15-minute app token, deleted in Settings)
// and "Download my data" (server/data-export.mjs, once an hour).
// Update it, and the date, when any of that changes.
const GITHUB_ISSUES = "https://github.com/Gamer1120/OpenBanners/issues";

export default function PrivacyPage() {
  return (
    <div className="ob-page privacy">
      <h1 className="ob-h1">{t("Privacy")}</h1>
      <p>
        {t(
          "OpenBanners is an unofficial hobby project. It isn't made by Bannergress or Niantic. It shows banner data from Bannergress, and you sign in with your Bannergress account."
        )}
      </p>

      <h2 className="ob-h2">{t("What the server logs")}</h2>
      <p>
        {t(
          "Like most websites, the server logs every request: your IP address, the page, the time and your browser. These logs are kept for about 15 days, for security and to count visitors, and aren't in backups. There are no ads, no analytics services and no tracking cookies."
        )}
      </p>

      <h2 className="ob-h2">{t("Signing in")}</h2>
      <p>
        {t(
          "You sign in on Bannergress's own page (with Google). Your sign-in is kept in your browser. It's only sent to the OpenBanners server for notes, plans, synced settings, passphrases, the Overlay backup, downloading your data and the Telegram invite, so the server can ask Bannergress who you are. The server doesn't store it."
        )}
      </p>

      <h2 className="ob-h2">{t("What is stored when you use these features")}</h2>
      <ul>
        <li>
          {t(
            "Your Bannergress account ID, together with what you save: notes, Mission Day plans, passphrase answers and votes, translation suggestions, your settings and your Overlay backup."
          )}
        </li>
        <li>
          {t(
            "Synced settings: while you're signed in, your language, map filters, Wall/List view, chosen city, closed welcome note and recent plans are saved under your Bannergress account, so they follow you to other devices where you sign in. Your location isn't part of them."
          )}
        </li>
        <li>
          {t(
            "Overlay backup: when you tap “Back up to OpenBanners” in the OpenBanners Overlay app, its settings (overlay, card, route map and compass options) are saved under your Bannergress account and replace the previous backup. For that the app gets a one-time code from this website, never your Bannergress sign-in, and its access ends after 15 minutes. Your location and progress aren't part of it."
          )}
        </li>
        <li>
          {t(
            "Your To do, Done and Hide marks are kept by Bannergress, not by OpenBanners. Your browser keeps a copy so it can show them."
          )}
        </li>
        <li>
          {t(
            "Passphrase answers become visible to everyone: mission numbers once a moderator approves them, other answers 30 days after they're sent and approved. Typed answers are shown to the moderators in a Telegram chat for review. Banner authors can remove the answers for their banners."
          )}
        </li>
        <li>
          {t(
            "Banner Together rooms only exist in the server's memory and disappear after at most 4 hours. The lists you compare in them are end-to-end encrypted."
          )}
        </li>
      </ul>

      <h2 className="ob-h2">{t("Deleting your data")}</h2>
      <p>
        {t(
          "You can delete a Mission Day plan you made on its page and empty a note to remove it. In ⋮ → Settings you can remove your synced settings (that also turns syncing off) and delete your Overlay backup. For anything else, open an issue on GitHub and it will be removed."
        )}{" "}
        <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
          {t("OpenBanners on GitHub")}
        </a>
      </p>

      <h2 className="ob-h2">{t("A copy of your data")}</h2>
      <p>
        {t(
          "In ⋮ → Settings, “Download my data” gives you one JSON file with everything OpenBanners stores for your account, with a short explanation of each part. You can do this once an hour."
        )}
      </p>

      <h2 className="ob-h2">{t("Other services your browser contacts")}</h2>
      <p>
        {t(
          "Bannergress (banner data and sign-in), Google (mission pictures and sign-in) and OpenStreetMap (map tiles). They have their own privacy policies."
        )}
      </p>

      <h2 className="ob-h2">{t("On your device")}</h2>
      <p>
        {t(
          "Your sign-in, settings, recent plans, recent searches and map position are kept in your browser's storage. Apart from the synced settings, they stay there. Clearing this site's data in your browser removes them."
        )}
      </p>
      <p>
        <a href="/overlay/privacy">{t("Privacy of the OpenBanners Overlay app")}</a>
      </p>

      <p className="small muted">{t("Last updated: 31 October 2026")}</p>
      <p>
        <Link className="btn tonal sl" to="/">
          {t("Go to home page")}
        </Link>
      </p>
    </div>
  );
}
