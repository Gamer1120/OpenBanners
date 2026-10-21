import { useEffect } from "react";

// OpenBanners is dark only. The old light/system choice is forgotten.
export const THEME_MODE_STORAGE_KEY = "openbanners-theme-mode";
const DARK_SURFACE = "#16161c";

export function useThemeMode() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(THEME_MODE_STORAGE_KEY);
    } catch {}

    document.documentElement.dataset.theme = "dark";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", DARK_SURFACE);
  }, []);

  return { mode: "dark", resolvedMode: "dark" };
}
