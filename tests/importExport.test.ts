import { describe, it, expect } from "vitest";
import { exportProgress, importProgress } from "../src/features/importExport";
import type { RuntimeState, StoredState } from "../src/types";

const HASH = "abcdef0123456789";

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    masteredIds: ["single_1", "blank_2"],
    activePool: [
      {
        id: "judgment_3",
        consecutiveCorrect: 1,
        hasEverMistaken: false,
        lastSelectedRound: 5,
      },
      {
        id: "hardest",
        consecutiveCorrect: 2,
        hasEverMistaken: true,
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
    ...overrides,
  };
}

/** 给定一个 compact 数组，按照内部编码流程产出一个合法编码串。 */
async function encodeCompact(compact: unknown, hash: string): Promise<string> {
  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json);
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

describe("exportProgress / importProgress round-trip", () => {
  it("完整 state round-trip 恢复 StoredState 字段", async () => {
    const state = makeState();
    const encoded = await exportProgress(state, HASH);
    const restored = await importProgress(encoded, HASH);

    expect(restored.masteredIds).toEqual(state.masteredIds);
    expect(restored.activePool).toEqual(state.activePool);
    expect(restored.currentRound).toBe(state.currentRound);
    expect(restored.filterType).toBe(state.filterType);
    expect(restored.settings).toEqual(state.settings);
    // pendingIds 不应出现在导入结果里
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
    };
    const encoded = await exportProgress(state, HASH);
    const restored = await importProgress(encoded, HASH);
    expect(restored).toEqual(state);
  });

  it("导出格式：{hash}.{base64url}", async () => {
    const encoded = await exportProgress(makeState(), HASH);
    expect(encoded.startsWith(`${HASH}.`)).toBe(true);
    const body = encoded.slice(HASH.length + 1);
    // base64url 字符集：A-Z a-z 0-9 - _
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("id 编码：各题型前缀", () => {
  it("single_3 / multiple_12 / judgment_5 / blank_2 round-trip", async () => {
    const state = makeState({
      masteredIds: ["single_3", "multiple_12", "judgment_5", "blank_2"],
      activePool: [],
    });
    const encoded = await exportProgress(state, HASH);
    const restored = await importProgress(encoded, HASH);
    expect(restored.masteredIds).toEqual([
      "single_3",
      "multiple_12",
      "judgment_5",
      "blank_2",
    ]);
  });

  it("不含下划线的自定义 id 走 ^ 路径", async () => {
    const state = makeState({
      masteredIds: ["hardest"],
      activePool: [],
    });
    const encoded = await exportProgress(state, HASH);
    const restored = await importProgress(encoded, HASH);
    expect(restored.masteredIds).toEqual(["hardest"]);
  });

  it("含下划线但 type 非已知前缀的自定义 id 走 ^ 路径", async () => {
    const state = makeState({
      masteredIds: ["xyz_abc"],
      activePool: [],
    });
    const encoded = await exportProgress(state, HASH);
    const restored = await importProgress(encoded, HASH);
    expect(restored.masteredIds).toEqual(["xyz_abc"]);
  });

  it("已知前缀但数字部分非纯数字的 id 走 ^ 路径", async () => {
    const state = makeState({
      masteredIds: ["single_a3"],
      activePool: [],
    });
    const encoded = await exportProgress(state, HASH);
    const restored = await importProgress(encoded, HASH);
    expect(restored.masteredIds).toEqual(["single_a3"]);
  });

  it("activePool 中的自定义 id 也能 round-trip", async () => {
    const state = makeState({
      masteredIds: [],
      activePool: [
        {
          id: "custom_id",
          consecutiveCorrect: 0,
          hasEverMistaken: false,
          lastSelectedRound: 1,
        },
      ],
    });
    const encoded = await exportProgress(state, HASH);
    const restored = await importProgress(encoded, HASH);
    expect(restored.activePool[0].id).toBe("custom_id");
  });
});

describe("filterType code round-trip", () => {
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
      const encoded = await exportProgress(state, HASH);
      const restored = await importProgress(encoded, HASH);
      expect(restored.filterType).toBe(ft);
    });
  }
});

describe("settings round-trip", () => {
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
    const encoded = await exportProgress(state, HASH);
    const restored = await importProgress(encoded, HASH);
    expect(restored.settings).toEqual(state.settings);
  });
});

describe("importProgress 错误处理", () => {
  it("hash 不匹配抛错", async () => {
    const encoded = await exportProgress(makeState(), HASH);
    await expect(importProgress(encoded, "differenthash0000")).rejects.toThrow(
      /题库版本不匹配/,
    );
  });

  it("无分隔符抛 '找不到版本分隔符'", async () => {
    await expect(importProgress("noseparator", HASH)).rejects.toThrow(
      /找不到版本分隔符/,
    );
  });

  it("hash 对但 base64 非法字符 → 解压失败（atob 容忍部分非法字符）", async () => {
    // atob 对某些非法字符会抛、某些会跳过；这里用一个能解码但解压必败的 payload
    await expect(importProgress(`${HASH}.!!!!`, HASH)).rejects.toThrow(
      /解压失败|Base64 解码失败/,
    );
  });

  it("hash 对但解压后 JSON 非法 → 数据解析失败", async () => {
    // 构造一个 deflate-raw 压缩的非 JSON 字符串
    const bytes = new TextEncoder().encode("not a json {{{");
    const cs = new CompressionStream("deflate-raw");
    const w = cs.writable.getWriter();
    w.write(bytes);
    w.close();
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
    await expect(importProgress(`${HASH}.${b64url}`, HASH)).rejects.toThrow(
      /数据解析失败/,
    );
  });

  it("compact 不是数组 → 结构不符合预期", async () => {
    const encoded = await encodeCompact({ not: "an array" }, HASH);
    await expect(importProgress(encoded, HASH)).rejects.toThrow(/结构不符合预期/);
  });

  it("compact 长度 < 5 → 结构不符合预期", async () => {
    const encoded = await encodeCompact([[], [], 0, 0], HASH);
    await expect(importProgress(encoded, HASH)).rejects.toThrow(/结构不符合预期/);
  });

  it("masteredRaw 不是数组 → 已掌握列表格式错误", async () => {
    const encoded = await encodeCompact(
      ["nope", [], 0, 0, [0, 10, 3, 4, "random"]],
      HASH,
    );
    await expect(importProgress(encoded, HASH)).rejects.toThrow(
      /已掌握列表格式错误/,
    );
  });

  it("activeRaw 不是数组 → 活动池格式错误", async () => {
    const encoded = await encodeCompact(
      [[], "nope", 0, 0, [0, 10, 3, 4, "random"]],
      HASH,
    );
    await expect(importProgress(encoded, HASH)).rejects.toThrow(/活动池格式错误/);
  });

  it("settings 不是数组或长度 < 4 → 设置格式错误", async () => {
    const encoded1 = await encodeCompact([[], [], 0, 0, "nope"], HASH);
    await expect(importProgress(encoded1, HASH)).rejects.toThrow(/设置格式错误/);

    const encoded2 = await encodeCompact([[], [], 0, 0, [1, 10, 3]], HASH);
    await expect(importProgress(encoded2, HASH)).rejects.toThrow(/设置格式错误/);
  });

  it("activePool 子项不是 4 元数组 → 活动池条目格式错误", async () => {
    const encoded = await encodeCompact(
      [[], [["s3", 1, 0]], 0, 0, [0, 10, 3, 4, "random"]],
      HASH,
    );
    await expect(importProgress(encoded, HASH)).rejects.toThrow(
      /活动池条目格式错误/,
    );
  });

  it("activePool 子项不是数组 → 活动池条目格式错误", async () => {
    const encoded = await encodeCompact(
      [[], [{}], 0, 0, [0, 10, 3, 4, "random"]],
      HASH,
    );
    await expect(importProgress(encoded, HASH)).rejects.toThrow(
      /活动池条目格式错误/,
    );
  });

  it("filterCode 越界 → 回退为 all", async () => {
    const encoded = await encodeCompact(
      [[], [], 0, 99, [0, 10, 3, 4, "random"]],
      HASH,
    );
    const restored = await importProgress(encoded, HASH);
    expect(restored.filterType).toBe("all");
  });

  it("settings 长度恰为 4（无 selectionMode）→ 默认 random", async () => {
    const encoded = await encodeCompact([[], [], 0, 0, [1, 10, 3, 4]], HASH);
    const restored = await importProgress(encoded, HASH);
    expect(restored.settings.selectionMode).toBe("random");
  });
});
