import React from "react";
import { createTheme, ThemeProvider } from "@mui/material";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

const theme = createTheme({
  palette: {
    mode: "dark", // Apply dark theme
  },
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
