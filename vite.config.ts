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
  },
}));
