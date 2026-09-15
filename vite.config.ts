import { defineConfig, type Plugin } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const isTest = process.env.NODE_ENV === "test";
const isCheck = process.env.npm_lifecycle_event === "check";

const faviconPath = resolve(__dirname, "assets/icons/icon.svg");
const appleTouchIconPath = resolve(
  __dirname,
  "assets/icons/apple-touch-icon.png",
);
const pwaIcon192Path = resolve(__dirname, "assets/icons/pwa-192.png");
const pwaIcon512Path = resolve(__dirname, "assets/icons/pwa-512.png");

// ─── HTML 常量注入 ───────────────────────────────────────────────────────────
function injectIntoHead(html: string, tags: string[]): string {
  return html.replace(
    /\s*<\/head>/,
    `\n${tags.map((tag) => `        ${tag}`).join("\n")}\n    </head>`,
  );
}

function createHeadAssetTags(options: {
  faviconHref: string;
  appleTouchIconHref?: string;
  manifestHref?: string;
}): string[] {
  const tags = [
    `<link rel="icon" type="image/svg+xml" href="${options.faviconHref}" />`,
  ];

  if (options.appleTouchIconHref) {
    tags.push(
      `<link rel="apple-touch-icon" sizes="180x180" href="${options.appleTouchIconHref}" />`,
    );
  }

  if (options.manifestHref) {
    tags.push(`<link rel="manifest" href="${options.manifestHref}" />`);
  }

  return tags;
}

function createMobileMetaTags(): string[] {
  return [
    `<meta name="description" content="中文题库刷题应用" />`,
    `<meta name="application-name" content="Quiz! aPP." />`,
    `<meta name="apple-mobile-web-app-title" content="Quiz" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<meta name="mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="default" />`,
    `<meta name="format-detection" content="telephone=no,email=no,address=no" />`,
    `<meta name="color-scheme" content="light dark" />`,
    `<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />`,
    `<meta name="theme-color" content="#171717" media="(prefers-color-scheme: dark)" />`,
  ];
}

function enhanceViewportForMobile(html: string): string {
  return html.replace(
    /<meta\s+name="viewport"[\s\S]*?\/>/,
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`,
  );
}

function createWebManifest(options: {
  appHref: string;
  icon192Href: string;
  icon512Href: string;
}): string {
  return JSON.stringify(
    {
      name: "Quiz! aPP.",
      short_name: "Quiz",
      description: "中文题库刷题应用",
      lang: "zh-CN",
      start_url: options.appHref,
      scope: options.appHref,
      display: "standalone",
      orientation: "portrait",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      icons: [
        {
          src: options.icon192Href,
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: options.icon512Href,
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    },
    null,
    2,
  );
}

function injectWebAppAssets(): Plugin {
  let command: "build" | "serve" = "build";
  let base = "/";

  function outputHref(fileName: string): string {
    if (base === "" || base === "./") return fileName;
    return `${base}${fileName}`;
  }

  function appHref(): string {
    if (base === "" || base === "./") return "../";
    return base.endsWith("/") ? base : `${base}/`;
  }

  return {
    name: "inject-web-app-assets",
    configResolved(config) {
      command = config.command;
      base = config.base;
    },
    buildStart() {
      if (command !== "build") return;

      this.emitFile({
        type: "asset",
        fileName: "assets/icons/icon.svg",
        source: readFileSync(faviconPath),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/icons/apple-touch-icon.png",
        source: readFileSync(appleTouchIconPath),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/icons/pwa-192.png",
        source: readFileSync(pwaIcon192Path),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/icons/pwa-512.png",
        source: readFileSync(pwaIcon512Path),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/site.webmanifest",
        source: createWebManifest({
          appHref: appHref(),
          icon192Href: outputHref("assets/icons/pwa-192.png"),
          icon512Href: outputHref("assets/icons/pwa-512.png"),
        }),
      });
    },
    transformIndexHtml(html) {
      return injectIntoHead(enhanceViewportForMobile(html), [
        ...createMobileMetaTags(),
        ...createHeadAssetTags({
          faviconHref:
            command === "serve"
              ? "/assets/icons/icon.svg"
              : outputHref("assets/icons/icon.svg"),
          appleTouchIconHref:
            command === "serve"
              ? "/assets/icons/apple-touch-icon.png"
              : outputHref("assets/icons/apple-touch-icon.png"),
          manifestHref:
            command === "serve"
              ? "/assets/site.webmanifest"
              : outputHref("assets/site.webmanifest"),
        }),
      ]);
    },
  };
}

async function loadTailwindPlugins(): Promise<Plugin[]> {
  if (isTest || isCheck) return [];

  const { default: tailwindcss } = await import("@tailwindcss/vite");
  return tailwindcss();
}

export default defineConfig(async () => ({
  plugins: [
    ...(await loadTailwindPlugins()),
    svelte(),
    injectWebAppAssets(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      $lib: resolve(__dirname, "src/lib"),
    },
    // 测试里要 mount 组件，必须解析到 Svelte 的**浏览器**构建
    // （默认的 node 条件会拿到 index-server.js，`mount()` 在那儿直接报错）。
    ...(isTest ? { conditions: ["browser"] } : {}),
  },
  preview: {
    open: "/",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "happy-dom",
    setupFiles: ["./tests/_setup.ts"],
    // 这几个包默认会被 externalize（走 node 的条件解析），而测试跑的是 Svelte 的
    // **浏览器**构建；两边混在一起时，**动态 import** 它们的模块图会一直挂着不 resolve
    // （`await import("vaul-svelte")` 直接超时）。inline 之后走 vite 的 transform，
    // 条件解析统一成 browser，动态 import 就正常了。
    server: {
      deps: {
        inline: [/bits-ui/, /vaul-svelte/, /runed/, /svelte-toolbelt/],
      },
    },
  },
  build: {
    target: "esnext",
    /**
     * ── vendor 分包 ────────────────────────────────────────────────────────
     *
     * 不拆的话，整个首屏是**一个 ~670 kB 的 chunk**，触发 Vite 那条
     * 「chunks are larger than 500 kB」的提示。实测过：那条阈值靠继续拆首屏
     * **永远够不到**——把四个「点了才打开」的弹窗（设置 / 记忆设置 / 总览 /
     * 记忆总览）全换成空壳，主包仍有 613 kB。首屏真正不可省的是 Svelte runtime、
     * 侧边栏与答题区、它们实际渲染到的 bits-ui 原语、`cn()` 那套类名工具和图标。
     *
     * 所以这里不 chasing 那个数字，而是做一件本身就有价值的事：把「依赖」和
     * 「业务代码」分成两个文件。
     *
     *   - **缓存**：改业务代码（这个应用的日常）不再让整个首屏包失效，
     *     回访只需要重下 `index-*.js`（~106 kB gzip），而不是 ~203 kB。
     *   - **并行**：两个块都被 `modulepreload`，同时取，不是串行瀑布。
     *
     * 代价是首屏总量多约 3 kB gzip（多一个 chunk 的包装开销）——这是明账，
     * 换的是上面那条缓存收益。**它不是体积优化，是加载形状优化。**
     *
     * 只点名「首屏真的要用」的包，**不能偷懒写成 `test: /node_modules/`**：
     * 那样会把 dicebear（157 kB）和 vaul-svelte 一起收进来，而它们只被懒加载的
     * `GlobalSettings` / `SyncGuideDrawer` 用到——一收进来就成了入口的静态依赖，
     * vendor 块会涨到 596 kB，警告跟着回来。其余依赖保持自动分包（懒加载的那些
     * 仍然各自成块）。
     *
     * `includeDependenciesRecursively: false` 必须显式写：默认会把被匹配模块的
     * 传递依赖一起吞进同一个组，于是 Svelte runtime 会被第一个匹配到的组顺手
     * 带走，分出来的块跟预想的不是一回事。
     *
     * 哪些包在首屏、哪些已经懒加载，见 AGENTS.md「首屏体积」。
     */
    rolldownOptions: {
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: "vendor",
              test: /node_modules[\\/](?:svelte|bits-ui|@floating-ui|runed|svelte-toolbelt|@tabler|tailwind-variants|tailwind-merge|clsx|esm-env)[\\/]/,
            },
          ],
        },
      },
    },
  },
}));
