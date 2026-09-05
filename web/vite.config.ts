import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The configure UI is shipped as pre-built assets inside `dist/`, so a plain
 * `npm install -g synaphex` can serve it with no checkout and no dev server.
 * Sourcemaps are off to match the package's release policy.
 */
export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  base: "/",
  build: {
    outDir: "../dist/configure/web",
    emptyOutDir: true,
    sourcemap: false,
    // A single entry keeps the served surface small and predictable.
    rollupOptions: { output: { manualChunks: undefined } },
  },
});
