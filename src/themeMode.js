import { useEffect, useState } from "react";

export const THEME_MODE_STORAGE_KEY = "openbanners-theme-mode";
export const THEME_MODES = ["system", "light", "dark"];
const THEME_MODE_CHANGE_EVENT = "openbanners:theme-mode-change";

export function readThemeMode() {
  try {
    const storedValue = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return THEME_MODES.includes(storedValue) ? storedValue : "system";
  } catch {
    return "system";
  }
}

export function saveThemeMode(mode) {
  try {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {}

  window.dispatchEvent(new Event(THEME_MODE_CHANGE_EVENT));
}

function prefersDark() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveThemeMode(mode) {
  if (mode === "light" || mode === "dark") {
    return mode;
  }

  return prefersDark() ? "dark" : "light";
}

export function useThemeMode() {
  const [mode, setMode] = useState(readThemeMode);
  const [resolvedMode, setResolvedMode] = useState(() =>
    resolveThemeMode(readThemeMode())
  );

  useEffect(() => {
    const update = () => {
      const nextMode = readThemeMode();
      setMode(nextMode);
      setResolvedMode(resolveThemeMode(nextMode));
    };
    const mediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    window.addEventListener(THEME_MODE_CHANGE_EVENT, update);
    window.addEventListener("storage", update);
    mediaQuery?.addEventListener?.("change", update);

    return () => {
      window.removeEventListener(THEME_MODE_CHANGE_EVENT, update);
      window.removeEventListener("storage", update);
      mediaQuery?.removeEventListener?.("change", update);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedMode;
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');

    if (themeColorMeta) {
      themeColorMeta.setAttribute(
        "content",
        resolvedMode === "dark" ? "#16161c" : "#f8f7fc"
      );
    }
  }, [resolvedMode]);

  return { mode, resolvedMode };
}
