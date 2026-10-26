import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies API calls to the local Netlify Functions emulator so the
// browser only ever talks to one origin (works behind the Arena preview proxy
// and matches production behaviour where /api/* is served by Netlify).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Accept the Arena preview hostname (and any other host) — dev server only.
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8899",
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8899",
        changeOrigin: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          mui: ["@mui/material", "@mui/icons-material", "@emotion/react", "@emotion/styled"],
          hls: ["hls.js"],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.{js,jsx}",
      "server/**/*.test.js",
      "netlify/functions/**/*.test.js",
      "tests/**/*.test.{js,jsx}",
    ],
    testTimeout: 20000,
  },
});
