import { afterEach, describe, expect, it } from "vitest";
import { QuizSession } from "../src/quiz/session/QuizSession.svelte";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import { quizHeatmapCells } from "../src/features/quiz/overview";
import { memoryHeatmapCells } from "../src/features/memory/overview";
import { createActivePoolItem, saveState } from "../src/store";
import type {
    MemoryProgressMap,
    MemoryQuestion,
    Question,
    StoredState,
} from "../src/types";
import type { SoundPlayer } from "../src/sound/types";

/**
 * 两个模式的总览视图模型（纯函数）。
 *
 * 这层以前埋在 `ReviewView.svelte` / `MemoryOverview.svelte` 的模板里，只能挂
 * 整个 Dialog 才能测；抽出来之后「状态 → 颜色 / 数字」可以直接断言。
 */

const HASH = "overview_model_hash";

const NO_SOUND: SoundPlayer = {
    preload: () => {},
    playAnswer: () => {},
    playSuccess: () => {},
};

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
 * 「还需几次答对」由 `correctStreakToMaster = 3`、`correctStreakAfterMistake = 4`
 * 与 `consecutiveCorrect` 算出来，是确定的。
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
        { hash: HASH, name: "总览题库", mode: "quiz", questions: QUIZ_QUESTIONS },
        { flash: () => {}, toast: () => {}, sound: NO_SOUND },
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
        { hash: HASH, name: "总览题库", mode: "memory", questions: MEMORY_QUESTIONS },
        { flash: () => {}, toast: () => {}, sound: NO_SOUND },
    );
}

/** 从插值色里抠出 `var(--success)` 的权重，用来断言「复习得越深越绿」 */
function successWeight(style: string): number {
    const match = /var\(--success\)\s+([\d.]+)%/.exec(style);
    if (!match) throw new Error(`不是预期的 success 插值色：${style}`);
    return Number.parseFloat(match[1]);
}

afterEach(() => {
    localStorage.clear();
});


describe("刷题模式：热力图格子", () => {
    it("已掌握 / 已掌握曾答错 / 还没刷到 各走一种纯色", () => {
        const cells = quizHeatmapCells(quizSession());
        const byId = new Map(cells.map((cell) => [cell.id, cell]));

        expect(byId.get("done")!.className).toBe("bg-success");
        expect(
            byId.get("done-mistake")!.className,
            "曾答错的已掌握题要红着——它和一次没错过的那张不是一回事",
        ).toBe("bg-destructive");
        expect(byId.get("fresh")!.className).toBe("bg-foreground/15");
        expect(byId.get("fresh")!.status).toBe("还没有刷到");
    });

    it("学习中的格子走插值色，答错过的那张带上 destructive", () => {
        const cells = quizHeatmapCells(quizSession());
        const byId = new Map(cells.map((cell) => [cell.id, cell]));

        const clean = byId.get("learning")!.color!;
        expect(clean).toContain("color-mix(in oklch");
        expect(clean, "没答错过的卡不该出现 destructive").not.toContain(
            "--destructive",
        );

        const mistaken = byId.get("learning-mistake")!.color!;
        expect(mistaken).toContain("color-mix(in oklch");
        expect(
            mistaken,
            "答错过的卡要在插值色里带上一端 destructive",
        ).toContain("--destructive");
    });
});


describe("记忆模式：热力图格子", () => {
    it("未学习与学习中共用灰色，已掌握是绿色", () => {
        const byId = new Map(
            memoryHeatmapCells(memorySession()).map((cell) => [cell.id, cell]),
        );

        expect(byId.get("m-new")!.className).toBe("bg-foreground/15");
        expect(
            byId.get("m-learning")!.className,
            "学习中还没有复习阶梯，和未学习共用灰色",
        ).toBe("bg-foreground/15");
        expect(byId.get("m-done")!.className).toBe("bg-success");
    });

    it("复习中走橙色 → 绿色插值，复习得越深越绿", () => {
        const byId = new Map(
            memoryHeatmapCells(memorySession()).map((cell) => [cell.id, cell]),
        );

        const early = byId.get("m-early")!.color!;
        const late = byId.get("m-late")!.color!;

        expect(early).toContain("color-mix(in oklab");
        expect(early, "插值两端是 success 与 warning").toContain("var(--success)");
        expect(early).toContain("var(--warning)");
        expect(successWeight(late)).toBeGreaterThan(successWeight(early));
    });

    it("状态文案就是「复习中 级数/阈值」，不含 id（无障碍标签会自己拼）", () => {
        const byId = new Map(
            memoryHeatmapCells(memorySession()).map((cell) => [cell.id, cell]),
        );
        expect(byId.get("m-early")!.status).toBe("复习中 2/7");
    });
});
