import { describe, it, expect, vi, afterEach } from "vitest";
import { exportProgress, importProgress } from "../src/features/importExport";
import type {
  Question,
  QuestionType,
  RuntimeState,
  StoredState,
} from "../src/types";

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
    masteredMistakes: {
      blank_2: true,
    },
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
      activePoolSize: 20,
      correctStreakToMaster: 3,
      correctStreakAfterMistake: 5,
      selectionMode: "sequential",
      notifyNewQuestionInPool: false,
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

function compact(
  overrides: Partial<{
    version: unknown;
    questionCount: unknown;
    masteredBitmap: unknown;
    activePool: unknown;
    currentRound: unknown;
    filterCode: unknown;
    settings: unknown;
    ui: unknown;
    masteredMistakes: unknown;
  }> = {},
): unknown[] {
  const version = overrides.version ?? 4;
  const base = [
    version,
    overrides.questionCount ?? QUESTIONS.length,
    overrides.masteredBitmap ?? "0",
    overrides.activePool ?? [],
    overrides.currentRound ?? 0,
    overrides.filterCode ?? 0,
    overrides.settings ?? [0, 10, 3, 4, "random"],
    overrides.ui ?? [0, 0],
  ];
  return version >= 5 ? [...base, overrides.masteredMistakes ?? "0"] : base;
}

describe("exportProgress / importProgress round-trip", () => {
  it("完整 state round-trip 恢复 StoredState 字段", async () => {
    const state = makeState();
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);

    expect(restored.masteredIds).toEqual(state.masteredIds);
    expect(restored.masteredMistakes).toEqual(state.masteredMistakes);
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
      masteredMistakes: {},
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: {
        activePoolSize: 10,
        correctStreakToMaster: 3,
        correctStreakAfterMistake: 4,
        selectionMode: "random",
        notifyNewQuestionInPool: false,
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
      9,
      QUESTIONS.length,
      "3",
      [
        [2, 1, 0, 5, 1],
        [3, 2, 1, 7, 1],
      ],
      8,
      1,
      [20, 3, 5, "sequential", 0],
      [0, 0],
      "2",
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
      masteredMistakes: {
        judgment_5: true,
        single_3: true,
      },
      activePool: [],
    });
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);

    expect(restored.masteredIds).toEqual(["blank_2", "single_3", "judgment_5"]);
    expect(restored.masteredMistakes).toEqual({
      single_3: true,
      judgment_5: true,
    });
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
      const state = makeState({
        filterType: ft,
        masteredIds: [],
        activePool: [],
      });
      const encoded = await exportProgress(state, HASH, QUESTIONS);
      const restored = await importProgress(encoded, HASH, QUESTIONS);
      expect(restored.filterType).toBe(ft);
    });
  }

  it("selectionMode=random / notifyNewQuestionInPool=true", async () => {
    const state = makeState({
      settings: {
        activePoolSize: 15,
        correctStreakToMaster: 2,
        correctStreakAfterMistake: 6,
        selectionMode: "random",
        notifyNewQuestionInPool: true,
      },
    });
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);
    expect(restored.settings).toEqual(state.settings);
  });

  it("v8 settings 段只包含按库设置", async () => {
    const state = makeState();
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const payload = await decodePayload(encoded);

    expect((payload as unknown[])[6]).toEqual([20, 3, 5, "sequential", 0]);
  });

  it("进度备份不编码全局设置（音效 / 自动提交 / 自动下一题）", async () => {
    const state = makeState();
    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const restored = await importProgress(encoded, HASH, QUESTIONS);

    expect(restored.settings).toEqual(state.settings);
    expect("soundEnabled" in restored.settings).toBe(false);
    expect("autoSubmitOnSelection" in restored.settings).toBe(false);
    expect("autoNextOnCorrect" in restored.settings).toBe(false);
  });

  it("旧进度（v7）忽略全局字段，只还原按库设置", async () => {
    const encoded = await encodePayload(
      compact({ version: 7, settings: [1, 0, 20, 3, 5, "sequential", 1, 1] }),
    );
    const restored = await importProgress(encoded, HASH, QUESTIONS);

    expect(restored.settings).toEqual({
      activePoolSize: 20,
      correctStreakToMaster: 3,
      correctStreakAfterMistake: 5,
      selectionMode: "sequential",
      notifyNewQuestionInPool: true,
    });
    expect("soundEnabled" in restored.settings).toBe(false);
    expect("autoNextOnCorrect" in restored.settings).toBe(false);
  });

  it("旧进度（v4）忽略全局字段，只还原按库设置", async () => {
    const encoded = await encodePayload(
      compact({ settings: [1, 10, 3, 4, "random"] }),
    );
    const restored = await importProgress(encoded, HASH, QUESTIONS);

    expect(restored.settings).toEqual({
      activePoolSize: 10,
      correctStreakToMaster: 3,
      correctStreakAfterMistake: 4,
      selectionMode: "random",
      notifyNewQuestionInPool: false,
    });
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
    await expect(
      importProgress(encoded, "differenthash0000", QUESTIONS),
    ).rejects.toThrow(/题库版本不匹配/);
  });

  it("无分隔符抛 '找不到版本分隔符'", async () => {
    await expect(
      importProgress("noseparator", HASH, QUESTIONS),
    ).rejects.toThrow(/找不到版本分隔符/);
  });

  it("hash 对但 base64 非法字符 → 解压失败或 Base64 失败", async () => {
    await expect(
      importProgress(`${HASH}.!!!!`, HASH, QUESTIONS),
    ).rejects.toThrow(/内容已损坏，无法解码/);
  });

  it("hash 对但解压后 JSON 非法 → 内容已损坏", async () => {
    const encoded = await encodeRawText("not a json {{{");
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /内容已损坏，无法解析/,
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
    const encoded = await encodePayload(
      compact({ questionCount: QUESTIONS.length + 1 }),
    );
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
    await expect(
      importProgress(encoded, HASH, QUESTIONS.slice(0, 2)),
    ).rejects.toThrow(/已掌握位图索引越界/);
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

    const encoded2 = await encodePayload(
      compact({ activePool: [[2, 1, 0, 1]] }),
    );
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
    const encoded = await encodePayload(
      compact({ activePool: [[99, 1, 0, 1, 1]] }),
    );
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /活动池题目索引错误/,
    );
  });

  it("activePool 数值字段不是非负整数 → 拒绝导入", async () => {
    const invalidStreak = await encodePayload(
      compact({ activePool: [[2, "1", 0, 1, 1]] }),
    );
    await expect(importProgress(invalidStreak, HASH, QUESTIONS)).rejects.toThrow(
      /活动池连续答对次数格式错误/,
    );

    const invalidRound = await encodePayload(
      compact({ activePool: [[2, 1, 0, -1, 1]] }),
    );
    await expect(importProgress(invalidRound, HASH, QUESTIONS)).rejects.toThrow(
      /活动池轮次格式错误/,
    );
  });

  it("activePool 标记字段不是 0/1 → 拒绝导入", async () => {
    const encoded = await encodePayload(
      compact({ activePool: [[2, 1, "false", 1, 1]] }),
    );
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /活动池答错标记格式错误/,
    );
  });

  it("currentRound 不是非负整数 → 拒绝导入", async () => {
    const encoded = await encodePayload(compact({ currentRound: "8" }));
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /当前轮次格式错误/,
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

  it("settings 数值字段不是非负整数 → 拒绝导入", async () => {
    const invalidPoolSize = await encodePayload(
      compact({ settings: [0, "10", 3, 4, "random"] }),
    );
    await expect(importProgress(invalidPoolSize, HASH, QUESTIONS)).rejects.toThrow(
      /活动池大小设置格式错误/,
    );

    const invalidThreshold = await encodePayload(
      compact({ settings: [0, 10, "3", 4, "random"] }),
    );
    await expect(importProgress(invalidThreshold, HASH, QUESTIONS)).rejects.toThrow(
      /掌握次数设置格式错误/,
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

  it("ui 标记字段不是 0/1 → 拒绝导入", async () => {
    const encoded = await encodePayload(compact({ ui: ["yes", 0] }));
    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /进度聚焦偏好格式错误/,
    );
  });

  it("filterCode 越界 → 回退为 all", async () => {
    const encoded = await encodePayload(compact({ filterCode: 99 }));
    const restored = await importProgress(encoded, HASH, QUESTIONS);
    expect(restored.filterType).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// 流背压：绝不「先 await 写、再开始读」
// ---------------------------------------------------------------------------

describe("压缩流不会因为背压死锁", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("写端要等读端才会完成时，导出仍然能在超时内返回", async () => {
    // 规范 / Deno 的 TransformStream 会把背压传给写端：没人读的时候 write()
    // 不会 resolve。曾经的写法是 `await writer.write(data)` 之后才开始读，
    // 在这种实现下会永久挂住——表现成「点了导出没反应」（浏览器同样可能如此）。
    // 这个替身把那种行为固定下来：write 只在读端 pull 之后才完成。
    class GatedCompressionStream {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<BufferSource>;

      constructor() {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let controller!: ReadableStreamDefaultController<Uint8Array>;

        // highWaterMark: 0 → 只有真的有人在 read 时才会 pull，
        // 也就是「没人读 → 写端永远等不到放行」的背压行为
        this.readable = new ReadableStream<Uint8Array>(
          {
            start(c) {
              controller = c;
            },
            pull() {
              release();
            },
          },
          { highWaterMark: 0 },
        );
        this.writable = new WritableStream<BufferSource>({
          async write(chunk) {
            await gate;
            controller.enqueue(new Uint8Array(chunk as ArrayBuffer));
          },
          close() {
            controller.close();
          },
        });
      }
    }

    vi.stubGlobal("CompressionStream", GatedCompressionStream);

    const encoded = await Promise.race([
      exportProgress(makeState(), HASH, QUESTIONS),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("导出超时：写端在等读端，顺序写错了")),
          3000,
        ),
      ),
    ]);

    expect(encoded.startsWith(`${HASH}.`)).toBe(true);
  });
});
