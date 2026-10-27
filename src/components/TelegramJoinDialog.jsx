import React, { useEffect, useState } from "react";
import ObModal from "./ObModal";
import { BANNERGRESS_AUTH_REQUEST_EVENT, useBannergressAuth } from "../bannergressSync";
import { getTelegramJoinStatus, requestTelegramJoinCode } from "../telegramJoin";
import { t } from "../i18n";

// Codes live 10 minutes on the server; get a fresh one a bit before that.
export const TELEGRAM_CODE_REFRESH_MS = 9 * 60 * 1000;

// More menu → "Join on Telegram". The code is fetched when the dialog opens,
// so the button is a real link (no popup blocker on phones). The bot
// (@OpenBannersBot) answers /start <code> with one-time invite links.
export default function TelegramJoinDialog({ onClose }) {
  const auth = useBannergressAuth();
  const loggedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const [state, setState] = useState({ status: "loading" });
  const [round, setRound] = useState(0);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const set = (next) => !cancelled && setState(next);
    setOpened(false);
    setState({ status: "loading" });
    (async () => {
      try {
        const status = await getTelegramJoinStatus();
        if (!status?.enabled) {
          set({ status: "off" });
          return;
        }
        if (!loggedIn) {
          set({ status: "signin" });
          return;
        }
        set({ status: "ready", invite: await requestTelegramJoinCode() });
      } catch (error) {
        const code = error?.code;
        set({
          status: code === "login_required" ? "signin" : code === "not_configured" ? "off" : code === "not_verified" ? "unverified" : "error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loggedIn, round]);

  useEffect(() => {
    if (state.status !== "ready") {
      return undefined;
    }
    const timer = window.setTimeout(() => setRound((value) => value + 1), TELEGRAM_CODE_REFRESH_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const bot = `@${state.invite?.bot || "OpenBannersBot"}`;

  return (
    <ObModal title={t("Join on Telegram")} onClose={onClose} labelId="telegram-join-title">
      <p className="small">
        {t("Get OpenBanners news and chat with other users in our Telegram channel and group. They’re for people who sign in with Bannergress.")}
      </p>
      {state.status === "loading" ? <p className="small muted">{t("Loading…")}</p> : null}
      {state.status === "off" ? <p className="small muted">{t("Joining on Telegram isn’t available yet.")}</p> : null}
      {state.status === "unverified" ? <p className="small muted">{t("Verify your agent name on Bannergress to use this.")}</p> : null}
      {state.status === "signin" ? (
        <>
          <p className="small">{t("Sign in with Bannergress to join.")}</p>
          <div className="ob-modal-actions">
            <button
              type="button"
              className="btn filled sl"
              onClick={() => {
                onClose();
                window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT));
              }}
            >
              {t("Sign in with Bannergress")}
            </button>
          </div>
        </>
      ) : null}
      {state.status === "error" ? (
        <>
          <p className="small muted">{t("Couldn’t get your invite. Try again later.")}</p>
          <div className="ob-modal-actions">
            <button type="button" className="btn outlined sl" onClick={() => setRound((value) => value + 1)}>
              {t("Retry")}
            </button>
          </div>
        </>
      ) : null}
      {state.status === "ready" ? (
        <>
          <p className="small">
            {t("{bot} will send you personal invite links. Each one works once and expires after 15 minutes.", { bot })}
          </p>
          <div className="ob-modal-actions">
            <a
              className="btn filled sl"
              href={state.invite.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpened(true)}
            >
              {t("Open Telegram")}
            </a>
            {opened ? (
              <button type="button" className="btn text sl" onClick={() => setRound((value) => value + 1)}>
                {t("Didn’t work? Get a new link")}
              </button>
            ) : null}
          </div>
          <p className="small muted">{t("This button works once, within 10 minutes.")}</p>
        </>
      ) : null}
      <p className="small muted">{t("OpenBanners doesn’t keep track of which Telegram account belongs to which Bannergress account.")}</p>
    </ObModal>
  );
}
