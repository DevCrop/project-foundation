import { defineConfig } from "vite";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

function pageEntries(directory: string, extension: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.posix.join(directory.replaceAll("\\", "/"), entry.name))
    .sort();
}

const entries = [
  "resource/ts/main.ts",
  "resource/scss/main.scss",
  ...pageEntries("resource/ts/pages", ".ts"),
  ...pageEntries("resource/scss/pages", ".scss"),
].filter((entry) => existsSync(entry));

export default defineConfig({
  publicDir: false,
  build: {
    manifest: true,
    outDir: "public/build",
    emptyOutDir: true,
    rollupOptions: {
      input: entries,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
