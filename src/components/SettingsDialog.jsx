import React, { useState } from "react";
import ObModal from "./ObModal";
import { BANNERGRESS_AUTH_REQUEST_EVENT } from "../bannergressSync";
import { useUserSettings } from "../passphraseApi";

// Account settings (stored per Bannergress account by the passphrase service).
export default function SettingsDialog({ onClose }) {
  const { status, settings, loggedIn, save, error: loadError } = useUserSettings(true);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [error, setError] = useState("");
  const change = (changes) => {
    setError("");
    return save(changes).catch((e) => setError(e.message));
  };

  return (
    <ObModal title="Settings" onClose={onClose} labelId="settings-title">
      <h3 className="ob-settings-h">Passphrases</h3>
      {!loggedIn ? (
        <div className="ob-setting">
          <div className="grow small">These settings belong to your Bannergress account.</div>
          <button
            type="button"
            className="btn tonal sl"
            onClick={() => {
              onClose();
              window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT));
            }}
          >
            Log in
          </button>
        </div>
      ) : status !== "ready" ? (
        <p className="small muted">{status === "error" ? loadError || "Couldn’t load your settings." : "Loading…"}</p>
      ) : (
        <>
          <label className="ob-setting">
            <span className="grow">
              <b>Ask after I mark a banner done</b>
              <span className="small muted">Whether its passphrases were the mission numbers.</span>
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
              <b>Never allow passphrases for my banners</b>
              <span className="small muted">
                {settings.canBlockMyBanners
                  ? `For every banner by ${settings.agent}. Turning this on deletes their answers for good.`
                  : "Verify your agent name on Bannergress to use this."}
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
            <div className="pp-confirm" role="alertdialog" aria-label="Never allow passphrases for my banners">
              <p className="small">
                This deletes all passphrase answers on your banners for good, and nobody can add new ones.
              </p>
              <div className="pp-actions">
                <button
                  type="button"
                  className="btn filled sl pp-danger"
                  onClick={() => change({ blockMyBanners: true }).then(() => setConfirmBlock(false))}
                >
                  Delete and block
                </button>
                <button type="button" className="btn text sl" onClick={() => setConfirmBlock(false)}>
                  Cancel
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
