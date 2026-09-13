import { describe, it, expect } from "vitest";
import { memoryModeDef } from "../src/quiz/modes/memory";
import { BANK_MODES } from "../src/quiz/modes";
import { QUESTION_TYPES } from "../src/quiz/types/registry";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import { globalSettingsStore } from "../src/features/globalSettings.svelte";
import type { MemoryBank } from "../src/source/types";
import { parseBankFile, parseBankFileJson, formatBankFile } from "../src/lib/bankFile";
import { createDefaultMemorySettings } from "../src/features/memory/settings";
import {
  addDays,
  createLearningProgress,
  createReviewProgress,
  startOfDay,
} from "../src/features/memory/algorithm";
import type { RuntimeState, StoredState } from "../src/types";

const BASE_TIME = new Date(2025, 0, 1, 9, 0, 0).getTime();

function runtimeState(memory: StoredState["memory"]): RuntimeState {
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
      selectionMode: "random",
      notifyNewQuestionInPool: false,
    },
    ui: { progressFocused: false, showPool: false },
    pendingIds: [],
    memory,
  };
}

describe("记忆模式：模式注册", () => {
  it("BANK_MODES 里注册的是 memoryModeDef", () => {
    expect(BANK_MODES.memory).toBe(memoryModeDef);
    expect(memoryModeDef.mode).toBe("memory");
    expect(memoryModeDef.label).toBe("记忆模式");
  });
});

describe("记忆模式：validateQuestions", () => {
  it("合法的 id / question / answer 通过，并原样返回", () => {
    const raw = [
      { id: "m1", question: "取得进步", answer: "make progress" },
      { id: "m2", question: "1+1=?", answer: "2", extra: "ignored" },
    ];
    const result = memoryModeDef.validateQuestions(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0].id).toBe("m1");
      // 允许额外字段（不参与渲染，但也不报错）
      expect(result.questions[1]).toMatchObject({ id: "m2" });
    }
  });

  it("非数组 / 空数组报错", () => {
    expect(memoryModeDef.validateQuestions(undefined)).toMatchObject({
      ok: false,
    });
    expect(memoryModeDef.validateQuestions({})).toMatchObject({ ok: false });
    expect(memoryModeDef.validateQuestions([])).toMatchObject({
      ok: false,
      errors: ["题库为空。"],
    });
  });

  it("缺字段 / 类型不对 / id 重复都会报错", () => {
    const result = memoryModeDef.validateQuestions([
      { id: "", question: "q", answer: "a" },
      { id: "x", question: "", answer: "a" },
      { id: "y", question: "q", answer: 123 },
      { id: "z", question: "q", answer: "a" },
      { id: "z", question: "q2", answer: "a2" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("缺少 id");
      expect(result.errors.join("\n")).toContain("question 必须是非空字符串");
      expect(result.errors.join("\n")).toContain("answer 必须是非空字符串");
      expect(result.errors.join("\n")).toContain("id 重复");
    }
  });
});

describe("记忆模式：题库文件解析", () => {
  it("mode=memory 能解析；省略 mode 仍按 quiz 校验", () => {
    const parsed = parseBankFileJson(
      JSON.stringify({
        mode: "memory",
        questions: [{ id: "m1", question: "q", answer: "a" }],
      }),
    );
    expect(parsed).toMatchObject({ ok: true, mode: "memory" });
    if (parsed.ok && parsed.mode === "memory") {
      expect(parsed.questions[0].answer).toBe("a");
    }

    // 省略 mode → quiz；记忆题目没有 type，应当被刷题校验拒绝
    const asQuiz = parseBankFile({
      questions: [{ id: "m1", question: "q", answer: "a" }],
    });
    expect(asQuiz.ok).toBe(false);
  });

  it("Prompt 生成的结构（带 mode 的记忆题库）能直接导入；漏写 mode 会失败", () => {
    // assets/prompts/memory.md 给的示例结构，必须能原样导入
    const fromPrompt = parseBankFileJson(
      JSON.stringify({
        mode: "memory",
        questions: [
          { id: "memory_1", question: "取得进步", answer: "make progress" },
          { id: "memory_2", question: "《静夜思》的作者是谁？", answer: "李白" },
        ],
      }),
    );
    expect(fromPrompt).toMatchObject({ ok: true, mode: "memory" });

    // 漏写 mode：程序按 quiz 解析，记忆卡片会因为缺少 type 而报错
    const missingMode = parseBankFileJson(
      JSON.stringify({
        questions: [{ id: "memory_1", question: "取得进步", answer: "make progress" }],
      }),
    );
    expect(missingMode.ok).toBe(false);
    if (!missingMode.ok) {
      expect(missingMode.errors.join("\n")).toContain("type 不合法");
    }
  });

  it("formatBankFile 往返保持 mode / questions", () => {
    const text = formatBankFile({
      mode: "memory",
      questions: [{ id: "m1", question: "q", answer: "a" }],
    });
    const parsed = parseBankFileJson(text);
    expect(parsed).toMatchObject({ ok: true, mode: "memory" });
    expect(JSON.parse(text).mode).toBe("memory");
  });

  it("非法 mode 报错信息提到 memory", () => {
    const parsed = parseBankFile({
      // 改写名前用过的旧字符串：不提供兼容，直接报错并提示新值
      mode: "recite",
      questions: [{ id: "m1", question: "q", answer: "a" }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors[0]).toContain("memory");
    }
  });
});

describe("记忆模式：旧题库兼容", () => {
  it("题目缺 type 时（重构前存下的题库）会话自动补成 memory", () => {
    const hash = "legacy_memory_hash";
    // 模拟重构前存进 localStorage 的题库：题目只有 id / question / answer
    const legacyQuestions = [
      { id: "m1", question: "取得进步", answer: "make progress" },
      { id: "m2", question: "静夜思作者", answer: "李白" },
    ];
    localStorage.setItem(
      `quiz_app_questions_${hash}`,
      JSON.stringify(legacyQuestions),
    );

    const bank = {
      hash,
      name: "旧记忆题库",
      mode: "memory",
      questions: legacyQuestions,
    } as unknown as MemoryBank;
    const session = new MemorySession(
      bank,
      { flash: () => {}, toast: () => {}, sound: {} as never },
      globalSettingsStore,
    );

    // 所有题目都被补上 type: "memory"，QUESTION_TYPES 才能查到 icon/Input/Review
    expect(session.questions.every((q) => q.type === "memory")).toBe(true);
    expect(
      QUESTION_TYPES[session.questions[0].type].icon,
    ).toBeTruthy();

    // 修正后的题库也写回了 localStorage，下次读不再缺字段
    const stored = JSON.parse(
      localStorage.getItem(`quiz_app_questions_${hash}`) ?? "[]",
    );
    expect(stored[0].type).toBe("memory");

    // 能正常进入学习流
    session.startLearning();
    expect(session.run).toBe("learning");
    expect(session.currentQuestion).toBeTruthy();
  });
});

describe("记忆模式：总览接口", () => {
  // 记忆模式的总览由 MemoryOverview.svelte 自己渲染（按四类状态分组 + 搜索 +
  // 热力图），不走 BankModeDef.buildOverview 这个通用接口——和刷题模式一样
  // 返回 null，由 App 按 bank.mode 选择对应的总览组件。
  it("buildOverview 返回 null（总览由 MemoryOverview 自己渲染）", () => {
    expect(memoryModeDef.buildOverview()).toBeNull();
  });
});
