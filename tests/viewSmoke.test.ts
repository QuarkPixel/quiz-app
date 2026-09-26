import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import ViewHarness from "./ViewHarness.svelte";
import { BankStore } from "../src/source/bankStore";
import {
    createDefaultSettings,
    createDefaultUiPreferences,
    loadStoredState,
    saveState,
} from "../src/store";
import { createDefaultMemorySettings } from "../src/features/memory/settings";
import { startOfDay } from "../src/features/memory/algorithm";
import type { Bank } from "../src/source/types";
import type { MemoryProgress, StoredState } from "../src/types";

/**
 * 视图级冒烟测试：**真的把 `QuizView` / `MemoryView` 挂起来点一遍**。
 *
 * 为什么需要它：`svelte-check` 只看类型，单测只看纯函数，构建只看能不能打包——
 * 三者都发现不了「模板在运行期抛异常」。教训是真实的：`ShortcutHelp` 里两行
 * 快捷键同名，`{#each … (row.label)}` 撞 key，Svelte 抛 `each_key_duplicate`，
 * 整个设置弹窗渲染不出来，表现成「刷题模式的设置打不开」，而上面三道关卡全绿。
 *
 * 覆盖的都是「重构成共享组件」之后最容易悄悄坏掉的路：
 *   底部工具栏三颗按钮 → 设置 / 总览 / 活动池
 *   总览里的筛选面板（共享 `FilterBar`）
 *   两个模式的底部渐变遮罩（共享 `ViewShell`；记忆模式曾经漏了它）
 *   答题主路径（共享键盘分发 + 共享 `ProgressBar`）
 */

/**
 * 用**判断题**而不是单选题：选择题的选项会被打乱（`shuffledOptions`），
 * 按 `a` 选到的是「显示出来的第一个」，答对答错随机——那样的断言会看运气。
 * 判断题的 `a` / `1` 恒等于「正确」，答对是确定的。
 */
const QUIZ_BANK = JSON.stringify({
    mode: "quiz",
    title: "测试题库",
    questions: [
        {
            id: "j1",
            type: "judgment",
            question: "判断题",
            answer: true,
        },
    ],
});

/** 一张今天到期的复习卡（进「复习」的门槛） */
function dueToday(): MemoryProgress {
    return {
        state: "reviewing",
        level: 1,
        streak: 0,
        nextDue: startOfDay(Date.now()),
        lapses: 0,
    };
}

function emptyState(): StoredState {
    return {
        masteredIds: [],
        masteredMistakes: {},
        activePool: [],
        currentRound: 0,
        filterType: "all",
        settings: createDefaultSettings(),
        ui: createDefaultUiPreferences(),
    };
}

const MEMORY_BANK = JSON.stringify({
    mode: "memory",
    title: "记忆题库",
    questions: [{ id: "m1", question: "取得进步", answer: "make progress" }],
});

async function mountView(
    json: string,
    /** 挂载前先往 localStorage 里铺一份进度（比如造一张今天到期的复习卡） */
    seed?: (hash: string) => void,
): Promise<{
    bank: Bank;
    host: HTMLElement;
    destroy: () => void;
}> {
    localStorage.clear();
    const source = new BankStore();
    const result = await source.importBank("测试", json);
    expect(result.kind, "题库没导进去，后面的断言没意义").toBe("ok");

    const bank = source.getActiveBank();
    if (!bank) throw new Error("导入成功但拿不到当前题库");
    seed?.(bank.hash);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(ViewHarness, { target: host, props: { bank, source } });
    flushSync();

    return {
        bank,
        host,
        destroy: () => {
            void unmount(app);
            host.remove();
        },
    };
}

/** 对话框走 portal 挂在 body 上，所以要按 aria-label 在整页里找那颗按钮 */
function toolbarButton(label: string): HTMLElement {
    const button = document.querySelector<HTMLElement>(
        `button[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`找不到工具栏按钮：${label}`);
    return button;
}

function dialogTitles(): string[] {
    return [...document.querySelectorAll('[role="dialog"]')].map(
        (dialog) => dialog.textContent?.trim().slice(0, 20) ?? "",
    );
}

/**
 * 关掉当前打开的弹窗。
 *
 * 两个作用：一是真的验一遍「打得开也关得上」；二是**别让弹窗开着被卸载**——
 * bits-ui 的 portal 在那种拆毁路径上会打一堆 `derived_inert` dev 警告，
 * 把测试输出淹掉（关掉再卸载就干净了）。
 */
async function closeDialogs(): Promise<void> {
  const close = document.querySelector<HTMLElement>(
    '[role="dialog"] [data-slot="dialog-close"]',
  );
  if (!close) return;
  close.click();
  flushSync();
  await tick();
  flushSync();
}

/** 记忆模式的轮内连对次数（落盘的那一份） */
function storedStreak(hash: string, id: string): number | undefined {
    return loadStoredState(hash).memory?.progress[id]?.streak;
}

/** 按一个不带修饰键的键（走窗口级的统一分发） */
function pressKey(key: string, code: string): void {
    window.dispatchEvent(
        new KeyboardEvent("keydown", {
            key,
            code,
            bubbles: true,
            cancelable: true,
        }),
    );
    flushSync();
}

/** 答题区那一行（`data-revealed` 就是「点亮 / 未点亮」那个开关） */
function roundActionsRow(): HTMLElement {
    const row = document.querySelector<HTMLElement>(
        '[data-slot="memory-round-actions"]',
    );
    if (!row) throw new Error("找不到答题区那一行");
    return row;
}

/** 箭头那颗按钮（悬停触发区就是它，测试里也按「指针落在它上面」来模拟） */
function roundActionsTrigger(): HTMLElement {
    const trigger = roundActionsRow().querySelector<HTMLElement>(
        'button[aria-label="退出本轮"]',
    );
    if (!trigger) throw new Error("找不到悬停触发区（退出本轮那颗箭头）");
    return trigger;
}

/**
 * 把指针移到触发区上：平时两颗按钮都在（CSS 压到 60% 不透明度）、只有
 * 「退出本轮」四个字藏着；指到箭头上才点亮（`data-revealed="true"`）。
 * 触屏是常亮，测试环境按鼠标算。
 */
function hoverRoundActions(): void {
    roundActionsTrigger().dispatchEvent(new MouseEvent("mouseenter"));
    flushSync();
}

/** 按文字找一颗按钮（首页的「学习新的题目」这类没有 aria-label 的入口） */
function buttonWithText(text: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.textContent?.includes(text),
    );
    if (!button) throw new Error(`找不到按钮：${text}`);
    return button;
}

/**
 * bits-ui 的 Tooltip 在 hover / focus 后打开，内容走 portal 挂到 body 上
 * （同 ToolbarIconButton 的测法）。断言写成「屏幕上出现了这句提示」：
 * 关掉的那一份 content 还会在 DOM 里待一会儿，认节点容易认错。
 */
async function expectTooltip(button: HTMLElement, expected: string): Promise<void> {
    button.dispatchEvent(
        new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }),
    );
    button.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
    );
    button.focus();
    flushSync();

    await vi.waitFor(() => {
        const texts = [
            ...document.querySelectorAll('[data-slot="tooltip-content"]'),
        ].map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "");
        expect(texts, "tooltip 没出现").toContain(expected);
    });
}

function pressModKey(key: string): void {
    window.dispatchEvent(
        new KeyboardEvent("keydown", {
            key,
            metaKey: true,
            bubbles: true,
            cancelable: true,
        }),
    );
    flushSync();
}

describe("刷题模式：设置面板", () => {
    let view: Awaited<ReturnType<typeof mountView>> | null = null;

    afterEach(async () => {
        await closeDialogs();
        view?.destroy();
        view = null;
        localStorage.clear();
    });

    it("点底部齿轮 → 打开「当前题库设置」", async () => {
        view = await mountView(QUIZ_BANK);
        expect(dialogTitles(), "一开始不该有对话框").toEqual([]);

        toolbarButton("当前题库设置").click();
        flushSync();

        expect(dialogTitles().join()).toContain("当前题库设置");
    });

    it("⌘I 也能打开", async () => {
        view = await mountView(QUIZ_BANK);

        pressModKey("i");

        expect(dialogTitles().join()).toContain("当前题库设置");
    });

    it("弹窗里自带的关闭按钮能把它关掉", async () => {
        view = await mountView(QUIZ_BANK);

        toolbarButton("当前题库设置").click();
        flushSync();
        expect(dialogTitles().join()).toContain("当前题库设置");

        await closeDialogs();

        expect(dialogTitles(), "关闭按钮应当把弹窗收掉").toEqual([]);
    });

    it("弹窗打开时 ⌘I 不再切换（模态框里的按键归模态框）", async () => {
        view = await mountView(QUIZ_BANK);

        toolbarButton("当前题库设置").click();
        flushSync();
        expect(dialogTitles().join()).toContain("当前题库设置");

        // 键盘层在对话内整体早退，这是刻意的：否则「⌘I 打开 → 同一次按键又关掉」
        // 这类自相矛盾的回归会重新冒出来
        pressModKey("i");

        // 断言的是「还是那一个弹窗」：整串文案钉死过（题型筛选那行删掉之后
        // 这个用例一直红着），所以只认标题 + 题库名，别把面板内容再抄一遍
        const titles = dialogTitles();
        expect(titles, "弹窗内的 ⌘I 不该再切一次").toHaveLength(1);
        expect(titles[0]).toContain("当前题库设置 题库 名称");
    });
});

describe("记忆模式：设置面板", () => {
    let view: Awaited<ReturnType<typeof mountView>> | null = null;

    afterEach(async () => {
        await closeDialogs();
        view?.destroy();
        view = null;
        localStorage.clear();
    });

    it("点底部齿轮 → 打开「当前题库设置」", async () => {
        view = await mountView(MEMORY_BANK);
        expect(dialogTitles()).toEqual([]);

        toolbarButton("当前题库设置").click();
        flushSync();

        expect(dialogTitles().join()).toContain("当前题库设置");
    });

    it("⌘I 也能打开", async () => {
        view = await mountView(MEMORY_BANK);

        pressModKey("i");

        expect(dialogTitles().join()).toContain("当前题库设置");
    });
});

// ---------------------------------------------------------------------------
// 同一批重排还动过这些地方：总览、筛选面板、活动池、底部遮罩。
// 它们都靠共享组件拼出来，所以一并冒烟——静态检查与单测都看不出「打不开」。
// ---------------------------------------------------------------------------

describe("两个模式的其它工具栏入口", () => {
    let view: Awaited<ReturnType<typeof mountView>> | null = null;

    afterEach(async () => {
        await closeDialogs();
        view?.destroy();
        view = null;
        localStorage.clear();
    });

    it("刷题模式：总览能打开，筛选面板能展开", async () => {
        view = await mountView(QUIZ_BANK);

        toolbarButton("总览").click();
        flushSync();
        expect(dialogTitles().join()).toContain("总览");

        // 筛选面板在总览里：展开它就等于渲染了共享 FilterBar 的全部分组
        const filterButton = document.querySelector<HTMLElement>(
            'button[aria-label="筛选"]',
        );
        expect(filterButton, "总览里应当有筛选按钮").not.toBeNull();
        filterButton!.click();
        flushSync();
        expect(document.body.textContent).toContain("学习进度");
        expect(document.body.textContent).toContain("答题正误");
    });

    it("记忆模式：总览能打开，筛选面板能展开", async () => {
        view = await mountView(MEMORY_BANK);

        toolbarButton("总览").click();
        flushSync();
        expect(dialogTitles().join()).toContain("总览");

        const filterButton = document.querySelector<HTMLElement>(
            'button[aria-label="筛选"]',
        );
        expect(filterButton, "总览里应当有筛选按钮").not.toBeNull();
        filterButton!.click();
        flushSync();
        expect(document.body.textContent).toContain("复习进度");
    });

    it("刷题模式：活动池开关能展开", async () => {
        view = await mountView(QUIZ_BANK);

        toolbarButton("查看活动池").click();
        flushSync();

        expect(document.body.textContent).toContain("池中暂无其它题目");
    });

    it("两个模式都有底部渐变遮罩（曾经记忆模式漏了它）", async () => {
        view = await mountView(QUIZ_BANK);
        expect(
            view.host.querySelector('[data-slot="view-bottom-mask"]'),
            "刷题模式缺底部遮罩",
        ).not.toBeNull();
        view.destroy();

        view = await mountView(MEMORY_BANK);
        expect(
            view.host.querySelector('[data-slot="view-bottom-mask"]'),
            "记忆模式缺底部遮罩",
        ).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 答题主路径：进度条被泛化成共享组件、键盘层被合成一份，都要真的走一遍
// ---------------------------------------------------------------------------

describe("答题主路径", () => {
    let view: Awaited<ReturnType<typeof mountView>> | null = null;

    afterEach(async () => {
        await closeDialogs();
        view?.destroy();
        view = null;
        localStorage.clear();
    });

    it("刷题模式：按字母键选项 → 自动提交 → 出对错反馈", async () => {
        view = await mountView(QUIZ_BANK);

        // 走键盘（`autoSubmitOnSelection` 默认开）：顺带把统一后的键盘分发也走一遍
        window.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "a",
                code: "KeyA",
                bubbles: true,
                cancelable: true,
            }),
        );
        flushSync();

        expect(document.body.textContent).toContain("回答正确");
        // 进度条（共享 ProgressBar）在答题区下面，答对一张应当被记进去
        expect(
            document.querySelector('[role="progressbar"], button[aria-label*="进度"]'),
            "进度条没渲染出来",
        ).not.toBeNull();
    });

    it("记忆模式：开始一轮 → 出现本轮进度条 → 自评「知道」出答案", async () => {
        view = await mountView(MEMORY_BANK);

        const start = [...document.querySelectorAll("button")].find((button) =>
            button.textContent?.includes("学习新的题目"),
        );
        expect(start, "首页应当有「学习新的题目」").not.toBeUndefined();
        start!.click();
        flushSync();

        // 记忆模式的进度条是 ProgressBar 的适配器：非交互形态（不是按钮）
        const bar = document.querySelector<HTMLElement>('[role="progressbar"]');
        expect(bar, "本轮进度条没渲染出来").not.toBeNull();
        expect(bar!.getAttribute("aria-valuemax")).toBe("5");

        window.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: " ",
                code: "Space",
                bubbles: true,
                cancelable: true,
            }),
        );
        flushSync();

        expect(document.body.textContent).toContain("make progress");
    });
});

// ---------------------------------------------------------------------------
// 记忆模式答题区那一行：「退出本轮」（只是退出）与「结束本轮」（作废并重开一轮）
// ---------------------------------------------------------------------------

describe("记忆模式：退出本轮 / 结束本轮", () => {
    let view: Awaited<ReturnType<typeof mountView>> | null = null;

    afterEach(async () => {
        await closeDialogs();
        view?.destroy();
        view = null;
        localStorage.clear();
    });

    it("「结束本轮」点两下确认 → 本轮作废、退出到首页（下次是新的一轮）", async () => {
        view = await mountView(MEMORY_BANK);
        buttonWithText("学习新的题目").click();
        flushSync();

        // 自评一次「知道」：这一轮的轮内连对变成 1
        pressKey(" ", "Space");
        expect(storedStreak(view.bank.hash, "m1")).toBe(1);

        // 未点亮：三部分各占着自己的壳（位置不变），只是被样式压成 opacity 0，
        // 唯一露着的是箭头；「退出本轮」的文案要悬停后才长出来
        expect(roundActionsRow().dataset.revealed).toBe("false");
        expect(
            roundActionsRow().querySelectorAll("[data-reveal-part]"),
        ).toHaveLength(3);
        expect(toolbarButton("退出本轮").textContent?.trim()).toBe("");

        hoverRoundActions();

        expect(roundActionsRow().dataset.revealed).toBe("true");
        expect(toolbarButton("退出本轮").textContent).toContain("退出本轮");

        const stop = toolbarButton("结束本轮");
        expect(stop.textContent?.trim()).toBe("结束本轮");

        // 第一下只是确认态：文本换成「确认结束」（不带问号），一个字都不改
        stop.click();
        flushSync();
        expect(stop.textContent).toContain("确认结束");
        expect(stop.textContent).not.toContain("？");
        expect(storedStreak(view.bank.hash, "m1"), "第一下不该动进度").toBe(1);

        // 第二下才真的结束：本轮作废，并像退出一样回首页
        stop.click();
        flushSync();
        expect(storedStreak(view.bank.hash, "m1")).toBe(0);
        expect(
            () => buttonWithText("学习新的题目"),
            "结束本轮之后应当回到首页",
        ).not.toThrow();
        expect(document.querySelector('[role="progressbar"]')).toBeNull();
        // 本轮的池子与计数一起清了：下次点「学习新的题目」是**新的一轮**
        const stored = loadStoredState(view.bank.hash);
        expect(stored.activePool).toEqual([]);
        expect(stored.roundMastered).toBe(0);
    });

    it("触发区只有箭头那一块：指针扫过这一行的别处不会点亮", async () => {
        view = await mountView(MEMORY_BANK);
        buttonWithText("学习新的题目").click();
        flushSync();

        // 行本身不再是触发区
        roundActionsRow().dispatchEvent(new MouseEvent("mouseenter"));
        flushSync();
        expect(roundActionsRow().dataset.revealed).toBe("false");

        hoverRoundActions();
        expect(roundActionsRow().dataset.revealed).toBe("true");
    });

    it("复习轮没有「结束本轮」：整行只剩退出那一颗", async () => {
        view = await mountView(MEMORY_BANK, (hash) => {
            // 造一张今天到期的复习卡，才进得了复习轮
            saveState(hash, {
                ...emptyState(),
                memory: {
                    progress: { m1: dueToday() },
                    settings: createDefaultMemorySettings(),
                },
            });
        });
        buttonWithText("复习").click();
        flushSync();

        expect(
            document.querySelector('button[aria-label="结束本轮"]'),
            "复习轮不该有「结束本轮」",
        ).toBeNull();
        expect(
            roundActionsRow().querySelectorAll("[data-reveal-part]"),
            "复习轮只剩退出那一部分",
        ).toHaveLength(1);

        // 退出那颗照常：悬停长文案、点了回首页
        hoverRoundActions();
        expect(toolbarButton("退出本轮").textContent).toContain("退出本轮");
        toolbarButton("退出本轮").click();
        flushSync();
        expect(() => buttonWithText("复习")).not.toThrow();
    });

    it("「退出本轮」的文案同样要悬停才出来；它只退出，这一轮还留着", async () => {
        view = await mountView(MEMORY_BANK);
        buttonWithText("学习新的题目").click();
        flushSync();
        pressKey(" ", "Space");
        expect(storedStreak(view.bank.hash, "m1")).toBe(1);

        // 平时按钮里只有那颗箭头，没有文字
        expect(toolbarButton("退出本轮").textContent?.trim()).toBe("");

        hoverRoundActions();
        expect(toolbarButton("退出本轮").textContent).toContain("退出本轮");

        toolbarButton("退出本轮").click();
        flushSync();

        // 回首页了（「学习新的题目」又在），而这一轮的成绩没被清掉
        expect(() => buttonWithText("学习新的题目")).not.toThrow();
        expect(storedStreak(view.bank.hash, "m1")).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 两颗按钮各带一句说明：退出与结束的区别就写在 tooltip 里
// ---------------------------------------------------------------------------

describe("记忆模式：本轮两颗按钮的 tooltip", () => {
    let view: Awaited<ReturnType<typeof mountView>> | null = null;

    afterEach(async () => {
        await closeDialogs();
        view?.destroy();
        view = null;
        localStorage.clear();
        document.body.innerHTML = "";
    });

    // 两颗各用一个挂载：同一时刻只开一份 tooltip，前一份还开着时后一个 trigger
    // 不会变成 active（bits-ui 的行为），挤在一起测只会互相干扰
    it("退出本轮 = 暂时退出 / 保留进度", async () => {
        view = await mountView(MEMORY_BANK);
        buttonWithText("学习新的题目").click();
        flushSync();
        hoverRoundActions();

        // 提示里那个 `Esc` 是 Kbd，textContent 会把键帽文字连在一起
        await expectTooltip(
            toolbarButton("退出本轮"),
            "暂时退出Esc 保留进度",
        );
    });

    it("结束本轮 = 完全退出 / 下次开启新一轮", async () => {
        view = await mountView(MEMORY_BANK);
        buttonWithText("学习新的题目").click();
        flushSync();
        hoverRoundActions();

        await expectTooltip(
            toolbarButton("结束本轮"),
            "完全退出 下次开启新一轮",
        );
    });
});
