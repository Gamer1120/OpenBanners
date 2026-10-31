// Settings that follow a signed-in Bannergress account between devices
// (src/settingsSync.js does the syncing). This file has no imports, so the
// modules that own a setting can report a change without pulling in the
// sync code: call noteSettingChanged(name) right after writing it.
export const SETTING_CHANGED_EVENT = "openbanners:setting-changed";
// detail: { names } — values from another device were written to localStorage.
export const SYNCED_SETTINGS_APPLIED_EVENT = "openbanners:synced-settings-applied";

export function noteSettingChanged(name) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SETTING_CHANGED_EVENT, { detail: { name } }));
  }
}

// Re-reads a setting when another device's value arrives.
export function onSyncedSettingsApplied(names, callback) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = (event) => {
    if (!names || event.detail?.names?.some((name) => names.includes(name))) {
      callback(event.detail?.names ?? []);
    }
  };
  window.addEventListener(SYNCED_SETTINGS_APPLIED_EVENT, handler);
  return () => window.removeEventListener(SYNCED_SETTINGS_APPLIED_EVENT, handler);
}
