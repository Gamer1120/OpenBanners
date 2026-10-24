import { useCallback, useEffect, useState } from "react";
import { useBannergressAuth } from "./bannergressSync";
import { call } from "./passphraseApi";

// Personal banner notes, kept by the passphrase service per Bannergress account.
export const MAX_NOTE_LENGTH = 10000;

const notePath = (bannerId) => `/notes/banners/${encodeURIComponent(bannerId)}`;

// { status: "idle" | "loading" | "ready" | "error", text, updatedAt, error, loggedIn, save }
export function useBannerNote(bannerId) {
  const auth = useBannergressAuth();
  const loggedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const [state, setState] = useState({ status: "idle", text: "", updatedAt: null, error: "" });

  useEffect(() => {
    if (!loggedIn || !bannerId) {
      setState({ status: "idle", text: "", updatedAt: null, error: "" });
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, status: current.status === "ready" ? "ready" : "loading" }));
    call(notePath(bannerId)).then(
      (result) =>
        !cancelled && setState({ status: "ready", text: result.note?.text ?? "", updatedAt: result.note?.updatedAt ?? null, error: "" }),
      (error) => !cancelled && setState({ status: "error", text: "", updatedAt: null, error: error.message })
    );
    return () => {
      cancelled = true;
    };
  }, [bannerId, loggedIn]);

  const save = useCallback(
    async (text) => {
      const result = await call(notePath(bannerId), { method: "POST", body: { text } });
      setState({ status: "ready", text: result.note?.text ?? "", updatedAt: result.note?.updatedAt ?? null, error: "" });
    },
    [bannerId]
  );

  return { ...state, loggedIn, save };
}
