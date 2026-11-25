// Orbit Web's app: built into dist/ and served by the API from the same origin, so the page and the API share one
// origin and the CSP can say 'self'. `npm run dev` proxies /api to an API on 127.0.0.1:3000.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const contracts = fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url));
const governance = fileURLToPath(new URL("../../packages/governance-core/src/index.ts", import.meta.url));
const API = process.env.ORBIT_WEB_API ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@orbit-web/contracts": contracts, "@orbit-web/governance-core": governance } },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 2000 },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: API, changeOrigin: true, configure: (proxy) => proxy.on("proxyReq", (req) => req.setHeader("origin", API)) } },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.{ts,tsx}"],
    setupFiles: ["src/testing/setup.ts"],
  },
});
