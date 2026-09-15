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
import { toastStore } from "@/features/toast.svelte";

/** 一个题库的 hash（和别处用同一个，方便对着读）。 */
const HASH = "aaaabbbbccccdddd";

let app: ReturnType<typeof mount> | null = null;
let target: HTMLElement;

function render(): void {
  app = mount(SyncSettings, { target });
  flushSync();
}

function text(): string {
  return target.textContent ?? "";
}

/** 按可见文字找按钮（图标按钮没有文字，用 `byLabel`）。 */
function button(label: string): HTMLButtonElement | undefined {
  return [...target.querySelectorAll<HTMLButtonElement>("button")].find((el) =>
    el.textContent?.includes(label),
  );
}

/** 按 `aria-label` / `title` 找按钮（铅笔、垃圾桶这类图标按钮）。 */
function byLabel(label: string): HTMLButtonElement | undefined {
  return [...target.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) =>
      el.getAttribute("aria-label") === label || el.title === label,
  );
}

/** 代码片段列表里的那些行（第一行永远是「新建」）。 */
function optionRows(): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>('[data-slot="gist-option"]')];
}

/**
 * 当前选中的那行（点过之后应该在选中态）。
 *
 * 必须比**整个类名**：没选中的那些带着 `hover:bg-accent/60`，用 `includes`
 * 会把第一行永远当成选中的。
 */
function selectedRow(): HTMLElement | undefined {
  return optionRows().find((row) => row.classList.contains("bg-accent"));
}

/** 等代码片段列表拉出来。 */
async function waitForList(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        target.querySelector('[role="radiogroup"]'),
        "应该列出候选片段",
      ).not.toBeNull();
    },
    { timeout: 4000 },
  );
}

/** 「测试连接」按钮（编辑态里那行文字按钮、常规态里那个图标按钮）。 */
function testButton(): HTMLButtonElement {
  const found = byLabel("测试连接") ?? button("测试连接");
  expect(found, "应该有「测试连接」按钮").toBeDefined();
  return found!;
}

/**
 * 按钮当前的状态。
 *
 * 读的是按钮上的 `data-state`，不是类名：成功时**展示页只把图标换成绿勾**
 * （变体还是 outline），类名上看不出来。
 */
function testStateOf(): "ok" | "error" | "idle" | "verified" {
  const state = testButton().getAttribute("data-state");
  return (state ?? "idle") as "ok" | "error" | "idle" | "verified";
}

/** 展示页那个小按钮现在是不是亮着绿勾。 */
function showsGreenCheck(): boolean {
  return testStateOf() === "verified";
}

/** 等这次自检出结果（按钮变绿或变红都算）。 */
async function waitForTestResult(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(testStateOf(), "自检应该有结果（按钮变绿或变红）").not.toBe(
        "idle",
      );
    },
    { timeout: 4000 },
  );
}

/** 进编辑态，并等那次自动自检跑完、列表出来。 */
async function editAndWait(): Promise<void> {
  byLabel("修改配置")!.click();
  flushSync();
  await waitForList();
}

/** 进编辑态，并等那次自动自检出结果（不要求成功）。 */
async function editAndWaitForTest(): Promise<void> {
  byLabel("修改配置")!.click();
  flushSync();
  await waitForTestResult();
}

/** 展开「更多设置」（自动同步 + 两个覆盖按钮收在里面）。 */
function openDetails(): void {
  const toggle = button("更多设置");
  expect(toggle, "面板里应该有「更多设置」").toBeDefined();
  toggle!.click();
  flushSync();
}

beforeEach(() => {
  installStorageHook();
  localStorage.clear();
  // 全局提示是模块级单例，会跨用例留着上一条
  toastStore.dismiss();
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
    expect(text()).toContain("第一次同步时新建");
  });

  test("引擎把 Gist id 回填之后，面板要跟着显示 id", () => {
    // 线上问题：新建的 Gist 明明建好了，面板永远停在「第一次同步时新建」。
    render();
    expect(text()).toContain("第一次同步时新建");

    syncConfigStore.update({ gistId: "g1234567890", gistUrl: "https://gitee.com/me/codes/g1234567890" });
    flushSync();

    expect(text()).toContain("g1234567890");
    expect(text()).not.toContain("第一次同步时新建");
  });

  test("引擎状态里的云端数量要实时反映到面板上", () => {
    render();
    // 本地也是 0 → 两边一样，只写一个数
    expect(text()).toContain("0 个题库");

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
      const gistId = syncConfigStore.value.gistId;
      expect(gistId, "先得有一条 Gist").toBeTruthy();

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
      expect(rows.length, "「新建」+ 账号里那条").toBe(2);

      // 每条都得是两行：标题一行，元信息一行（挤成一行是这次要修掉的毛病）
      for (const row of rows) {
        expect(
          row.querySelector('[data-slot="gist-option-meta"]'),
          "每条都要有第二行元信息",
        ).not.toBeNull();
      }

      // 行首的图标位：真片段是 identicon（viewBox 100×100），「新建」是数据库图标
      const newIcon = rows[0].querySelector("svg");
      const gistIcon = rows[1].querySelector("svg");
      expect(newIcon?.getAttribute("viewBox"), "「新建」用数据库图标").toBe(
        "0 0 24 24",
      );
      expect(gistIcon?.getAttribute("viewBox"), "真片段用 identicon").toBe(
        "0 0 100 100",
      );
      // 两种图标同一个边长，行里的文字左边缘才对得齐
      for (const icon of [newIcon, gistIcon]) {
        expect(icon?.getAttribute("width")).toBe("30");
        expect(icon?.getAttribute("height")).toBe("30");
      }
      // 每行内容垂直居中
      expect(rows[0].className).toContain("items-center");

      expect(rows[0].textContent).toContain("新建");
      expect(rows[0].textContent).toContain("新建代码片段");
      // 主信息是 id（等宽），第二行是更新时间；文件数那种低信息量的东西不再展示
      const idLine = rows[1].querySelector('[data-slot="gist-option-id"]');
      expect(idLine?.textContent?.trim()).toBe(gistId);
      expect(idLine?.className, "id 用等宽字体").toContain("font-mono");
      expect(rows[1].textContent).toContain("更新于");
      expect(rows[1].textContent).not.toContain("个文件");

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

  // ── 版面：目标仓库在标题旁、按钮收进「更多设置」─────────────────────────

  test("目标仓库卡片：identicon + id + 时间 + 两边的规模，且点它不会切开关", () => {
    syncConfigStore.update({ gistId: "g1234567890" });
    syncEngine.status = {
      ...syncEngine.status,
      phase: "idle",
      message: "题库没有改动",
      at: Date.parse("2026-09-15T10:41:00"),
      remoteBanks: 17,
    };
    render();

    const card = target.querySelector<HTMLElement>(
      '[data-slot="sync-overview"]',
    );
    expect(card, "常规态应该有信息展示区").not.toBeNull();
    expect(card!.textContent).toContain("目标仓库");
    expect(card!.textContent).toContain("g1234567890");
    // 那张 identicon（viewBox 100×100 是它的标记）
    expect(card!.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 100 100",
    );
    // 上次同步时间
    expect(
      card!.querySelector('[data-slot="sync-card-note"]')!.textContent,
    ).toContain("上次同步");
    // 规模：本地题库数 / 本地大小 / 云端题库数
    const stats = card!
      .querySelector('[data-slot="sync-card-stats"]')!
      .textContent!.replace(/\s+/g, "");
    expect(stats).toContain("本地0个题库");
    expect(stats).toContain("云端17个题库");
    expect(stats).toMatch(/\d+(\.\d+)?(B|KB|MB)·本地0个题库·云端17个题库/);

    // 它必须待在 `<label for="sync-enabled">` 外面：点一下标签是会切开关的
    expect(card!.closest("label")).toBeNull();
    card!.click();
    flushSync();
    expect(syncConfigStore.value.enabled, "点卡片不该切开关").toBe(true);
  });

  test("「上次同步」是相对时间、每秒刷新，悬停 title 给绝对时间", () => {
    vi.useFakeTimers();
    try {
      syncConfigStore.update({ gistId: "g1" });
      render();
      syncEngine.status = {
        ...syncEngine.status,
        phase: "idle",
        message: "题库没有改动",
        // 「上次同步」只看 lastSyncAt：测试连接写的是 at，不会让它跳
        lastSyncAt: Date.now() - 20_000,
        remoteBanks: 3,
      };
      flushSync();

      const note = target.querySelector<HTMLElement>(
        '[data-slot="sync-card-note"]',
      )!;
      expect(note.textContent).toContain("上次同步：20 秒前");
      // 悬停看绝对时间
      expect(note.getAttribute("title")).toMatch(
        /\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/,
      );

      // 心跳每秒走一下：再过 40 秒就该说「1 分钟前」
      vi.advanceTimersByTime(40_000);
      flushSync();
      expect(note.textContent).toContain("上次同步：1 分钟前");
    } finally {
      vi.useRealTimers();
    }
  });

  test("出错不往卡片上贴说明：卡片只报事实，错误走通知", () => {
    syncConfigStore.update({ gistId: "g1" });
    // 引擎是单例，先明确「还没同步过」
    syncEngine.status = { ...syncEngine.status, phase: "idle", lastSyncAt: 0 };
    render();
    const note = () => target.querySelector('[data-slot="sync-card-note"]')!;
    expect(note().textContent).toContain("还没同步过");

    syncEngine.status = {
      ...syncEngine.status,
      phase: "error",
      message: "令牌无效或已过期",
    };
    flushSync();

    // 卡片那行仍然是「上次同步 …」，不掺错误说明
    expect(note().textContent).not.toContain("令牌");
    expect(note().className, "它不再因为报错而变红").toContain(
      "text-muted-foreground",
    );
  });

  test("「立即同步」是主按钮；覆盖按钮与自动同步收进「更多设置」", () => {
    syncConfigStore.update({ gistId: "g1" });
    render();

    expect(
      button("立即同步")!.className,
      "立即同步换成 default 变体",
    ).toContain("bg-primary");

    // 默认收起：覆盖按钮和自动同步都不在
    expect(button("用本地覆盖云端")).toBeUndefined();
    expect(target.querySelectorAll('button[role="switch"]').length).toBe(1);

    openDetails();
    const up = button("用本地覆盖云端")!;
    const down = button("用云端覆盖本地")!;
    expect(up.className, "覆盖按钮改成 secondary").toContain("bg-secondary");
    expect(up.className, "覆盖按钮尺寸改小").toContain("h-6");
    expect(down.className).toContain("bg-secondary");
    // 展开后多了「自动同步」那个 switch，而且提示挂在它的 label 上
    expect(target.querySelectorAll('button[role="switch"]').length).toBe(2);
    expect(
      byLabel("关于自动同步"),
      "不再单独放一个问号按钮",
    ).toBeUndefined();
  });

  test("展示页那个小按钮：成功亮 2 秒绿勾再自己恢复，失败变红并弹提示", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });
      await syncEngine.sync();
      render();

      // 展示页那个小按钮：先是常态
      expect(testStateOf()).toBe("idle");

      // 成功：图标换成绿勾（按钮本身不变色，只要「亮一下」）
      testButton().click();
      await vi.waitFor(
        () => {
          expect(showsGreenCheck(), "验过要亮绿勾").toBe(true);
        },
        { timeout: 4000 },
      );
      expect(
        testButton().querySelector("svg")?.getAttribute("class") ?? "",
        "绿勾是绿的那个图标",
      ).toContain("text-success");
      expect(toastStore.current, "成功不弹提示").toBeNull();

      // 两秒后自己恢复：绿勾收掉，图标换回云朵勾（按钮看上去和没测过一样）。
      // 这里用真实时间等（定时器是在真实时钟下起跳的，切假时钟推它没用）
      await vi.waitFor(
        () => {
          expect(showsGreenCheck(), "闪一下就该收回去").toBe(false);
        },
        { timeout: 3000 },
      );
      expect(testStateOf(), "只是不再亮绿勾，结果本身还记着").toBe("ok");

      // 令牌换成错的（保存着的配置）→ 失败要变红 + 全局提示
      syncConfigStore.update({ token: "wrong" });
      flushSync();
      testButton().click();
      await vi.waitFor(
        () => {
          expect(testStateOf()).toBe("error");
        },
        { timeout: 4000 },
      );
      expect(testButton().className, "失败要变红").toContain(
        "text-destructive",
      );
      expect(toastStore.current?.variant).toBe("destructive");
      expect(toastStore.current?.description).toBeTruthy();
    } finally {
      await h.stop();
    }
  });

  test("提示只有一份：面板自己不再渲染 toast，内容来自全局 store", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });
      render();

      toastStore.show("同步完成", "新增 1", "success");
      flushSync();

      // 外壳里只挂了一份全局提示（面板内部没有第二份）
      expect(
        target.querySelectorAll('[role="status"]').length,
        "整个页面只该有一份提示容器",
      ).toBe(1);
      expect(text()).toContain("同步完成");
      expect(text()).toContain("新增 1");
    } finally {
      await h.stop();
    }
  });

  // ── 保存按钮什么时候能点 ────────────────────────────────────────────────

  test("再次编辑：进来就自动测试连接；验过才出现列表、保存才能点", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      // 先在账号里造一条可识别的 Gist（模拟「已经在用云同步」）
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });
      await syncEngine.sync();
      const gistId = syncConfigStore.value.gistId;
      expect(gistId, "先得有一条 Gist").toBeTruthy();

      render();
      // 再次编辑：保存按钮一开始就在，但是灰的（还没验过）
      byLabel("修改配置")!.click();
      flushSync();
      expect(button("保存"), "再次编辑时保存按钮应该一直在").toBeDefined();
      expect(button("保存")!.disabled, "验过之前保存是灰的").toBe(true);
      expect(optionRows().length, "还没验过就不该有列表").toBe(0);

      // 进来会自己跑一次「测试连接」，不用用户再点
      await waitForList();
      expect(button("保存")!.disabled, "验过之后就能保存了").toBe(false);
      expect(optionRows().length, "「新建」+ 账号里那条").toBe(2);

      // 动一下令牌 → 列表收起来、保存又变灰（那份自检结果作废了）
      const input = target.querySelector<HTMLInputElement>(
        'input[aria-label="Gitee 私人令牌"]',
      );
      input!.value = "tok2";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();
      expect(button("保存")!.disabled, "改了令牌，保存要重新变灰").toBe(true);
      // 列表是带出场的，等它真的收干净
      await vi.waitFor(
        () => {
          expect(optionRows().length, "改了令牌，列表要收起来").toBe(0);
        },
        { timeout: 4000 },
      );

      // 改回原样再验一次 → 又能保存，而且保存才真的落盘
      input!.value = "tok";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();
      button("测试连接")!.click();
      await waitForList();
      button("保存")!.click();
      flushSync();
      // 保存会顺手同步一次；等它跑完再收尾，免得请求飞到已经关掉的替身上
      await syncEngine.sync();
      flushSync();

      expect(syncConfigStore.value.gistId).toBe(gistId);
      expect(syncConfigStore.value.token).toBe("tok");
      // 保存后退出编辑态（回到常规态那行打码令牌）
      expect(
        target.querySelector('input[aria-label="已保存的 Gitee 令牌（已打码）"]'),
      ).not.toBeNull();
    } finally {
      await h.stop();
    }
  });

  test("首次配置：没测通之前连保存按钮都不出现", () => {
    syncConfigStore.update({ enabled: true, token: "", gistId: "" });
    render();

    // 开关打开但没令牌 → 直接在编辑态：没有列表，也没有保存按钮
    expect(optionRows().length).toBe(0);
    expect(button("保存"), "首次配置：没验过就不该有保存按钮").toBeUndefined();

    // 粘一个令牌还不够——得先测通
    const input = target.querySelector<HTMLInputElement>(
      'input[aria-label="Gitee 私人令牌"]',
    );
    input!.value = "tok";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(button("保存"), "只填令牌、没测通时仍然不该有保存按钮").toBeUndefined();
  });

  // ── 「不点保存就不生效」──────────────────────────────────────────────────

  test("编辑态里试令牌：测试连接不落盘，刷新页面读到的还是旧的", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });
      render();

      // 进来会自动验一次并列出片段；等这一次跑完再动手，免得和它抢 busy
      await editAndWait();
      const input = target.querySelector<HTMLInputElement>(
        'input[aria-label="Gitee 私人令牌"]',
      );
      expect(input!.readOnly, "铅笔进来时令牌是可改的").toBe(false);
      input!.value = "draft-token";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();

      testButton().click();
      // 草稿令牌是错的（替身只认 tok）→ 按钮变红 + 全局提示说明原因
      await waitForTestResult();
      expect(testStateOf(), "失败要变红").toBe("error");
      expect(toastStore.current?.variant).toBe("destructive");
      expect(toastStore.current?.title).toContain("测试连接失败");

      // 关键：试过之后什么都没保存
      expect(syncConfigStore.value.token, "没点保存就不该落盘").toBe("tok");
      expect(
        JSON.parse(localStorage.getItem("quiz_app_sync_config") ?? "{}").token,
      ).toBe("tok");

      // 模拟刷新页面：从 localStorage 重新读一遍，还是旧的
      syncConfigStore.reload();
      expect(syncConfigStore.value.token).toBe("tok");

      // 取消之后输入框也回到旧值（草稿不残留）；再进来同样会自动验一次，
      // 等它跑完再收尾，免得请求飞到已经关掉的替身上
      button("取消")!.click();
      flushSync();
      byLabel("修改配置")!.click();
      flushSync();
      expect(
        target.querySelector<HTMLInputElement>(
          'input[aria-label="Gitee 私人令牌"]',
        )!.value,
      ).toBe("tok");
      await waitForTestResult();
    } finally {
      await h.stop();
    }
  });

  test("编辑态不会往面板里写提示：成功只变绿，失败才弹全局提示", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });
      await syncEngine.sync();
      render();

      // 进编辑态 → 自动自检通过：按钮变绿、列出片段，**面板里不多一行字**
      await editAndWait();
      expect(testStateOf(), "验过了按钮要变绿").toBe("ok");
      expect(text(), "成功不写提示").not.toContain("令牌有效");
      expect(text(), "成功也不弹提示").not.toContain("测试连接失败");
      expect(toastStore.current, "成功不该有提示").toBeNull();

      // 退出编辑态：卡片那行回到「上次同步 …」
      button("取消")!.click();
      flushSync();
      const note = target.querySelector('[data-slot="sync-card-note"]');
      expect(note, "常规态应该有目标仓库卡片").not.toBeNull();
      expect(note!.textContent).toContain("上次同步");
      expect(testStateOf(), "退出编辑态后按钮回到常态").toBe("idle");
    } finally {
      await h.stop();
    }
  });

  test("目标被删也能改：进编辑态自检通过、列表出来、能保存新目标", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      // 账号里有一条能用的片段，但本地记的是另一条（已被删的）
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });
      await syncEngine.sync();
      const alive = syncConfigStore.value.gistId;
      expect(alive).toBeTruthy();

      syncConfigStore.update({ gistId: "gone-forever" });
      render();
      // 展示模式的自检会如实报「目标不存在」
      testButton().click();
      await vi.waitFor(() => expect(testStateOf()).toBe("error"));

      // 编辑模式：只验令牌 → 能过，列表出来，能选新的并保存
      byLabel("修改配置")!.click();
      await editAndWait();
      expect(testStateOf(), "只验令牌，应该通过").toBe("ok");
      expect(syncEngine.targetMissing, "草稿自检不该抹掉「已删除」").toBe(true);

      const row = optionRows().find(
        (r) => r.dataset.value === alive,
      );
      expect(row, "列表里应该有那条还活着的片段").toBeDefined();
      row!.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
      flushSync();
      button("保存")!.click();
      flushSync();
      await syncEngine.sync();
      flushSync();

      expect(syncConfigStore.value.gistId).toBe(alive);
      expect(syncEngine.targetMissing, "换成活的目标之后状态复位").toBe(false);
    } finally {
      await h.stop();
    }
  });

  test("目标被删：id 划掉 + 「（已被删除）」，卡片里不写一段解释", () => {
    syncConfigStore.update({ gistId: "g1234567890" });
    render();

    syncEngine.targetMissing = true;
    syncEngine.status = {
      ...syncEngine.status,
      phase: "error",
      message: "目标仓库不存在",
    };
    flushSync();

    const card = target.querySelector<HTMLElement>(
      '[data-slot="sync-overview"]',
    )!;
    // id 加删除线，旁边一个短标注
    expect(
      card.querySelector(".line-through")?.textContent?.trim(),
      "那条 id 要划掉",
    ).toBe("g1234567890");
    expect(card.textContent).toContain("（已被删除）");

    // 卡片里不该出现解释性长句（错误交给通知 + 页头红点）
    expect(card.textContent).not.toContain("目标仓库不存在");
    expect(card.textContent).not.toContain("铅笔");
    expect(
      card.querySelector('[data-slot="sync-card-note"]')!.textContent,
      "那行只说上次同步",
    ).toContain("上次同步");

    // 目标都没了，就别再报云端的题库数
    expect(
      card.querySelector('[data-slot="sync-card-stats"]')!.textContent,
    ).not.toContain("云端");
  });

  test("「说明」抽屉是按需加载的：点开才出现，内容读得出来", async () => {
    syncConfigStore.update({ gistId: "g1" });
    render();
    // 抽屉的内容走 portal 挂在 body 上，所以看 body 而不是看面板
    expect(document.body.textContent, "没点开之前不该有说明内容").not.toContain(
      "它是做什么的",
    );

    byLabel("云同步说明")!.click();
    await vi.waitFor(
      () => {
        expect(
          document.body.textContent,
          "点开之后说明抽屉要出来",
        ).toContain("它是做什么的");
      },
      { timeout: 4000 },
    );
  });

  // ── 清空配置 ────────────────────────────────────────────────────────────

  test("清空配置：localStorage 里两个键都删掉，同步也关掉", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "g1",
        gistUrl: "https://gitee.com/tester/codes/g1",
      });
      localStorage.setItem(
        "quiz_app_sync_meta",
        JSON.stringify({
          lastSyncedAt: 1,
          bootstrapped: true,
          rows: {},
          generalBaseline: null,
        }),
      );
      render();

      // 进编辑态会自动验一次（g1 在替身里不存在 → 报错，无所谓）
      await editAndWaitForTest();
      button("清空配置")!.click(); // 第一下：进确认态
      flushSync();
      button("确认清空")!.click();
      flushSync();

      expect(localStorage.getItem("quiz_app_sync_config")).toBeNull();
      expect(localStorage.getItem("quiz_app_sync_meta")).toBeNull();
      expect(syncConfigStore.value.enabled).toBe(false);
      expect(syncConfigStore.value.token).toBe("");
      expect(syncConfigStore.value.gistId).toBe("");
      // 关掉之后整个云同步区块收起来
      expect(
        target.querySelector('input[aria-label="已保存的 Gitee 令牌（已打码）"]'),
      ).toBeNull();
    } finally {
      await h.stop();
    }
  });

  // ── 列表里的垃圾桶 ──────────────────────────────────────────────────────

  test("每条代码片段右边有垃圾桶：删掉云端那条，行也跟着消失", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });
      await syncEngine.sync();
      const gistId = syncConfigStore.value.gistId;

      render();
      // 换云端 / 删片段都从「修改配置」进去（进来会自动验一次、把列表拉出来）
      byLabel("修改配置")!.click();
      await waitForList();

      expect(optionRows().length).toBe(2);
      // 「新建」那行没有东西可删
      expect(
        optionRows()[0].querySelector('[data-slot="gist-delete"]'),
        "「新建」不该有垃圾桶",
      ).toBeNull();

      const trash = optionRows()[1].querySelector<HTMLButtonElement>(
        '[data-slot="gist-delete"] button',
      );
      expect(trash, "真片段那行要有垃圾桶").not.toBeNull();
      expect(trash!.querySelector("svg")).not.toBeNull();

      trash!.click(); // 第一下：确认态，什么都不删
      flushSync();
      expect(h.fake.has(gistId), "第一下只是确认，不该真删").toBe(true);
      expect(selectedRow()?.dataset.value, "点垃圾桶不该顺手改选中项").toBe(
        gistId,
      );

      trash!.click(); // 第二下：真删
      await vi.waitFor(
        () => {
          expect(h.fake.has(gistId), "第二下才真的从 Gitee 删掉").toBe(false);
        },
        { timeout: 4000 },
      );
      await vi.waitFor(
        () => {
          expect(optionRows().length, "删掉的行要从列表里消失").toBe(1);
        },
        { timeout: 4000 },
      );

      // 删掉的正是当前在用的那条 → 本地记的连接也断开（不然会一直报「Gist 不见了」）
      expect(syncConfigStore.value.gistId).toBe("");
    } finally {
      await h.stop();
    }
  });

  // ── 提示文案 ────────────────────────────────────────────────────────────

  test("同步完成的提示按四件事分别说（题库没有改动 / 新增 N …）", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });
      render();

      button("立即同步")!.click();
      await vi.waitFor(
        () => {
          expect(text(), "新导入的题库应该报「新增」").toContain("新增 1");
        },
        { timeout: 4000 },
      );

      // 再同步一次：没改动
      button("立即同步")!.click();
      await vi.waitFor(
        () => {
          expect(text()).toContain("题库没有改动");
        },
        { timeout: 4000 },
      );
    } finally {
      await h.stop();
    }
  });
});
