import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // domain: motor científico. db y lib: solo funciones puras (sin Dexie ni DOM).
    include: ["src/domain/**/*.test.ts", "src/db/**/*.test.ts", "src/lib/**/*.test.ts"],
    environment: "node",
  },
});
