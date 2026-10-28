import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    // Bind to this computer only: patient records should not be reachable from the network.
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  // three.js makes the bundle large; this is a local app so that is fine.
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
