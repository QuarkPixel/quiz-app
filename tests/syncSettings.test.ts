/**
 * 设置面板（云同步区块）的渲染测试。
 *
 * 这一层专门盯「面板上显示的东西和引擎真实状态不一致」这类问题：
 *   - 新建的 Gist 创建完就回填 id，面板必须跟着显示 id（不能永远停在
 *     「第一次同步时新建」）
 *   - 云端数量、冲突列表都要从引擎状态实时读，不能是打开面板那一刻的快照
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import SyncSettings from "./SyncSettingsHarness.svelte";
import { SyncHarness } from "./syncSupport";
import { syncConfigStore } from "@/features/sync/config.svelte";
import { syncEngine } from "@/features/sync/engine.svelte";
import { installStorageHook } from "@/features/sync/storage";

let app: ReturnType<typeof mount> | null = null;
let target: HTMLElement;

function render(): void {
  app = mount(SyncSettings, { target });
  flushSync();
}

function text(): string {
  return target.textContent ?? "";
}

/** 展开「更多操作」（面板底部的折叠区）。 */
function openAdvanced(): void {
  const button = [...target.querySelectorAll("button")].find((el) =>
    el.textContent?.includes("更多操作"),
  );
  expect(button, "面板里应该有「更多操作」").toBeDefined();
  button?.click();
  flushSync();
}

beforeEach(() => {
  installStorageHook();
  localStorage.clear();
  syncConfigStore.reload();
  syncConfigStore.update({ enabled: true, token: "tok", gistId: "" });
  vi.stubGlobal("location", { ...globalThis.location, reload: () => {} });
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("云同步设置面板", () => {
  test("有令牌但还没建 Gist 时显示「第一次同步时新建」", () => {
    render();
    openAdvanced();
    expect(text()).toContain("第一次同步时新建");
  });

  test("引擎把 Gist id 回填之后，面板要跟着显示 id", () => {
    // 线上问题：新建的 Gist 明明建好了，面板永远停在「第一次同步时新建」。
    render();
    openAdvanced();
    expect(text()).toContain("第一次同步时新建");

    syncConfigStore.update({ gistId: "g1234567890", gistUrl: "https://gitee.com/me/codes/g1234567890" });
    flushSync();

    expect(text()).toContain("g1234567890");
    expect(text()).not.toContain("第一次同步时新建");
  });

  test("引擎状态里的云端数量要实时反映到面板上", () => {
    render();
    openAdvanced();
    expect(text()).toContain("云端 0 个题库");

    syncEngine.status = {
      ...syncEngine.status,
      remoteCount: 3,
      remoteBanks: 2,
    };
    flushSync();

    expect(text()).toContain("云端 2 个题库");
  });

  test("第一次同步真的新建了 Gist 之后，面板要显示那条 Gist 的 id", async () => {
    // 端到端：面板 → 单例引擎 → 内存 Gitee 替身。
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      syncConfigStore.update({ enabled: true, token: "tok", gistId: "" });
      // 本地有一份题库，第一次同步会「新建一条」
      localStorage.setItem(
        "quiz_app_general",
        JSON.stringify({ activeBank: null, defaultSettings: {}, library: [], globalSettings: {} }),
      );
      h.seedBank("aaaabbbbccccdddd", "题库一", "first");

      render();
      openAdvanced();
      expect(text()).toContain("第一次同步时新建");

      await syncEngine.sync();
      flushSync();

      const gistId = syncConfigStore.value.gistId;
      expect(gistId, "第一次同步应该建出 Gist 并回填 id").toBeTruthy();
      expect(text()).toContain(gistId);
      expect(text()).not.toContain("第一次同步时新建");
    } finally {
      await h.stop();
    }
  });

  test("Gist 选择器直接摊在面板里：每条两行，点了就选中", async () => {
    // 这里原来挂的是 shadcn 的 Select：弹层要跟 Dialog（z-[60]、overflow-hidden）
    // 抢 z-index、还会被祖先的 overflow 裁掉，条目单行 nowrap 又把弹层撑得比面板还宽。
    // 换成常驻的单选列表后没有浮层，就不该再有「点不开 / 被盖住」这类问题。
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      // 先在账号里造一条可识别的 Gist（面板要靠它列出候选）
      h.freshDevice("cli");
      h.seedBank("aaaabbbbccccdddd", "题库一", "first");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });
      await syncEngine.sync();
      expect(syncConfigStore.value.gistId, "先得有一条 Gist").toBeTruthy();

      // 模拟「第一次配置」：开关打开但令牌还是空的 → 面板进编辑态
      syncConfigStore.update({ enabled: true, token: "", gistId: "" });
      render();

      const input = target.querySelector<HTMLInputElement>(
        'input[aria-label="Gitee 私人令牌"]',
      );
      expect(input, "编辑态应该有令牌输入框").not.toBeNull();
      input!.value = "tok";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();

      const testButton = [...target.querySelectorAll("button")].find((el) =>
        el.textContent?.includes("测试连接"),
      );
      testButton?.click();

      await vi.waitFor(
        () => {
          expect(
            target.querySelector('[role="radiogroup"]'),
            "测试连接之后应该列出候选片段",
          ).not.toBeNull();
        },
        { timeout: 4000 },
      );

      const rows = [
        ...target.querySelectorAll<HTMLElement>('[data-slot="gist-option"]'),
      ];
      expect(rows.length, "「新建一条」+ 账号里那条").toBe(2);

      // 每条都得是两行：标题一行，元信息一行（挤成一行是这次要修掉的毛病）
      for (const row of rows) {
        expect(
          row.querySelector('[data-slot="gist-option-meta"]'),
          "每条都要有第二行元信息",
        ).not.toBeNull();
      }
      expect(rows[0].textContent).toContain("新建一条");
      expect(rows[1].textContent).toContain("个文件");
      expect(rows[1].textContent).toContain("更新于");

      // 点一下就选中（原生 radio，方向键也能在组内切换）
      const radio = rows[1].querySelector<HTMLInputElement>(
        'input[type="radio"]',
      );
      expect(radio, "每条应该有一个原生 radio").not.toBeNull();
      radio!.click();
      flushSync();
      expect(radio!.checked, "点过之后这一条应该是选中态").toBe(true);
      expect(rows[1].className).toContain("bg-accent");
    } finally {
      await h.stop();
    }
  });

  test("有冲突时列出版本库名，并给出「保留本地 / 保留云端」", () => {
    syncConfigStore.update({ gistId: "g1" });
    render();
    openAdvanced();

    syncEngine.status = {
      ...syncEngine.status,
      phase: "conflict",
      conflicts: [
        {
          hash: "aaaabbbbccccdddd",
          name: "英语短语",
          detail: "两边都改过",
          localAt: 1,
          remoteHash: "h",
        },
      ],
    };
    flushSync();

    expect(text()).toContain("英语短语");
    expect(text()).toContain("保留本地");
    expect(text()).toContain("保留云端");
  });
});
