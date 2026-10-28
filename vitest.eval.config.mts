import { defineConfig } from "vitest/config";
import path from "node:path";

// Make .env.local (GEMINI_API_KEY etc.) visible to the live evaluation.
try {
  process.loadEnvFile(path.join(import.meta.dirname, ".env.local"));
} catch {
  // No .env.local: the eval will report the missing key.
}

// Separate config so `npm test` never touches the live API.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["lib/**/*.eval.ts"],
    testTimeout: 180_000,
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
