import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import MemorySettingsHarness from "./MemorySettingsHarness.svelte";
import { BankStore } from "../src/source/bankStore";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import { globalSettingsStore } from "../src/features/globalSettings.svelte";
import {
    cumulativeIntervalDays,
    MEMORY_GRADUATE_LEVEL_BOUNDS as BOUNDS,
} from "../src/features/memory/algorithm";
import { createDefaultMemorySettings } from "../src/features/memory/settings";
import {
    createDefaultSettings,
    createDefaultUiPreferences,
    loadStoredState,
    saveState,
} from "../src/store";
import type { StoredState } from "../src/types";

/**
 * 「掌握阈值」那颗滑块（`MemorySettings.svelte` 里唯一的 shadcn Slider）的组件测试。
 *
 * 为什么值得单独守这三件事：
 *   - **刻度与刻度标签真的渲染出来了**。滑块的 `children` 片段要能透到 bits-ui 原语，
 *     而 `ui/slider` 的根组件自带一个默认片段（轨道 + 滑块）：它一旦盖掉调用方传进来的
 *     同名片段，刻度和标签就**静默消失**——类型检查、构建、别的用例全都看不出来。
 *   - **打开面板不改设置**。滑块是受控的（`value={threshold}` + `onValueChange` 落盘）：
 *     挂载时若多发一次 `onValueChange`，用户一开设置面板阈值就被改成值域下限（3），
 *     整条复习曲线跟着变。这种数据损坏只在运行时显形。
 *   - **刻度的排布**：按**层级**等距、标签是该层级的累计天数（2^(n-1) 曲线）。
 *     真按天数当 `step`（`[7, 15, 31, …876]`），8 个刻度会全挤在左边、标签叠成一团
 *     ——这正是这版改之前的样子。
 *
 * 时间固定、不依赖系统时钟与动画帧（同 `memoryOverview.test.ts` 的约定）。
 */

const BASE_TIME = new Date(2025, 0, 1, 10, 30, 0).getTime();

const MEMORY_BANK_JSON = JSON.stringify({
    mode: "memory",
    title: "记忆题库",
    questions: ["m1", "m2"].map((id) => ({
        id,
        type: "memory",
        question: `题-${id}`,
        answer: `答-${id}`,
    })),
});

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

interface Mounted {
    session: MemorySession;
    hash: string;
    destroy: () => void;
}

/**
 * 挂起设置面板。阈值一律用默认值（7）显式落盘：下面那串天数（7/15/…/127）
 * 都从它推出来，跟着默认值漂会让用例的说法含糊。
 *
 * `beforeMount` 用来在挂载**之前**给 session 装探针（`vi.spyOn`）。
 */
async function mountSettings(
    beforeMount?: (session: MemorySession) => void,
): Promise<Mounted> {
    localStorage.clear();
    const source = new BankStore();
    const result = await source.importBank("记忆题库", MEMORY_BANK_JSON);
    expect(result.kind, "题库没导进去，后面的断言没意义").toBe("ok");

    const bank = source.getActiveBank();
    if (!bank || bank.mode !== "memory") {
        throw new Error("导入成功但拿不到记忆题库");
    }

    // 进度必须先落盘：MemorySession 是在构造函数里读 localStorage 的
    saveState(bank.hash, {
        ...emptyState(),
        memory: { progress: {}, settings: createDefaultMemorySettings() },
    });

    const session = new MemorySession(
        bank,
        { flash: () => {}, toast: () => {}, sound: { play: () => {} } as never },
        globalSettingsStore,
        { now: () => BASE_TIME },
    );
    beforeMount?.(session);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(MemorySettingsHarness, {
        target: host,
        props: { session, source, hash: bank.hash, bankName: bank.title },
    });
    flushSync();

    return {
        session,
        hash: bank.hash,
        destroy: () => {
            void unmount(app);
            host.remove();
        },
    };
}

// ── DOM 查询：对话框走 portal 挂在 body 上，一律整页找 ─────────────────────

function ticks(): HTMLElement[] {
    return [
        ...document.querySelectorAll<HTMLElement>('[data-slot="slider-tick"]'),
    ];
}

function tickLabels(): HTMLElement[] {
    return [
        ...document.querySelectorAll<HTMLElement>(
            '[data-slot="slider-tick-label"]',
        ),
    ];
}

function thumb(): HTMLElement {
    const el = document.querySelector<HTMLElement>('[data-slot="slider-thumb"]');
    if (!el) throw new Error("掌握阈值那颗滑块的滑块头没渲染出来");
    return el;
}

/** 阈值那一行里「约 N 天」的文案 */
function totalDaysText(): string {
    const match = document.body.textContent?.match(/约\s*(\d+)\s*天/);
    if (!match) throw new Error("设置面板里找不到「约 N 天」");
    return match[1];
}

/** 每个层级一条刻度，标签就是该层级的累计天数。 */
function expectedLabels(): string[] {
    const labels = [];
    for (let level = BOUNDS.min; level <= BOUNDS.max; level++) {
        labels.push(`${cumulativeIntervalDays(level)}天`);
    }
    return labels;
}

let mounted: Mounted | null = null;

afterEach(() => {
    mounted?.destroy();
    mounted = null;
    // portal 残留 + bits-ui 的 ScrollLock 往 body 上写的 style，逐个用例复原
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    localStorage.clear();
});

describe("掌握阈值滑块", () => {
    it("每个层级一条刻度，标签是累计天数，当前阈值那条选中", async () => {
        mounted = await mountSettings();

        // 先确认阈值确实是默认的 7：下面「哪条选中」说的是这个数
        expect(mounted.session.memorySettings.graduateLevel).toBe(7);

        expect(
            ticks().length,
            "刻度没渲染出来：children 片段被包装层的默认片段盖掉了？",
        ).toBe(BOUNDS.max - BOUNDS.min + 1);
        expect(tickLabels().map((el) => el.textContent?.trim())).toEqual(
            expectedLabels(),
        );
        expect(
            ticks()
                .filter((el) => el.hasAttribute("data-selected"))
                .map((el) => el.dataset.value),
            "选中的不是当前阈值那一条",
        ).toEqual(["7"]);
    });

    it("挂载时不动设置：受控滑块不该多发一次 onValueChange", async () => {
        // 探针只数次数，真实现照旧跑（万一以后真的发了一次，落盘断言也才说得通）
        let updateCalls = 0;
        mounted = await mountSettings((session) => {
            const original = session.updateMemorySettings.bind(session);
            vi.spyOn(session, "updateMemorySettings").mockImplementation(
                (patch) => {
                    updateCalls += 1;
                    original(patch);
                },
            );
        });

        expect(
            updateCalls,
            "挂载就写了一次设置：用户一打开面板阈值就被改掉了",
        ).toBe(0);
        expect(loadStoredState(mounted.hash).memory?.settings.graduateLevel).toBe(
            7,
        );
    });

    it("方向键调高阈值：写回 session、落盘，并刷新「约 N 天」", async () => {
        mounted = await mountSettings();

        thumb().dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
        flushSync();

        expect(mounted.session.memorySettings.graduateLevel).toBe(8);
        expect(
            loadStoredState(mounted.hash).memory?.settings.graduateLevel,
            "改了却没落盘：刷新页面阈值又回去了",
        ).toBe(8);
        expect(totalDaysText()).toBe(String(cumulativeIntervalDays(8)));
    });
});
