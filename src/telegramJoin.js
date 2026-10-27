import { requestBannergressAccessToken } from "./bannergressSync";

// Client for server/telegram-join.mjs ("Join on Telegram"). The Bannergress
// token goes along only so the server can check you're a verified agent; it
// never stores it, and nothing links the code to your account.
export const TELEGRAM_JOIN_BASE = "/_openbanners/telegram/v1";

async function call(path, { method = "GET", token = null } = {}) {
  const headers = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${TELEGRAM_JOIN_BASE}${path}`, { method, headers });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw Object.assign(new Error(result?.message || "Telegram join failed."), {
      code: result?.error ?? "unavailable",
      status: response.status,
    });
  }
  return result;
}

// { enabled, bot }
export const getTelegramJoinStatus = () => call("/status");

// { code, bot, url, expiresAt }; throws { code: "login_required" } without a login.
export async function requestTelegramJoinCode() {
  const token = await requestBannergressAccessToken().catch(() => null);
  if (!token) {
    throw Object.assign(new Error("Log in with Bannergress first."), { code: "login_required", status: 401 });
  }
  return call("/code", { method: "POST", token });
}
