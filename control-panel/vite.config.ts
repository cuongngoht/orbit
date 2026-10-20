// The production build goes straight into the Control Server's public/ -- the
// only directory it serves -- so running Orbit Control never needs Vite, React
// or any package from this folder.
//
// `npm run dev` serves the page from Vite and proxies /api to a running
// control-server started with a FIXED port (see README.md). The server accepts
// a change only from its own origin, so the proxy presents that origin; the
// token still has to come from the URL the server printed.
//
// The build is committed, so it is written IDEMPOTENTLY: a file whose bytes did
// not change is not touched, and a file the new build no longer emits is removed.
// Rebuilding the same source therefore leaves the tree exactly as it was -- which
// is what lets a declared `build` check count in an autonomous engineering task,
// where a check only counts on a tree it did not move (AGENTS.md, ADR 0019).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin, Rollup } from "vite";
import { defineConfig } from "vitest/config";

const API = process.env.ORBIT_CONTROL_API ?? "http://127.0.0.1:7317";

const OUT_DIR = fileURLToPath(new URL("../control-server/public", import.meta.url));

const bytesOf = (item: Rollup.OutputChunk | Rollup.OutputAsset): Uint8Array => (item.type === "chunk" ? Buffer.from(item.code) : typeof item.source === "string" ? Buffer.from(item.source) : item.source);

function writeIfChanged(path: string, bytes: Uint8Array): void {
  if (existsSync(path) && Buffer.compare(readFileSync(path), bytes) === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

const filesUnder = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)) : []);

// Vite's own writer rewrites every file; this one writes only what changed.
function writeChangedOnly(outDir: string): Plugin {
  return {
    name: "orbit-write-changed-only",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const items = Object.values(bundle);
        const kept = new Set(items.map((item) => join(outDir, item.fileName)));
        for (const item of items) writeIfChanged(join(outDir, item.fileName), bytesOf(item));
        for (const stale of filesUnder(outDir).filter((path) => !kept.has(path))) rmSync(stale);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), writeChangedOnly(OUT_DIR)],
  build: {
    outDir: OUT_DIR,
    // Vite writes nothing itself: writeChangedOnly does, file by file.
    write: false,
    emptyOutDir: false,
    sourcemap: false,
    // One bundle, served from localhost: splitting Fluent UI into chunks would
    // buy nothing a person on this machine could notice.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: API,
        changeOrigin: true,
        configure: (proxy) => proxy.on("proxyReq", (req) => req.setHeader("origin", API)),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["src/setupTests.ts"],
  },
});
