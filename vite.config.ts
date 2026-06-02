import { defineConfig, type Plugin } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { validateQuestions } from "./src/lib/validateQuestions";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─── 模式判定（由 scripts/cli.js 注入的环境变量决定） ──────────────────────────
type Mode = "bundled" | "library";
const isTest = process.env.NODE_ENV === "test";

const mode: Mode = process.env.QUIZ_MODE === "bundled" ? "bundled" : "library";

function resolveBundledPath(): string {
  const raw = process.env.QUIZ_BUNDLED_PATH ?? "banks/questions.json";
  return isAbsolute(raw) ? raw : resolve(__dirname, raw);
}

function computeHash(json: string): string {
  return createHash("sha1").update(json).digest("hex").slice(0, 16);
}

// 仅 bundled 模式下读题库 + 算 hash；测试环境用固定 hash 避免依赖 fs
let bundledJsonText = "[]";
let bundledHash: string = "test";
const bundledPath = resolveBundledPath();

if (mode === "bundled" && !isTest) {
  bundledJsonText = readFileSync(bundledPath, "utf-8");

  // 用共享的 validateQuestions 把关：结构非法直接终止构建
  let parsed: unknown;
  try {
    parsed = JSON.parse(bundledJsonText);
  } catch (e) {
    throw new Error(`[quiz-app] 题库不是合法 JSON: ${bundledPath}\n${(e as Error).message}`);
  }
  const result = validateQuestions(parsed);
  if (!result.ok) {
    throw new Error(
      `[quiz-app] 题库校验失败 (${bundledPath}):\n${result.errors.map((e) => "  " + e).join("\n")}`,
    );
  }
  // 用规范化（minified）形式 hash：和 library 模式、导出回灌走同一算法
  bundledHash = computeHash(JSON.stringify(parsed));
}

const bundledOutputName = `bundled-${bundledHash}.html`;

// ─── 构建产物重命名 ──────────────────────────────────────────────────────────
/**
 * bundled 模式把 dist/index.html 重命名为 bundled-<hash>.html。
 * preview 通过 preview.open 自动打开此文件。
 */
function renameOutput(): Plugin {
  return {
    name: "rename-output",
    apply: "build",
    closeBundle() {
      const src = resolve(__dirname, "dist/index.html");
      const dst = resolve(__dirname, "dist", bundledOutputName);
      renameSync(src, dst);
    },
  };
}

// ─── alias ───────────────────────────────────────────────────────────────────
/**
 * `$bundled-bank` 别名：
 *   - bundled 模式：解析为用户指定的 JSON 路径（vite 会按 JSON 类型导入）
 *   - library 模式：解析为占位空数组，BundledSource 整个会被 tree-shake 掉
 */
const bundledBankAlias =
  mode === "bundled"
    ? bundledPath
    : resolve(__dirname, "src/source/empty-bank.json");

const appRootAlias = resolve(
  __dirname,
  mode === "bundled" ? "src/App.bundled.svelte" : "src/App.library.svelte",
);

const quizSourceAlias = resolve(
  __dirname,
  mode === "bundled"
    ? "src/source/mode-bundled.ts"
    : "src/source/mode-library.ts",
);

const soundAlias = resolve(
  __dirname,
  mode === "bundled" ? "src/sound/noop.ts" : "src/sound/library.ts",
);

const soundSettingsAlias = resolve(
  __dirname,
  mode === "bundled"
    ? "src/components/sound/SoundSettings.bundled.svelte"
    : "src/components/sound/SoundSettings.library.svelte",
);

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    ...(mode === "bundled"
      ? [viteSingleFile({ useRecommendedBuildConfig: false }), renameOutput()]
      : []),
  ],
  resolve: {
    alias: {
      $lib: resolve(__dirname, "src/lib"),
      "$app-root": appRootAlias,
      "$bundled-bank": bundledBankAlias,
      "$quiz-source": quizSourceAlias,
      $sound: soundAlias,
      "$sound-settings": soundSettingsAlias,
    },
  },
  define: {
    __QUIZ_MODE__: JSON.stringify(mode),
    __QUESTIONS_HASH__: JSON.stringify(mode === "bundled" ? bundledHash : null),
  },
  preview: {
    open: mode === "bundled" ? `/${bundledOutputName}` : "/",
  },
  optimizeDeps: {
    // vite v8 / rolldown 与 vite-plugin-svelte 的 optimize-svelte 子插件不兼容：
    // 后者会在 dep scan 阶段对 .svelte.ts 文件直接调用 svelte.compileModule，
    // 不经过 TS 预处理 → AggregateError。
    // 关掉自动发现，依然保留 svelte plugin 自动注入的 include 列表，dev 仍可正常工作。
    noDiscovery: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "happy-dom",
    setupFiles: ["./tests/_setup.ts"],
  },
  build: {
    target: "esnext",
    cssCodeSplit: mode === "bundled" ? false : true,
    assetsInlineLimit: mode === "bundled" ? 100000000 : 0,
    // codeSplitting is not yet in vite's type definitions but exists at runtime in v8+.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    codeSplitting: mode === "bundled" ? false : true,
  } as any,
});
