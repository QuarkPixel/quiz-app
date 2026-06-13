#!/usr/bin/env node
/**
 * vite 的薄封装：解析 --bundled [path]，把模式与路径塞进环境变量，再 spawn vite。
 *
 * 用法：
 *   node scripts/cli.js dev                       → Library 模式
 *   node scripts/cli.js dev -- --bundled          → Bundled，默认 banks/questions.example.json
 *   node scripts/cli.js dev -- --bundled path.json
 *   node scripts/cli.js build                     → Library 模式
 *   node scripts/cli.js build -- --bundled        → Bundled，默认 banks/questions.json
 *   node scripts/cli.js build -- --bundled path.json
 *   node scripts/cli.js preview                   → Library 模式
 *
 * vite.config.ts 通过 process.env.QUIZ_MODE / QUIZ_BUNDLED_PATH 读取。
 */
import { spawn } from "node:child_process";
import { resolve, dirname, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

function appendNodeOption(env, option) {
  if (!process.allowedNodeEnvironmentFlags.has(option)) return;

  const current = env.NODE_OPTIONS?.trim();
  if (!current) {
    env.NODE_OPTIONS = option;
    return;
  }
  if (current.split(/\s+/).includes(option)) return;
  env.NODE_OPTIONS = `${current} ${option}`;
}

const [, , subcommand, ...rest] = process.argv;
if (!subcommand || !["dev", "build", "preview"].includes(subcommand)) {
  console.error(
    `用法: node scripts/cli.js <dev|build|preview> [-- --bundled [path]]`,
  );
  process.exit(1);
}

// `--bundled` 是这个 wrapper 的 flag；走包管理器脚本时建议用 `--` 显式转发：
// `pnpm dev -- --bundled`。如果用户
// 出于谨慎用了 `pnpm dev -- -- --bundled`，第一个 '--' 是 sep，去掉就行。
const args = rest[0] === "--" ? rest.slice(1) : rest;

const bundledIdx = args.indexOf("--bundled");
const isBundled = bundledIdx !== -1;

let bundledPath = null;
if (isBundled) {
  const next = args[bundledIdx + 1];
  if (next && !next.startsWith("--")) {
    bundledPath = next;
  } else {
    bundledPath =
      subcommand === "dev"
        ? "banks/questions.example.json"
        : "banks/questions.json";
  }
  const absPath = isAbsolute(bundledPath)
    ? bundledPath
    : resolve(projectRoot, bundledPath);
  if (!existsSync(absPath)) {
    console.error(`[cli] 找不到题库文件: ${absPath}`);
    process.exit(1);
  }
  bundledPath = absPath;
}

const env = { ...process.env };
if (isBundled) {
  env.QUIZ_MODE = "bundled";
  env.QUIZ_BUNDLED_PATH = bundledPath;
} else {
  env.QUIZ_MODE = "library";
  delete env.QUIZ_BUNDLED_PATH;
}
// Tailwind 4.3 uses module.register internally. Node 26 warns on that API while
// Tailwind has not moved to registerHooks yet; suppress only this warning code.
appendNodeOption(env, "--disable-warning=DEP0205");

const viteArgs = subcommand === "dev" ? [] : [subcommand];
const viteBin = resolve(projectRoot, "node_modules/.bin/vite");

const child = spawn(viteBin, viteArgs, {
  env,
  stdio: "inherit",
  cwd: projectRoot,
});
child.on("exit", (code) => process.exit(code ?? 0));

process.on("SIGINT", () => {
  child.kill("SIGINT");

  setTimeout(() => {
    process.exit(0);
  }, 50);
});
