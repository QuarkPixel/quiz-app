import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// 在编译期计算题库哈希，取 SHA-1 前 8 字节（16 位 hex）
const questionsJson = readFileSync(
  resolve(__dirname, "assets/questions.json"),
  "utf-8",
);
const questionsHash = createHash("sha1")
  .update(questionsJson)
  .digest("hex")
  .slice(0, 16);

export default defineConfig({
  plugins: [svelte(), viteSingleFile({ useRecommendedBuildConfig: false })],
  define: {
    __QUESTIONS_HASH__: JSON.stringify(questionsHash),
  },
  build: {
    target: "esnext",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    // codeSplitting is not yet in vite's type definitions but exists at runtime in v8+
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    codeSplitting: false,
  } as any,
});