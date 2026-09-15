import { afterEach, describe, expect, it } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import ViewHarness from "./ViewHarness.svelte";
import { BankStore } from "../src/source/bankStore";
import type { Bank } from "../src/source/types";

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

const MEMORY_BANK = JSON.stringify({
    mode: "memory",
    title: "记忆题库",
    questions: [{ id: "m1", question: "取得进步", answer: "make progress" }],
});

async function mountView(json: string): Promise<{
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

        expect(dialogTitles(), "弹窗内的 ⌘I 不该再切一次").toContain(
            "当前题库设置 题库 名称   题型筛选 ",
        );
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
