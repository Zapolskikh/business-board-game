import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

function git(command: string, fallback: string): string {
  try {
    return execSync(command, { encoding: "utf8" }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const sha = (process.env.VERCEL_GIT_COMMIT_SHA || git("git rev-parse --short HEAD", "dev")).slice(0, 8);
const revision = git("git rev-list --count HEAD", "0");
const dirty = git("git status --porcelain", "") ? "-dirty" : "";
const gameVersion = `0.1.${revision}+${sha}${dirty}`;

// The client talks to the FastAPI backend on :8000. In dev we proxy /api so the
// browser sees a same-origin URL and there are no CORS surprises.
export default defineConfig({
  plugins: [react()],
  define: { __GAME_VERSION__: JSON.stringify(gameVersion) },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
