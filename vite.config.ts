import { defineConfig, type Plugin } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Vite 插件：校验题库中是否存在以 '^' 开头的 ID。
 * '^' 是进度编码的保留前缀，ID 不得以其开头。
 * 在 dev 模式（configureServer）和 build 模式（buildStart）均会触发校验。
 */
function validateQuestionIds(): Plugin {
  const questionsPath = resolve(__dirname, "assets/questions.json");

  function check() {
    let questions: Array<{ id?: unknown }>;
    try {
      questions = JSON.parse(readFileSync(questionsPath, "utf-8"));
    } catch {
      return; // JSON 解析失败留给其他地方处理
    }
    const bad = questions
      .map((q, i) => ({ index: i, id: q.id }))
      .filter((q) => typeof q.id === "string" && (q.id as string).startsWith("^"));

    if (bad.length > 0) {
      const list = bad.map((q) => `  [${q.index}] id: "${q.id}"`).join("\n");
      throw new Error(
        `[quiz-app] 题库 ID 校验失败：以下题目的 id 以保留字符 '^' 开头，请修改后重试。\n${list}`,
      );
    }
  }

  return {
    name: "validate-question-ids",
    buildStart() {
      check();
    },
    configureServer(server) {
      // dev 模式：启动时立即检查
      check();
      // 监听题库文件变动，变动时重新检查
      server.watcher.add(questionsPath);
      server.watcher.on("change", (file) => {
        if (resolve(file) === questionsPath) {
          try {
            check();
          } catch (e) {
            // dev 模式下打印错误而不是崩溃
            server.config.logger.error((e as Error).message);
          }
        }
      });
    },
  };
}

// 在编译期计算题库哈希，取 SHA-1 前 8 字节（16 位 hex）
const isTest = process.env.NODE_ENV === "test";
const questionsHash = isTest
  ? "test"
  : createHash("sha1")
      .update(readFileSync(resolve(__dirname, "assets/questions.json"), "utf-8"))
      .digest("hex")
      .slice(0, 16);

export default defineConfig({
  plugins: [tailwindcss(), validateQuestionIds(), svelte(), viteSingleFile({ useRecommendedBuildConfig: false })],
  resolve: {
    alias: {
      $lib: resolve(__dirname, "src/lib"),
    },
  },
  define: {
    __QUESTIONS_HASH__: JSON.stringify(questionsHash),
  },
  test: {
    include: ["tests/**/*.test.ts"],
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