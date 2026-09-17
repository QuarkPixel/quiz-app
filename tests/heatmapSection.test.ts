import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PropertySymbol } from "happy-dom";
import { flushSync, mount, unmount } from "svelte";
import HeatmapHarness, { type HeatmapSubject } from "./HeatmapHarness.svelte";
import { QuizSession } from "../src/quiz/session/QuizSession.svelte";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import { createActivePoolItem, saveState } from "../src/store";
import type {
    MemoryQuestion,
    MemoryProgressMap,
    Question,
    StoredState,
} from "../src/types";
import type { SoundPlayer } from "../src/sound/types";
import type { Toast } from "../src/features/toast.svelte";

/**
 * 热力图组件测试：共享外壳（折叠 / 网格 / 无障碍标签）与两个模式的包装
 * （「题目 → 格子颜色」）各守一条线。
 *
 * 为什么必须挂起来测：这轮重构抽出的共享外壳以前零测试，而它最容易坏的地方
 * ——收起时到底渲不渲染格子、`aria-label` 怎么拼——`svelte-check` 和纯函数测试
 * 都看不见（两个包装的 `cells()` 只产出纯数据，是外壳决定它什么时候被要、怎么显示）。
 *
 * 两个包装要读 session context，这里用**真的** `QuizSession` / `MemorySession`：
 * 进度用 `saveState()` 预置进 localStorage 再让 session 自己加载。这样不用往对象上
 * 打桩，也绕开了加权随机选题（热力图只读进度，压根不走选题目那条路）。
 */

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const HASH = "heatmap_test_hash";

const NO_SOUND: SoundPlayer = {
    preload: () => {},
    playAnswer: () => {},
    playSuccess: () => {},
};
const NO_TOAST: Toast = () => {};

function baseState(): StoredState {
    return {
        masteredIds: [],
        masteredMistakes: {},
        activePool: [],
        currentRound: 0,
        filterType: "all",
        settings: {
            activePoolSize: 25,
            correctStreakToMaster: 3,
            correctStreakAfterMistake: 4,
            selectionMode: "sequential",
            notifyNewQuestionInPool: false,
        },
        ui: { progressFocused: false, showPool: false },
    };
}

/**
 * 五道题各占一种状态：已掌握 / 已掌握但曾答错 / 学习中 / 学习中且曾答错 / 还没刷到。
 *
 * 「还需几次答对」由 `correctStreakToMaster = 3`、`correctStreakAfterMistake = 4`
 * 与 `consecutiveCorrect` 算出来，是确定的——不依赖任何随机数。
 */
const QUIZ_QUESTIONS: Question[] = [
    { id: "done", type: "judgment", question: "已经掌握", answer: true },
    { id: "done-mistake", type: "judgment", question: "掌握但答错过", answer: true },
    { id: "learning", type: "judgment", question: "学习中", answer: true },
    { id: "learning-mistake", type: "judgment", question: "学习中且答错过", answer: true },
    { id: "fresh", type: "judgment", question: "还没刷到", answer: true },
];

function mq(id: string): MemoryQuestion {
    return { id, type: "memory", question: `题-${id}`, answer: `答-${id}` };
}

const MEMORY_QUESTIONS: MemoryQuestion[] = [
    mq("m-new"),
    mq("m-learning"),
    mq("m-early"),
    mq("m-late"),
    mq("m-done"),
];

/** 掌握阈值 7：`m-early` 走到第 3 级（2/7），`m-late` 第 6 级（5/7） */
const MEMORY_GRADUATE_LEVEL = 7;

const MEMORY_PROGRESS: MemoryProgressMap = {
    "m-learning": { state: "learning", level: 0, streak: 1, nextDue: 0, lapses: 0 },
    "m-early": { state: "reviewing", level: 3, streak: 0, nextDue: 0, lapses: 1 },
    "m-late": { state: "reviewing", level: 6, streak: 0, nextDue: 0, lapses: 0 },
    "m-done": { state: "mastered", level: 0, streak: 0, nextDue: 0, lapses: 2 },
};

function quizSession(): QuizSession {
    saveState(HASH, {
        ...baseState(),
        masteredIds: ["done", "done-mistake"],
        masteredMistakes: { "done-mistake": true },
        activePool: [
            {
                ...createActivePoolItem("learning"),
                consecutiveCorrect: 1,
                hasBeenShown: true,
            },
            {
                ...createActivePoolItem("learning-mistake"),
                consecutiveCorrect: 1,
                hasEverMistaken: true,
                hasBeenShown: true,
            },
        ],
    });
    return new QuizSession(
        { hash: HASH, name: "热力图题库", mode: "quiz", questions: QUIZ_QUESTIONS },
        { flash: () => {}, toast: NO_TOAST, sound: NO_SOUND },
    );
}

function memorySession(): MemorySession {
    saveState(HASH, {
        ...baseState(),
        memory: {
            progress: MEMORY_PROGRESS,
            settings: { graduateLevel: MEMORY_GRADUATE_LEVEL, roundTarget: 5 },
        },
    });
    return new MemorySession(
        { hash: HASH, name: "热力图题库", mode: "memory", questions: MEMORY_QUESTIONS },
        { flash: () => {}, toast: NO_TOAST, sound: NO_SOUND },
    );
}

/**
 * 只服务「收起时不查进度」这一条的结构化桩。
 *
 * 真实 `MemorySession.progress` 是 `$derived`，从外面数不出被读了几次，
 * 而那条契约守的正是「收起时别为每道卡查一遍进度」。桩只实现热力图用到的
 * 三个字段：组件一旦改用别的字段会**立刻报错**，不会静静地测不到东西。
 */
function instrumentedMemorySession() {
    const progress: MemoryProgressMap = {};
    let reads = 0;
    const session = {
        questions: MEMORY_QUESTIONS,
        memorySettings: {
            graduateLevel: MEMORY_GRADUATE_LEVEL,
            roundTarget: 5,
        },
        get progress() {
            reads += 1;
            return progress;
        },
    };
    return {
        session: session as unknown as MemorySession,
        reads: () => reads,
    };
}

// ---------------------------------------------------------------------------
// 挂载与查询工具
// ---------------------------------------------------------------------------

interface Mounted {
    host: HTMLElement;
    destroy: () => void;
}

const mounted: Mounted[] = [];

function mountHeatmap(
    subject: HeatmapSubject,
    onJump?: (id: string) => void,
): Mounted {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(HeatmapHarness, { target: host, props: { subject, onJump } });
    flushSync();

    const view: Mounted = {
        host,
        destroy: () => {
            void unmount(app);
            host.remove();
        },
    };
    mounted.push(view);
    return view;
}

afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.destroy();
    localStorage.clear();
});

/** 折叠条：外壳里唯一带 `aria-expanded` 的按钮 */
function collapseBar(host: HTMLElement): HTMLElement {
    const bar = host.querySelector<HTMLElement>("button[aria-expanded]");
    if (!bar) throw new Error("找不到折叠条");
    return bar;
}

/** 格子按钮：折叠条没有 `aria-label`，带 `aria-label` 的都是格子 */
function cellButtons(host: HTMLElement): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>("button[aria-label]")];
}

/** 用 `${id}：` 当锚点：既挑中这一格，也顺带要求标签真是这个格式 */
function cellButton(host: HTMLElement, id: string): HTMLElement {
    const button = host.querySelector<HTMLElement>(
        `button[aria-label^="${id}："]`,
    );
    if (!button) throw new Error(`找不到 ${id} 的格子`);
    return button;
}

/** 格子里的色块——颜色写在它身上，不在按钮上 */
function swatch(host: HTMLElement, id: string): HTMLElement {
    const el = cellButton(host, id).firstElementChild;
    if (!(el instanceof HTMLElement)) throw new Error(`${id} 的格子里没有色块`);
    return el;
}

function expand(host: HTMLElement): void {
    collapseBar(host).click();
    flushSync();
}

/** 从插值色里抠出 `var(--success)` 的权重，用来断言「复习得越深越绿」 */
function successWeight(style: string): number {
    const match = /var\(--success\)\s+([\d.]+)%/.exec(style);
    if (!match) throw new Error(`不是预期的 success 插值色：${style}`);
    return Number.parseFloat(match[1]);
}

// ---------------------------------------------------------------------------
// happy-dom 的坑：`color-mix(...)` 在 DOM 上读不出来
// ---------------------------------------------------------------------------
//
// 「学习中 / 复习中」的颜色只能靠 CSS 插值表达，而 happy-dom 的 CSS 解析器不认
// `color-mix()`：Svelte 用 `dom.style.cssText = …` 写样式，happy-dom 走的是
// 「解析 → 重新序列化」，整条声明被丢掉，DOM 上只剩 `style=""`。
//
// 所以在 `cssText` 的 setter 上搭一层，把**原始字符串**记下来再断言。
//
// ⚠️ 记录要按**元素**存，不能按 `CSSStyleDeclaration` 的引用存：happy-dom 20.14
// 起，那次写入落在的 declaration 会被随后的「把解析结果同步回 style 属性」换掉，
// 于是 `el.style` 已经**不是**刚才被写的那一个（旧写法靠引用相等去认，只会一直返回
// 空串）。happy-dom 自己把宿主元素挂在 declaration 上（`PropertySymbol.element`），
// 直接用它认领，既不赌渲染顺序、也不受对象替换影响。
// 这是测试环境的能力缺口，不是被测组件的行为。

let cssTextDescriptor: PropertyDescriptor | undefined;

/** 元素最后被写进去的 style 原文（没写过就是空串） */
const rawStyleWrites = new WeakMap<Element, string>();

beforeAll(() => {
    cssTextDescriptor = Object.getOwnPropertyDescriptor(
        CSSStyleDeclaration.prototype,
        "cssText",
    );
    Object.defineProperty(CSSStyleDeclaration.prototype, "cssText", {
        configurable: true,
        get: cssTextDescriptor?.get,
        set(this: CSSStyleDeclaration, value: string) {
            const owner = (this as unknown as Record<symbol, unknown>)[
                PropertySymbol.element
            ];
            if (owner instanceof Element) rawStyleWrites.set(owner, value);
            cssTextDescriptor?.set?.call(this, value);
        },
    });
});

afterAll(() => {
    if (cssTextDescriptor) {
        Object.defineProperty(
            CSSStyleDeclaration.prototype,
            "cssText",
            cssTextDescriptor,
        );
    }
});

/** 元素被写过的最后一个 style 字符串；从没写过 style 的格子返回空串 */
function rawStyle(el: HTMLElement): string {
    return rawStyleWrites.get(el) ?? "";
}

// ---------------------------------------------------------------------------
// 1. 折叠语义：收起时不渲染格子，也不算颜色
// ---------------------------------------------------------------------------

describe("折叠语义", () => {
    it("外壳：收起时一个格子都不渲染、也不向 cells 要数据", () => {
        const cells = vi.fn((expanded: boolean) =>
            expanded
                ? [
                      { id: "a", status: "已掌握", className: "bg-success" },
                      { id: "b", status: "还没刷到", className: "bg-foreground/15" },
                  ]
                : [],
        );
        const view = mountHeatmap({
            kind: "shared",
            title: "答题热力图",
            cells,
        });

        expect(cellButtons(view.host), "收起时不该有格子").toHaveLength(0);
        expect(cells, "收起时不该为每道题算一遍颜色").not.toHaveBeenCalled();
        expect(collapseBar(view.host).getAttribute("aria-expanded")).toBe("false");

        collapseBar(view.host).click();
        flushSync();

        expect(cells).toHaveBeenCalledWith(true);
        expect(cellButtons(view.host)).toHaveLength(2);
        expect(collapseBar(view.host).getAttribute("aria-expanded")).toBe("true");

        // 再收回去：格子要从 DOM 里消失，而不是留在 DOM 里被 CSS 藏起来
        collapseBar(view.host).click();
        flushSync();

        expect(cellButtons(view.host)).toHaveLength(0);
        expect(collapseBar(view.host).getAttribute("aria-expanded")).toBe("false");
    });

    it("记忆包装：收起时一次都不读进度，展开后才逐题读", () => {
        const { session, reads } = instrumentedMemorySession();
        const view = mountHeatmap({ kind: "memory", session });

        expect(reads(), "收起时不该为每道卡查一遍进度").toBe(0);

        expand(view.host);

        expect(reads()).toBeGreaterThanOrEqual(MEMORY_QUESTIONS.length);
    });
});

// ---------------------------------------------------------------------------
// 2. 状态 → 颜色：两个模式各自的映射
// ---------------------------------------------------------------------------

describe("刷题模式：题目 → 状态与颜色", () => {
    it("已掌握 / 已掌握曾答错 / 还没刷到 各走一种纯色", () => {
        const view = mountHeatmap({ kind: "quiz", session: quizSession() });
        expand(view.host);

        expect(swatch(view.host, "done").classList.contains("bg-success")).toBe(true);
        expect(
            swatch(view.host, "done-mistake").classList.contains("bg-destructive"),
            "曾答错的已掌握题要红着——它和一次没错过的那张不是一回事",
        ).toBe(true);
        expect(
            swatch(view.host, "fresh").classList.contains("bg-foreground/15"),
        ).toBe(true);
    });

    it("学习中的格子走插值色，答错过的那张带上 destructive", () => {
        const view = mountHeatmap({ kind: "quiz", session: quizSession() });
        expand(view.host);

        const clean = rawStyle(swatch(view.host, "learning"));
        expect(clean).toContain("background-color: color-mix(in oklch");
        expect(clean, "没答错过的卡不该出现 destructive").not.toContain(
            "--destructive",
        );

        const mistaken = rawStyle(swatch(view.host, "learning-mistake"));
        expect(mistaken).toContain("background-color: color-mix(in oklch");
        expect(
            mistaken,
            "答错过的卡要在插值色里带上一端 destructive",
        ).toContain("--destructive");
    });
});

describe("记忆模式：卡片 → 状态与颜色", () => {
    it("未学习与学习中共用灰色，已掌握是绿色", () => {
        const view = mountHeatmap({ kind: "memory", session: memorySession() });
        expand(view.host);

        expect(
            swatch(view.host, "m-new").classList.contains("bg-foreground/15"),
        ).toBe(true);
        expect(
            swatch(view.host, "m-learning").classList.contains("bg-foreground/15"),
            "学习中还没有复习阶梯，和未学习共用灰色",
        ).toBe(true);
        expect(swatch(view.host, "m-done").classList.contains("bg-success")).toBe(
            true,
        );
    });

    it("复习中走橙色 → 绿色插值，复习得越深越绿", () => {
        const view = mountHeatmap({ kind: "memory", session: memorySession() });
        expand(view.host);

        const early = rawStyle(swatch(view.host, "m-early"));
        const late = rawStyle(swatch(view.host, "m-late"));

        expect(early).toContain("background-color: color-mix(in oklab");
        expect(early, "插值两端是 success 与 warning").toContain("var(--success)");
        expect(early).toContain("var(--warning)");
        // 方向反了会变成「快掌握的卡更红」：级数越深，success 的权重必须越大
        expect(successWeight(late)).toBeGreaterThan(successWeight(early));
    });
});

// ---------------------------------------------------------------------------
// 3. 无障碍标签：`${题目 id}：${状态}`，状态里不再自带 id
// ---------------------------------------------------------------------------

describe("无障碍标签", () => {
    it("刷题模式：拼成 `id：状态`，id 只出现一次", () => {
        const view = mountHeatmap({ kind: "quiz", session: quizSession() });
        expand(view.host);

        const label = cellButton(view.host, "done-mistake").getAttribute("aria-label");
        expect(label).toBe("done-mistake：已掌握，曾答错");
        // 以前两份实现里有一份把 id 拼进了 status，于是标签里出现两次 id
        expect(label?.match(/done-mistake/g)).toHaveLength(1);
    });

    it("记忆模式：同样只拼一次 id（两份实现的格式已经统一）", () => {
        const view = mountHeatmap({ kind: "memory", session: memorySession() });
        expand(view.host);

        const label = cellButton(view.host, "m-early").getAttribute("aria-label");
        expect(label).toBe("m-early：复习中 2/7");
        expect(label?.match(/m-early/g)).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// 4. 点击跳转
// ---------------------------------------------------------------------------

describe("点击跳转", () => {
    it("刷题模式：点格子把题目 id 交给 onJump", () => {
        const onJump = vi.fn();
        const view = mountHeatmap(
            { kind: "quiz", session: quizSession() },
            onJump,
        );
        expand(view.host);

        cellButton(view.host, "fresh").click();
        flushSync();

        expect(onJump).toHaveBeenCalledTimes(1);
        expect(onJump).toHaveBeenCalledWith("fresh");
    });

    it("记忆模式：不传 onJump 时点格子不抛错", () => {
        const view = mountHeatmap({ kind: "memory", session: memorySession() });
        expand(view.host);

        // 事件回调里抛出的异常会直接从这里冒出来（happy-dom 不吞它），包一层就够
        expect(() => {
            cellButton(view.host, "m-new").click();
            flushSync();
        }).not.toThrow();
    });
});
