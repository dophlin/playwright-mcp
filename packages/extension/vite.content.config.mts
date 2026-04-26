import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const extRoot = __dirname;

export default defineConfig({
  envDir: extRoot,
  root: extRoot,
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist/"),
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: {
        recorderContent: resolve(extRoot, "src/content/recorderContent.ts"),
        dashboardHandoff: resolve(extRoot, "src/content/dashboardHandoff.ts"),
      },
      output: {
        entryFileNames: "lib/content/[name].mjs",
        format: "es",
        chunkFileNames: "lib/content/chunks/[name].mjs",
      },
    },
  },
});
