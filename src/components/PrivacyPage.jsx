import React from "react";
import { Link } from "react-router-dom";
import { t } from "../i18n";

// /privacy. Keep this true: each statement was checked against the code and
// the server on 2026-10-30 (nginx logs ~15 days and not backed up; no
// analytics, ads or cookies; token never stored by server/passphrases.mjs or
// server/telegram-join.mjs; tables in server/passphrases.mjs; PENDING_DAYS;
// Banner Together rooms in memory for at most 4 hours). Update it, and the
// date, when any of that changes.
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
          "You sign in on Bannergress's own page (with Google). Your sign-in is kept in your browser. It's only sent to the OpenBanners server for notes, plans, passphrases and the Telegram invite, so the server can ask Bannergress who you are. The server doesn't store it."
        )}
      </p>

      <h2 className="ob-h2">{t("What is stored when you use these features")}</h2>
      <ul>
        <li>
          {t(
            "Your Bannergress account ID, together with what you save: notes, Mission Day plans, passphrase answers and votes, and your settings."
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
          "You can delete a Mission Day plan you made on its page, and empty a note to remove it. For anything else, open an issue on GitHub and it will be removed."
        )}{" "}
        <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
          {t("OpenBanners on GitHub")}
        </a>
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
          "Your settings, language, filters, recent plans and sign-in are kept in your browser's storage. Signing out or clearing this site's data in your browser removes them."
        )}
      </p>
      <p>
        <a href="/overlay/privacy">{t("Privacy of the OpenBanners Overlay app")}</a>
      </p>

      <p className="small muted">{t("Last updated: 30 October 2026")}</p>
      <p>
        <Link className="btn tonal sl" to="/">
          {t("Go to home page")}
        </Link>
      </p>
    </div>
  );
}
