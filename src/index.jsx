import React from "react";
import { ThemeProvider } from "@mui/material/styles";
import { buildAppTheme } from "./appTheme";
import { createRoot } from "react-dom/client";
import "./index.css";
import "leaflet/dist/leaflet.css";
import "./m3.css";
import { useThemeMode } from "./themeMode";
import App from "./App";

function ThemedApp() {
  const { resolvedMode } = useThemeMode();
  const theme = React.useMemo(() => buildAppTheme(resolvedMode), [resolvedMode]);

  return (
    <ThemeProvider theme={theme}>
      <App />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemedApp />
  </React.StrictMode>
);
