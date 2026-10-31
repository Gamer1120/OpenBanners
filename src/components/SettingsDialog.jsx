import React, { useState } from "react";
import ObModal from "./ObModal";
import { BANNERGRESS_AUTH_REQUEST_EVENT } from "../bannergressSync";
import { useUserSettings } from "../passphraseApi";
import { LANGUAGES, getLanguageChoice, setLanguageChoice, t } from "../i18n";
import { removeSyncedSettings, turnOnSettingsSync, useSettingsSync } from "../settingsSync";

// Settings sync (src/settingsSync.js): on while signed in, until removed here.
function SyncSection({ loggedIn }) {
  const sync = useSettingsSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = (action) => {
    setBusy(true);
    setError("");
    action()
      .catch(() => setError(t("Couldn't sync your settings right now. They're still saved on this device.")))
      .finally(() => setBusy(false));
  };

  if (!loggedIn) {
    return (
      <p className="small muted">
        {t("Sign in with Bannergress to take your language, map filters, view, city and recent plans to your other devices.")}
      </p>
    );
  }
  const off = sync.status === "off";
  return (
    <div className="ob-setting">
      <span className="grow">
        <span className="small">
          {off
            ? t("Syncing is off. Your settings stay on this device only.")
            : t("Your language, map filters, view, city and recent plans are saved with your Bannergress account, so they follow you to other devices where you sign in.")}
        </span>
        {error || sync.status === "error" ? (
          <span className="small pp-error" role="alert">
            {error || t("Couldn't sync your settings right now. They're still saved on this device.")}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        className="btn tonal sl"
        disabled={busy || sync.status === "syncing"}
        onClick={() => run(off ? turnOnSettingsSync : removeSyncedSettings)}
      >
        {off ? t("Turn syncing on") : t("Remove my synced settings")}
      </button>
    </div>
  );
}

// Account settings (stored per Bannergress account by the passphrase service).
export default function SettingsDialog({ onClose }) {
  const { status, settings, loggedIn, save, error: loadError } = useUserSettings(true);
  const sync = useSettingsSync();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [error, setError] = useState("");
  const change = (changes) => {
    setError("");
    return save(changes).catch((e) => setError(e.message));
  };

  return (
    <ObModal title={t("Settings")} onClose={onClose} labelId="settings-title">
      <h3 className="ob-settings-h">{t("Language")}</h3>
      <label className="ob-setting">
        <span className="grow">
          <b>{t("Language")}</b>
          <span className="small muted">
            {loggedIn && sync.status !== "off"
              ? t("Saved on this device and synced with your account.")
              : t("Saved on this device.")}
          </span>
        </span>
        <select
          className="ob-select"
          aria-label={t("Language")}
          defaultValue={getLanguageChoice()}
          onChange={(event) => setLanguageChoice(event.target.value)}
        >
          <option value="auto">{t("Automatic (browser)")}</option>
          {LANGUAGES.map((language) => (
            <option key={language.code} value={language.code} lang={language.code}>
              {language.name}
            </option>
          ))}
        </select>
      </label>
      <h3 className="ob-settings-h">{t("Sync between devices")}</h3>
      <SyncSection loggedIn={loggedIn} />
      <h3 className="ob-settings-h">{t("Passphrases")}</h3>
      {!loggedIn ? (
        <div className="ob-setting">
          <div className="grow small">{t("These settings belong to your Bannergress account.")}</div>
          <button
            type="button"
            className="btn tonal sl"
            onClick={() => {
              onClose();
              window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT));
            }}
          >
            {t("Log in")}
          </button>
        </div>
      ) : status !== "ready" ? (
        <p className="small muted">{status === "error" ? loadError || t("Couldn’t load your settings.") : t("Loading…")}</p>
      ) : (
        <>
          <label className="ob-setting">
            <span className="grow">
              <b>{t("Ask after I mark a banner done")}</b>
              <span className="small muted">{t("Whether its passphrases were the mission numbers.")}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="ob-switch"
              checked={settings.askAfterDone}
              onChange={(event) => change({ askAfterDone: event.target.checked })}
            />
          </label>
          <label className="ob-setting">
            <span className="grow">
              <b>{t("Never allow passphrases for my banners")}</b>
              <span className="small muted">
                {settings.canBlockMyBanners
                  ? t("For every banner by {agent}. Turning this on deletes their answers for good.", { agent: settings.agent })
                  : t("Verify your agent name on Bannergress to use this.")}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="ob-switch"
              disabled={!settings.canBlockMyBanners}
              checked={settings.blockMyBanners}
              onChange={(event) =>
                event.target.checked ? setConfirmBlock(true) : change({ blockMyBanners: false })
              }
            />
          </label>
          {confirmBlock ? (
            <div className="pp-confirm" role="alertdialog" aria-label={t("Never allow passphrases for my banners")}>
              <p className="small">
                {t("This deletes all passphrase answers on your banners for good, and nobody can add new ones.")}
              </p>
              <div className="pp-actions">
                <button
                  type="button"
                  className="btn filled sl pp-danger"
                  onClick={() => change({ blockMyBanners: true }).then(() => setConfirmBlock(false))}
                >
                  {t("Delete and block")}
                </button>
                <button type="button" className="btn text sl" onClick={() => setConfirmBlock(false)}>
                  {t("Cancel")}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {error ? <p className="small pp-error" role="alert">{error}</p> : null}
    </ObModal>
  );
}
