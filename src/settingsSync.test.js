import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTRO_DISMISSED_STORAGE_KEY,
  RECENT_PLANS_STORAGE_KEY,
  SYNCED_SETTING_NAMES,
  VIEW_MODE_STORAGE_KEY,
  emptyMeta,
  joinRecentPlans,
  mergeSettings,
  settlePush,
  trackLocalValue,
} from "./settingsSync";
import { INTRO_DISMISSED_STORAGE_KEY as INTRO_KEY } from "./components/FirstVisitIntro";
import { VIEW_MODE_STORAGE_KEY as VIEW_KEY } from "./components/ViewModeToggle";
import { RECENT_KEY } from "./missionPlans";

const none = () => Object.fromEntries(SYNCED_SETTING_NAMES.map((name) => [name, null]));
const meta = (changes = {}) => ({ ...emptyMeta(), ...changes });
const plan = (id, openedAt) => ({ id: `plan-${id}-xxxxxxxx`, title: id, missions: 6, readOnly: false, openedAt });

describe("settings sync merge", () => {
  it("uses the same storage keys as the modules that own the settings", () => {
    expect(INTRO_DISMISSED_STORAGE_KEY).toBe(INTRO_KEY);
    expect(VIEW_MODE_STORAGE_KEY).toBe(VIEW_KEY);
    expect(RECENT_PLANS_STORAGE_KEY).toBe(RECENT_KEY);
  });

  it("first device: uploads what it has, with unknown times as 0", () => {
    const local = { ...none(), language: "nl", viewMode: "compact" };
    const result = mergeSettings({ local, meta: meta({ changed: { viewMode: 500 } }), server: {}, now: 1000 });
    expect(result.apply).toEqual({});
    expect(result.push).toEqual({ language: { value: "nl", changedAt: 0 }, viewMode: { value: "compact", changedAt: 500 } });
  });

  it("new device: the account's values win over values this device never changed", () => {
    const local = { ...none(), language: "en", mapRowFolded: false };
    const server = { language: { value: "nl", changedAt: 100 }, viewMode: { value: "compact", changedAt: 90 } };
    const result = mergeSettings({ local, meta: meta(), server, now: 1000 });
    expect(result.apply).toEqual({ language: "nl", viewMode: "compact" });
    // Not on the server yet: this device's value goes up.
    expect(result.push).toEqual({ mapRowFolded: { value: false, changedAt: 0 } });
    expect(result.synced).toMatchObject({ language: 100, viewMode: 90 });
  });

  it("new device: a change made here after the account's one wins", () => {
    const local = { ...none(), language: "de" };
    const server = { language: { value: "nl", changedAt: 100 } };
    expect(mergeSettings({ local, meta: meta({ changed: { language: 200 } }), server, now: 1000 }).push).toEqual({
      language: { value: "de", changedAt: 200 },
    });
    expect(mergeSettings({ local, meta: meta({ changed: { language: 50 } }), server, now: 1000 }).apply).toEqual({ language: "nl" });
  });

  it("after syncing: takes newer server values, sends newer local ones", () => {
    const synced = { language: 100, viewMode: 100 };
    const local = { ...none(), language: "nl", viewMode: "compact" };
    // Server moved, this device didn't.
    let result = mergeSettings({
      local,
      meta: meta({ synced, changed: { language: 100, viewMode: 100 } }),
      server: { language: { value: "fr", changedAt: 300 }, viewMode: { value: "compact", changedAt: 100 } },
      now: 1000,
    });
    expect(result.apply).toEqual({ language: "fr" });
    expect(result.push).toEqual({});
    // This device moved, the server didn't.
    result = mergeSettings({
      local,
      meta: meta({ synced, changed: { language: 100, viewMode: 400 } }),
      server: { language: { value: "nl", changedAt: 100 }, viewMode: { value: "visual", changedAt: 100 } },
      now: 1000,
    });
    expect(result.apply).toEqual({});
    expect(result.push).toEqual({ viewMode: { value: "compact", changedAt: 400 } });
  });

  it("conflict: both changed since the last sync, the later change wins", () => {
    const local = { ...none(), viewMode: "compact" };
    const base = meta({ synced: { viewMode: 100 } });
    const server = { viewMode: { value: "visual", changedAt: 300 } };
    expect(mergeSettings({ local, meta: { ...base, changed: { viewMode: 200 } }, server, now: 1000 }).apply).toEqual({ viewMode: "visual" });
    expect(mergeSettings({ local, meta: { ...base, changed: { viewMode: 400 } }, server, now: 1000 }).push).toEqual({
      viewMode: { value: "compact", changedAt: 400 },
    });
  });

  it("a cleared value (no picked city) syncs as null", () => {
    const result = mergeSettings({
      local: none(),
      meta: meta({ synced: { city: 100 }, changed: { city: 200 } }),
      server: { city: { value: { id: "c1", shortName: "Enschede" }, changedAt: 100 } },
      now: 1000,
    });
    expect(result.push).toEqual({ city: { value: null, changedAt: 200 } });
  });

  it("recent plans of two devices that both changed are joined, newest first", () => {
    const local = { ...none(), recentPlans: [plan("b", 50), plan("a", 10)] };
    const server = { recentPlans: { value: [plan("c", 60), plan("a", 30)], changedAt: 70 } };
    const result = mergeSettings({ local, meta: meta(), server, now: 1000 });
    const joined = [plan("c", 60), plan("b", 50), plan("a", 30)];
    expect(result.apply.recentPlans).toEqual(joined);
    expect(result.push.recentPlans).toEqual({ value: joined, changedAt: 1000 });
    expect(joinRecentPlans(Array.from({ length: 15 }, (_, i) => plan(`x${i}`, i)), Array.from({ length: 15 }, (_, i) => plan(`y${i}`, i)))).toHaveLength(20);
  });

  it("only explicit changes get a time; seeing a value first doesn't", () => {
    const state = meta();
    expect(trackLocalValue(state, "language", "nl")).toBe(false);
    expect(state.changed.language).toBeUndefined();
    expect(trackLocalValue(state, "language", "nl", { explicit: true, at: 5 })).toBe(false);
    expect(trackLocalValue(state, "language", "de", { explicit: true, at: 7 })).toBe(true);
    expect(state.changed.language).toBe(7);
  });

  it("after a push, keeps what the server kept", () => {
    const push = { language: { value: "nl", changedAt: 500 }, viewMode: { value: "compact", changedAt: 400 } };
    const response = { language: { value: "nl", changedAt: 450 }, viewMode: { value: "visual", changedAt: 600 } };
    const settled = settlePush({ push, response, meta: meta() });
    expect(settled.synced).toEqual({ language: 500, viewMode: 600 });
    expect(settled.apply).toEqual({ viewMode: "visual" });
  });
});

describe("settings sync in the browser", () => {
  let fetchMock;
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("signed out it sends nothing, and a failed sync leaves the settings alone", async () => {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "compact");
    const sync = await import("./settingsSync");
    sync.startSettingsSync();
    await sync.syncSettingsNow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe("compact");

    // Signed in, offline.
    window.localStorage.setItem(
      "openbanners-bannergress-auth",
      JSON.stringify({ accessToken: "a.b.c", refreshToken: "r", expiresAt: Date.now() + 3600e3, refreshExpiresAt: Date.now() + 7200e3 })
    );
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await sync.syncSettingsNow();
    expect(fetchMock).toHaveBeenCalled();
    expect(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe("compact");
  });

  it("signed in: loads the account's settings, sends local changes, and can remove them", async () => {
    window.localStorage.setItem(
      "openbanners-bannergress-auth",
      JSON.stringify({ accessToken: "a.b.c", refreshToken: "r", expiresAt: Date.now() + 3600e3, refreshExpiresAt: Date.now() + 7200e3 })
    );
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "visual");
    const now = Date.now();
    let stored = { viewMode: { value: "compact", changedAt: now - 1000 }, introDismissed: { value: true, changedAt: now - 1000 } };
    let enabled = true;
    const requests = [];
    fetchMock.mockImplementation(async (url, options = {}) => {
      const method = options.method ?? "GET";
      requests.push({ url, method, body: options.body ? JSON.parse(options.body) : null, auth: options.headers?.Authorization });
      if (method === "PUT") {
        enabled = true;
        for (const [name, entry] of Object.entries(JSON.parse(options.body).settings)) {
          stored = { ...stored, [name]: entry };
        }
      }
      if (method === "DELETE") {
        enabled = false;
        stored = {};
      }
      return { ok: true, status: 200, json: async () => ({ account: "acc1", enabled, now: Date.now(), settings: stored }) };
    });
    const sync = await import("./settingsSync");
    const { noteSettingChanged } = await import("./settingsSyncState");
    const applied = vi.fn();
    window.addEventListener("openbanners:synced-settings-applied", applied);

    await sync.syncSettingsNow();
    expect(requests[0]).toMatchObject({ url: "/_openbanners/passphrases/v1/preferences", method: "GET", auth: "Bearer a.b.c" });
    // The account's Wall/List choice and closed intro arrive; nothing local was changed on purpose.
    expect(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe("compact");
    expect(window.localStorage.getItem(INTRO_DISMISSED_STORAGE_KEY)).toBe("1");
    expect(applied).toHaveBeenCalled();
    expect(requests.some((request) => request.method === "PUT")).toBe(false);

    // A change here goes up (debounced in the app; started by hand here).
    sync.startSettingsSync();
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "visual");
    noteSettingChanged("viewMode");
    await sync.syncSettingsNow();
    const put = requests.find((request) => request.method === "PUT");
    expect(put.body.settings).toEqual({ viewMode: { value: "visual", changedAt: expect.any(Number) } });
    expect(stored.viewMode.value).toBe("visual");

    await sync.removeSyncedSettings();
    expect(requests.at(-1).method).toBe("DELETE");
    expect(sync.readSyncMeta().off).toBe(true);
    // Removing keeps this device's own settings.
    expect(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe("visual");
    // While off, changes stay here.
    const count = requests.length;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "compact");
    noteSettingChanged("viewMode");
    await sync.syncSettingsNow();
    expect(requests.slice(count).every((request) => request.method === "GET")).toBe(true);
    window.removeEventListener("openbanners:synced-settings-applied", applied);
  });
});
