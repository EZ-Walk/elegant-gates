import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Docker map-ui service sets this so /api proxies to the map container.
const apiProxyTarget = process.env.API_PROXY_TARGET || "http://127.0.0.1:3000";

export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
