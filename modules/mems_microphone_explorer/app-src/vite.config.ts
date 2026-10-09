import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Built into ../web so the portal can serve it as a plain static plugin (relative base).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
