import React from "react";
import { ThemeProvider } from "@mui/material/styles";
import { buildAppTheme } from "./appTheme";
import { createRoot } from "react-dom/client";
import "./index.css";
import "leaflet/dist/leaflet.css";
import "./m3.css";
import { useThemeMode } from "./themeMode";
import App from "./App";
import { i18nReady, useT } from "./i18n";
import { registerServiceWorker } from "./pwaInstall";

registerServiceWorker();

function ThemedApp() {
  const { resolvedMode } = useThemeMode();
  const theme = React.useMemo(() => buildAppTheme(resolvedMode), [resolvedMode]);
  // A new language re-renders every text: remount the app (it keeps its URL).
  const { language } = useT();

  return (
    <ThemeProvider theme={theme}>
      <App key={language} />
    </ThemeProvider>
  );
}

i18nReady.then(() =>
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <ThemedApp />
    </React.StrictMode>
  )
);
