import { describe, it, expect } from "vitest";
import { exportProgress, importProgress } from "../src/features/importExport";
import { createDefaultMemorySettings } from "../src/features/memory/settings";
import {
  addDays,
  createLearningProgress,
  createReviewProgress,
} from "../src/features/memory/algorithm";
import type {
  MemoryQuestion,
  MemoryStoredState,
  StoredState,
} from "../src/types";

const HASH = "mem0abcdef123456";
const BASE_TIME = new Date(2025, 2, 10, 8, 0, 0).getTime();

const QUESTIONS: MemoryQuestion[] = [
  { id: "m1", question: "取得进步", answer: "make progress" },
  { id: "m2", question: "1+1", answer: "2" },
  { id: "m3", question: "地球最大行星", answer: "错，是木星" },
  { id: "m4", question: "静夜思作者", answer: "李白" },
];

function baseState(memory?: MemoryStoredState): StoredState {
  return {
    masteredIds: [],
    masteredMistakes: {},
    activePool: [],
    currentRound: 3,
    filterType: "all",
    settings: {
      activePoolSize: 25,
      correctStreakToMaster: 3,
      correctStreakAfterMistake: 4,
      selectionMode: "random",
      notifyNewQuestionInPool: false,
    },
    ui: { progressFocused: true, showPool: false },
    memory,
  };
}

/**
 * 把手工构造的紧凑数组压成进度串（和导出同格式），用来测解码端的校验。
 * 必须 await 写流，否则损坏输入会产生未处理的 promise rejection。
 */
async function encodePayload(payload: unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const stream = new Blob([bytes]).stream().pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  const buffer = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return `${HASH}.${btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")}`;
}

/** 把导出的进度串解回紧凑数组（payload = base64url + deflate-raw + JSON） */
async function decodePayload(encoded: string): Promise<unknown[]> {
  const payload = encoded.slice(encoded.indexOf(".") + 1);
  const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const text = new TextDecoder().decode(
    Uint8Array.from(chunks.flatMap((c) => Array.from(c))),
  );
  return JSON.parse(text) as unknown[];
}

describe("记忆模式进度：导入导出往返", () => {
  it("导出再导入，进度与设置都还原", async () => {
    const memory: MemoryStoredState = {
      progress: {
        m1: { ...createReviewProgress(BASE_TIME), level: 3, lapses: 2 },
        m2: { ...createReviewProgress(BASE_TIME), nextDue: addDays(BASE_TIME, 63) },
        m3: createLearningProgress(2),
        m4: { state: "mastered", level: 0, streak: 0, nextDue: 0, lapses: 5 },
      },
      settings: { ...createDefaultMemorySettings(), graduateLevel: 6 },
    };

    const encoded = await exportProgress(baseState(memory), HASH, QUESTIONS);
    expect(encoded.startsWith(`${HASH}.`)).toBe(true);

    const decoded = await importProgress(encoded, HASH, QUESTIONS);

    expect(decoded.memory?.settings).toEqual(memory.settings);
    expect(decoded.memory?.progress).toEqual(memory.progress);
    // 记忆分支下刷题专属字段是空值
    expect(decoded.masteredIds).toEqual([]);
    expect(decoded.activePool).toEqual([]);
    expect(decoded.filterType).toBe("all");
    expect(decoded.ui.progressFocused).toBe(true);
    expect(decoded.currentRound).toBe(3);
  });

  it("导出的版本号是 9；没有 memory 段的题库仍走刷题分支", async () => {
    const withMemory = await exportProgress(
      baseState({
        progress: { m1: createLearningProgress(1) },
        settings: createDefaultMemorySettings(),
      }),
      HASH,
      QUESTIONS,
    );
    const withoutMemory = await exportProgress(
      baseState(undefined),
      HASH,
      QUESTIONS,
    );

    expect((await decodePayload(withMemory))[0]).toBe(9);
    expect((await decodePayload(withoutMemory))[0]).toBe(9);

    // 完全没有 memory 段的（刷题模式）题库，解码后不应多出 memory 段
    const decoded = await importProgress(withoutMemory, HASH, QUESTIONS);
    expect(decoded.memory).toBeUndefined();
  });

  it("一张卡都没学过的记忆题库：仍走记忆分支，掌握阈值与每轮题数不丢", async () => {
    // 关键点：progress 是空的，但题库是记忆模式（有 memory 段）。
    // 早期实现按「progress 非空」判断，这里会掉进刷题分支，
    // 导入后 graduateLevel / roundTarget 静默回到默认值。
    const memory: MemoryStoredState = {
      progress: {},
      settings: { graduateLevel: 3, roundTarget: 9 },
    };

    const encoded = await exportProgress(baseState(memory), HASH, QUESTIONS);
    const payload = await decodePayload(encoded);

    expect(payload).toHaveLength(10);
    // 第 10 项才是记忆 payload
    expect(payload[9]).toEqual([[], [3, 9], []]);

    const decoded = await importProgress(encoded, HASH, QUESTIONS);
    expect(decoded.memory?.settings).toEqual(memory.settings);
    expect(decoded.memory?.progress).toEqual({});
  });

  it("题目数量或 hash 不匹配时报错", async () => {
    const encoded = await exportProgress(
      baseState({
        progress: { m1: createLearningProgress(1) },
        settings: createDefaultMemorySettings(),
      }),
      HASH,
      QUESTIONS,
    );

    await expect(importProgress(encoded, "otherhash0000000", QUESTIONS)).rejects.toThrow(
      /题库版本不匹配/,
    );
    await expect(
      importProgress(encoded, HASH, QUESTIONS.slice(0, 2)),
    ).rejects.toThrow(/题目数量不匹配/);
  });

  it("导入的进度里出现题库中不存在的题目索引时报错", async () => {
    // 手工造一个索引越界的 payload，确认解码端会拒绝
    const encoded = await encodePayload([
      9,
      QUESTIONS.length,
      "",
      [],
      0,
      0,
      [25, 3, 4, "random", 0],
      [0, 0],
      "",
      [[[999, 0, 0, 1, 0, 0]], [7, 5], []],
    ]);

    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /记忆模式题目索引错误/,
    );
  });

  it("到期时间戳超出 Date 上界时拒绝（1e30 是整数，但会让卡片永不到期）", async () => {
    const encoded = await encodePayload([
      9,
      QUESTIONS.length,
      "",
      [],
      0,
      0,
      [25, 3, 4, "random", 0],
      [0, 0],
      "",
      [[[0, 1, 2, 0, 1e30, 0]], [7, 5], []],
    ]);

    await expect(importProgress(encoded, HASH, QUESTIONS)).rejects.toThrow(
      /记忆模式到期时间格式错误/,
    );
  });
});

describe("记忆模式进度：导出失败路径", () => {
  it("进度里有题库不存在的 id 时导出抛错", async () => {
    const state = baseState({
      progress: { gone: createLearningProgress(1) },
      settings: createDefaultMemorySettings(),
    });
    await expect(exportProgress(state, HASH, QUESTIONS)).rejects.toThrow(
      /题库中不存在的题目 id/,
    );
  });
});

describe("记忆模式进度：导出不该被刷题字段拖累", () => {
  it("masteredIds 里带着题库中不存在的 id，记忆模式照样能导出", async () => {
    // 刷题模式会因此报错（下面那条用例），但记忆分支根本不看 masteredIds：
    // 旧数据 / 改过题库之后盘上留下的脏 id 不该让导出挂掉
    const state = baseState({
      progress: { m1: createReviewProgress(BASE_TIME) },
      settings: createDefaultMemorySettings(),
    });
    state.masteredIds = ["已经没有这张卡了"];

    const encoded = await exportProgress(state, HASH, QUESTIONS);
    const decoded = await importProgress(encoded, HASH, QUESTIONS);
    expect(Object.keys(decoded.memory!.progress)).toEqual(["m1"]);
  });

  it("刷题模式仍然严格要求 masteredIds 都在题库里", async () => {
    const state = baseState(undefined);
    state.masteredIds = ["已经没有这张卡了"];
    await expect(exportProgress(state, HASH, QUESTIONS)).rejects.toThrow(
      /题库中不存在的题目 id/,
    );
  });

  it("进度里出现题库不存在的 id 时，报错说清楚是「题库和进度对不上」", async () => {
    const state = baseState({
      progress: { gone: createLearningProgress(1) },
      settings: createDefaultMemorySettings(),
    });
    await expect(exportProgress(state, HASH, QUESTIONS)).rejects.toThrow(
      /请确认这份进度属于当前题库/,
    );
  });
});

describe("记忆模式进度：大进度也不会卡住", () => {
  it("2000 张卡的进度能在超时内导出并原样导回", async () => {
    const bigQuestions = Array.from({ length: 2000 }, (_, i) => ({
      id: `m${i}`,
      question: `q${i}`,
      answer: `a${i}`,
    }));
    const progress: Record<string, ReturnType<typeof createReviewProgress>> = {};
    for (let i = 0; i < 2000; i++) {
      progress[`m${i}`] = {
        ...createReviewProgress(BASE_TIME),
        level: (i % 6) + 1,
        lapses: i % 3,
      };
    }

    // 超时保护：读写顺序写错时（先 await write 再读）Web Streams 会永久挂住
    const encoded = await Promise.race([
      exportProgress(baseState({ progress, settings: createDefaultMemorySettings() }), HASH, bigQuestions),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("导出超时（疑似流背压死锁）")), 4000),
      ),
    ]);

    const decoded = await importProgress(encoded, HASH, bigQuestions);
    expect(Object.keys(decoded.memory!.progress)).toHaveLength(2000);
    expect(decoded.memory!.progress.m1999).toEqual(progress.m1999);
  });
});
