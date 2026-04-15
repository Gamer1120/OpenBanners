import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
