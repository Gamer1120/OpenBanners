import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    https: {
      cert: fs.readFileSync("/etc/letsencrypt/live/b.m5l.nl/fullchain.pem"),
      key: fs.readFileSync("/etc/letsencrypt/live/b.m5l.nl/privkey.pem"),
    },
    allowedHosts: ["openbanners.org"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return null;
          }

          if (
            id.includes("/@mui/") ||
            id.includes("/@emotion/") ||
            id.includes("/@popperjs/")
          ) {
            return "mui";
          }

          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router/") ||
            id.includes("/react-router-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react";
          }

          if (id.includes("/leaflet") || id.includes("/react-leaflet/")) {
            return "leaflet";
          }

          if (id.includes("/font-awesome/")) {
            return "fontawesome";
          }

          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
    css: true,
  },
});
