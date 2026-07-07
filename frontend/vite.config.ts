import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client talks to the FastAPI backend on :8000. In dev we proxy /api so the
// browser sees a same-origin URL and there are no CORS surprises.
export default defineConfig({
  plugins: [react()],
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
