import { describe, it, expect } from "vitest";
import { exportProgress, importProgress } from "../src/features/importExport";
import type { Question, QuestionType, RuntimeState, StoredState } from "../src/types";

const HASH = "abcdef0123456789";

function makeQuestion(id: string, type: QuestionType = "judgment"): Question {
  if (type === "single") {
    return {
      id,
      type,
      question: "?",
      options: [{ text: "A" }, { text: "B" }],
      answer: [0],
    };
  }
  if (type === "multiple") {
    return {
      id,
      type,
      question: "?",
      options: [{ text: "A" }, { text: "B" }],
      answer: [0, 1],
    };
  }
  if (type === "blank") {
    return { id, type, question: "?", answer: "ans" };
  }
  return { id, type, question: "?", answer: true };
}

const QUESTIONS: Question[] = [
  makeQuestion("single_1", "single"),
  makeQuestion("blank_2", "blank"),
  makeQuestion("judgment_3", "judgment"),
  makeQuestion("hardest", "judgment"),
  makeQuestion("single_3", "single"),
  makeQuestion("multiple_12", "multiple"),
  makeQuestion("judgment_5", "judgment"),
  makeQuestion("xyz_abc", "judgment"),
  makeQuestion("single_a3", "single"),
  makeQuestion("custom_id", "blank"),
  makeQuestion("^bad", "judgment"),
];

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    masteredIds: ["single_1", "blank_2"],
    activePool: [
      {
        id: "judgment_3",
        consecutiveCorrect: 1,
        hasEverMistaken: false,
        hasBeenShown: true,
        lastSelectedRound: 5,
      },
      {
        id: "hardest",
        consecutiveCorrect: 2,
        hasEverMistaken: true,
        hasBeenShown: true,
        lastSelectedRound: 7,
      },
    ],
    pendingIds: [],
    currentRound: 8,
    filterType: "single",
    settings: {
      autoNextOnCorrect: true,
      activePoolSize: 20,
      correctStreakToMaster: 3,
      correctStreakAfterMistake: 5,
      selectionMode: "sequential",
    },
    ui: {
      progressFocused: false,
      showPool: false,
    },
    ...overrides,
  };
}

async function encodePayload(payload: unknown, hash = HASH): Promise<string> {
  const json = JSON.stringify(payload);
  return encodeRawText(json, hash);
}

async function encodeRawText(text: string, hash = HASH): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const compressed = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    compressed.set(c, off);
    off += c.length;
  }

  let binary = "";
  for (let i = 0; i < compressed.length; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  const b64url = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${hash}.${b64url}`;
}

async function decodePayload(encoded: string): Promise<unknown> {
  const body = encoded.slice(encoded.indexOf(".") + 1);
  const padded = body.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(pad));
  const compressed = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    compressed[i] = binary.charCodeAt(i);
  }

  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.length;
  }

  return JSON.parse(new TextDecoder().decode(bytes));
}

function compact(overrides: Partial<{
  version: unknown;
  questionCount: unknown;
  masteredBitmap: unknown;
  activePool: unknown;
  currentRound: unknown;
  filterCode: unknown;
  settings: unknown;
  ui: unknown;
}> = {}): unknown[] {
  return [
    overrides.version ?? 4,
    overrides.questionCount ?? QUESTIONS.length,
    overrides.masteredBitmap ?? "0",
    overrides.activePool ?? [],
    overrides.currentRound ?? 0,
    overrides.filterCode ?? 0,
    overrides.settings ?? [0, 10, 3, 4, "random"],
    overrides.ui ?? [0, 0],
  ];
}

describe("exportProgress / importProgress round-trip", () => {
  it("完整 state round-trip 恢复 StoredState 字段", async () => {
    const state = makeState();
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);

    expect(restored.masteredIds).toEqual(state.masteredIds);
    expect(restored.activePool).toEqual(state.activePool);
    expect(restored.currentRound).toBe(state.currentRound);
    expect(restored.filterType).toBe(state.filterType);
    expect(restored.settings).toEqual(state.settings);
    expect(restored.ui).toEqual(state.ui);
    expect((restored as RuntimeState).pendingIds).toBeUndefined();
  });

  it("空 state round-trip", async () => {
    const state: StoredState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: {
        autoNextOnCorrect: false,
        activePoolSize: 10,
        correctStreakToMaster: 3,
        correctStreakAfterMistake: 4,
        selectionMode: "random",
      },
      ui: { progressFocused: false, showPool: false },
    };
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);
    expect(restored).toEqual(state);
  });

  it("导出格式：{hash}.{base64url}", async () => {
    const encoded = await exportProgress(makeState(), HASH, QUESTIONS);
    expect(encoded.startsWith(`${HASH}.`)).toBe(true);
    const body = encoded.slice(HASH.length + 1);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("bitmap / index 编码", () => {
  it("已掌握题目用 bitmap hex，活动池题目用题库 index", async () => {
    const encoded = await exportProgress(makeState(), HASH, QUESTIONS);
    const payload = await decodePayload(encoded);

    expect(payload).toEqual([
      4,
      QUESTIONS.length,
      "3",
      [
        [2, 1, 0, 5, 1],
        [3, 2, 1, 7, 1],
      ],
      8,
      1,
      [1, 20, 3, 5, "sequential"],
      [0, 0],
    ]);
    expect(JSON.stringify(payload)).not.toContain("single_1");
    expect(JSON.stringify(payload)).not.toContain("judgment_3");
  });

  it("活动池题目即使出现在 masteredIds 中，导出 bitmap 时也按 0 处理", async () => {
    const state = makeState({
      masteredIds: ["single_1", "judgment_3"],
    });
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);

    expect(restored.masteredIds).toEqual(["single_1"]);
    expect(restored.activePool[0].id).toBe("judgment_3");
  });

  it("自定义 id 和 ^ 开头 id 不需要保留字路径", async () => {
    const state = makeState({
      masteredIds: ["xyz_abc", "single_a3", "^bad"],
      activePool: [
        {
          id: "custom_id",
          consecutiveCorrect: 0,
          hasEverMistaken: false,
          hasBeenShown: false,
          lastSelectedRound: 1,
        },
      ],
    });
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);

    expect(restored.masteredIds).toEqual(["xyz_abc", "single_a3", "^bad"]);
    expect(restored.activePool[0].id).toBe("custom_id");
  });

  it("masteredIds 按题库顺序恢复", async () => {
    const state = makeState({
      masteredIds: ["judgment_5", "blank_2", "single_3"],
      activePool: [],
    });
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);

    expect(restored.masteredIds).toEqual(["blank_2", "single_3", "judgment_5"]);
  });

  it("导出时遇到题库外 id 会抛错", async () => {
    await expect(
      exportProgress(
        makeState({
          masteredIds: ["missing_id"],
          activePool: [],
        }),
        HASH,
        QUESTIONS,
      ),
    ).rejects.toThrow(/题库中不存在/);
  });
});

describe("filterType / settings / ui round-trip", () => {
  const cases: Array<StoredState["filterType"]> = [
    "all",
    "single",
    "multiple",
    "judgment",
    "blank",
  ];
  for (const ft of cases) {
    it(`filterType=${ft}`, async () => {
      const state = makeState({ filterType: ft, masteredIds: [], activePool: [] });
      const encoded = await exportProgress(state, HASH, QUESTIONS);
      const restored = await importProgress(encoded, HASH, QUESTIONS);
      expect(restored.filterType).toBe(ft);
    });
  }

  it("selectionMode=random / autoNextOnCorrect=false", async () => {
    const state = makeState({
      settings: {
        autoNextOnCorrect: false,
        activePoolSize: 15,
        correctStreakToMaster: 2,
        correctStreakAfterMistake: 6,
        selectionMode: "random",
      },
    });
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);
    expect(restored.settings).toEqual(state.settings);
  });

  it("ui 段 round-trip：progressFocused=true, showPool=true", async () => {
    const state = makeState({
      ui: { progressFocused: true, showPool: true },
    });
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);
    expect(restored.ui).toEqual({ progressFocused: true, showPool: true });
  });
});

describe("importProgress 错误处理", () => {
  it("hash 不匹配抛错", async () => {
    const encoded = await exportProgress(makeState(), HASH, QUESTIONS);
    await expect(importProgress(encoded, "differenthash0000", QUESTIONS)).rejects.toThrow(
      /题库版本不匹配/,
    );
  });

  it("无分隔符抛 '找不到版本分隔符'", async () => {
    await expect(importProgress("noseparator", HASH, QUESTIONS)).rejects.toThrow(
      /找不到版本分隔符/,
    );
  });

  it("hash 对但 base64 非法字符 → 解压失败或 Base64 失败", async () => {
    await expect(importProgress(`${HASH}.!!!!`, HASH, QUESTIONS)).rejects.toThrow(
      /解压失败|Base64 解码失败/,
    );
  });

  it("hash 对但解压后 JSON 非法 → 数据解析失败", async () => {
    const encoded = await encodeRawText("not a json {{{");
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /数据解析失败/,
    );
  });

  it("compact 不是数组 → 结构不符合预期", async () => {
    const encoded = await encodePayload({ not: "an array" });
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /结构不符合预期/,
    );
  });

  it("compact 长度不等于 8 → 结构不符合预期", async () => {
    const encoded = await encodePayload([4, QUESTIONS.length, "0"]);
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /结构不符合预期/,
    );
  });

  it("version 不支持 → 进度格式版本不支持", async () => {
    const encoded = await encodePayload(compact({ version: 3 }));
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /进度格式版本不支持/,
    );
  });

  it("题目数量不匹配 → 题目数量不匹配", async () => {
    const encoded = await encodePayload(compact({ questionCount: QUESTIONS.length + 1 }));
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /题目数量不匹配/,
    );
  });

  it("masteredBitmap 不是 hex 字符串 → 已掌握位图格式错误", async () => {
    const encoded = await encodePayload(compact({ masteredBitmap: "not-hex" }));
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /已掌握位图格式错误/,
    );
  });

  it("masteredBitmap 含题库外 bit → 已掌握位图索引越界", async () => {
    const encoded = await encodePayload(
      compact({ questionCount: 2, masteredBitmap: "4" }),
    );
    await expect(importProgress(encoded, HASH, QUESTIONS.slice(0, 2))).rejects.toThrow(
      /已掌握位图索引越界/,
    );
  });

  it("activeRaw 不是数组 → 活动池格式错误", async () => {
    const encoded = await encodePayload(compact({ activePool: "nope" }));
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /活动池格式错误/,
    );
  });

  it("activePool 子项不是 5 元数组 → 活动池条目格式错误", async () => {
    const encoded = await encodePayload(compact({ activePool: [[2, 1, 0]] }));
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /活动池条目格式错误/,
    );

    const encoded2 = await encodePayload(compact({ activePool: [[2, 1, 0, 1]] }));
    await expect(importProgress(encoded2, HASH, QUESTIONS)).rejects.toThrow(
      /活动池条目格式错误/,
    );
  });

  it("activePool 子项不是数组 → 活动池条目格式错误", async () => {
    const encoded = await encodePayload(compact({ activePool: [{}] }));
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /活动池条目格式错误/,
    );
  });

  it("activePool 题目索引越界 → 活动池题目索引错误", async () => {
    const encoded = await encodePayload(compact({ activePool: [[99, 1, 0, 1, 1]] }));
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /活动池题目索引错误/,
    );
  });

  it("settings 不是数组或长度 < 5 → 设置格式错误", async () => {
    const encoded1 = await encodePayload(compact({ settings: "nope" }));
    await expect(importProgress(encoded1, HASH, QUESTIONS)).rejects.toThrow(
      /设置格式错误/,
    );

    const encoded2 = await encodePayload(compact({ settings: [1, 10, 3, 4] }));
    await expect(importProgress(encoded2, HASH, QUESTIONS)).rejects.toThrow(
      /设置格式错误/,
    );
  });

  it("ui 不是数组或长度 < 2 → UI 偏好格式错误", async () => {
    const encoded1 = await encodePayload(compact({ ui: "nope" }));
    await expect(importProgress(encoded1, HASH, QUESTIONS)).rejects.toThrow(
      /UI 偏好格式错误/,
    );

    const encoded2 = await encodePayload(compact({ ui: [1] }));
    await expect(importProgress(encoded2, HASH, QUESTIONS)).rejects.toThrow(
      /UI 偏好格式错误/,
    );
  });

  it("filterCode 越界 → 回退为 all", async () => {
    const encoded = await encodePayload(compact({ filterCode: 99 }));
    const restored = await importProgress(encoded, HASH, QUESTIONS);
    expect(restored.filterType).toBe("all");
  });
});
