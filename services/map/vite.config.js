import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react";

// @ricky0123/vad-web and onnxruntime-web ship sourcemaps that point at source
// files they don't include in the published package — Vite warns on every
// request. The code itself works, so just drop those warnings.
const logger = createLogger();
const originalWarn = logger.warn;
logger.warn = (msg, options) => {
  if (
    typeof msg === "string" &&
    msg.includes("Sourcemap") &&
    (msg.includes("vad-web") || msg.includes("onnxruntime-web"))
  ) {
    return;
  }
  originalWarn(msg, options);
};

export default defineConfig({
  base: "/",
  plugins: [react()],
  customLogger: logger,
  // onnxruntime-web ships its own wasm + onnx assets and trips Vite's prebundler.
  optimizeDeps: {
    exclude: ["onnxruntime-web", "@ricky0123/vad-web"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
