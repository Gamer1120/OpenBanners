import { getLanguage } from "./i18n";
import { call } from "./passphraseApi";

// Account data kept by the passphrase service:
// - "Download my data" (server/data-export.mjs): GET /export says when the
//   next one is possible, POST /export returns the file (once an hour).
// - The OpenBanners Overlay settings backup (server/overlay-backup.mjs): the
//   site shows its date and can delete it; /overlay/connect gives the app a
//   one-time code (POST /overlay/link) for its own short-lived access.

export const getExportStatus = () => call("/export");

// Fetches the export and saves it as a file. Resolves to { nextExportAt }.
// A refused one (once an hour) rejects with error.code "export_limit" and
// error.data.nextExportAt.
export async function downloadMyData({ win = window } = {}) {
  const data = await call("/export", { method: "POST" });
  const date = String(data.exportedAt || new Date().toISOString()).slice(0, 10);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = win.URL.createObjectURL(blob);
  const link = win.document.createElement("a");
  link.href = url;
  link.download = `openbanners-data-${date}.json`;
  link.rel = "noopener";
  win.document.body.appendChild(link);
  link.click();
  link.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(url), 60 * 1000);
  return { nextExportAt: data.dataExports?.nextExportAt ?? null, data };
}

export const getOverlayBackup = () => call("/overlay/backup");
export const deleteOverlayBackup = () => call("/overlay/backup", { method: "DELETE" });
export const createOverlayLink = (challenge) => call("/overlay/link", { method: "POST", body: { challenge } });

// "14:05" today, else "1 Nov, 14:05", in the reader's language and time zone.
export function formatLocalTime(iso, now = new Date()) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) {
    return "";
  }
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(getLanguage(), sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatLocalDate(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// /overlay/connect?action=backup|restore&challenge=<43>&state=<16-64>
export function parseOverlayConnect(search) {
  const params = new URLSearchParams(search || "");
  const action = params.get("action");
  const challenge = params.get("challenge") || "";
  const state = params.get("state") || "";
  if (!["backup", "restore"].includes(action) || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !/^[A-Za-z0-9_-]{16,64}$/.test(state)) {
    return null;
  }
  return { action, challenge, state };
}

// Back to the app (v51+): openbanners-overlay://link?code=…&state=…. Chrome on
// Android gets an intent: link, so an Overlay without the link handler (or none
// at all) lands on the fallback page, which says to install or update it.
export function buildOverlayReturnLinks({ code, state, origin, search }) {
  const query = new URLSearchParams({ code, state }).toString();
  const fallbackParams = new URLSearchParams(search || "");
  fallbackParams.set("overlay", "missing");
  const fallback = `${origin}/overlay/connect?${fallbackParams.toString()}`;
  return {
    link: `openbanners-overlay://link?${query}`,
    intent: `intent://link?${query}#Intent;scheme=openbanners-overlay;package=org.openbanners.overlay;S.browser_fallback_url=${encodeURIComponent(fallback)};end`,
  };
}
