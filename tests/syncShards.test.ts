/**
 * 分片收集的测试：把真实形状的 localStorage 数据喂给 `collectLocalFiles`，
 * 验证「文件数永不超 10」这条硬约束，以及每个题库都落在它该在的片里。
 *
 * 这一层之所以要单独测：撞 Gitee「文件不能超过 10 个」是线上才会暴露的错，
 * 而它取决于题库数量——单测里造 20 个题库比手点 20 次快得多。
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { collectLocalFiles } from "@/features/sync/collect";
import { installStorageHook, mtimeOf } from "@/features/sync/storage";
import {
  GIST_GENERAL_FILE,
  SHARD_COUNT,
  shardFileName,
  shardIndexFromFileName,
  shardIndexOf,
  type ShardSnapshot,
} from "@/features/sync/types";

/** 造一个题库（题目 + 进度 + 题库列表里的条目）。 */
function seedBank(hash: string, name: string, cards: number): void {
  const questions = Array.from({ length: cards }, (_, i) => ({
    id: `m${i}`,
    type: "memory",
    question: `${name} 第 ${i} 条`,
    answer: `answer ${i}`,
  }));
  localStorage.setItem(`quiz_app_questions_${hash}`, JSON.stringify(questions));
  localStorage.setItem(
    `quiz_app_state_${hash}`,
    JSON.stringify({
      masteredIds: [],
      masteredMistakes: {},
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: {},
      ui: {},
      memory: { progress: {}, settings: { graduateLevel: 7, roundTarget: 5 } },
    }),
  );

  const general = JSON.parse(
    localStorage.getItem("quiz_app_general") ?? "{}",
  ) as { library?: unknown[] };
  general.library = [
    ...(general.library ?? []),
    { hash, name, mode: "memory", count: cards, addedAt: Date.now() },
  ];
  localStorage.setItem("quiz_app_general", JSON.stringify(general));
}

beforeEach(() => {
  installStorageHook();
  localStorage.clear();
  localStorage.setItem(
    "quiz_app_general",
    JSON.stringify({
      activeBank: null,
      defaultSettings: {},
      library: [],
      globalSettings: {},
    }),
  );
});

afterEach(() => {
  localStorage.clear();
});

describe("分片收集", () => {
  test("没有题库时只有 _general.json（不凭空造空分片）", () => {
    const files = collectLocalFiles(mtimeOf);
    expect(files.map((f) => f.name)).toEqual([GIST_GENERAL_FILE]);
  });

  test("20 个题库时文件总数仍然不超过 10（Gitee 的硬限制）", () => {
    for (let i = 0; i < 20; i += 1) {
      seedBank(`hash${i}`.padEnd(16, "0"), `题库${i}`, 5);
    }
    const files = collectLocalFiles(mtimeOf);
    expect(files.length).toBeLessThanOrEqual(10);
    expect(files[0].name).toBe(GIST_GENERAL_FILE);
  });

  test("100 个题库也不会超（分片数固定）", () => {
    for (let i = 0; i < 100; i += 1) {
      seedBank(`h${i}`.padEnd(16, "x"), `题库${i}`, 3);
    }
    const files = collectLocalFiles(mtimeOf);
    expect(files.length).toBeLessThanOrEqual(1 + SHARD_COUNT);
  });

  test("每个题库都落在 shardIndexOf(hash) 指的那一片里", () => {
    const hashes = Array.from({ length: 30 }, (_, i) => `bank${i}`.padEnd(16, "a"));
    for (const [i, hash] of hashes.entries()) {
      seedBank(hash, `题库${i}`, 2);
    }

    const files = collectLocalFiles(mtimeOf);
    for (const file of files) {
      if (file.name === GIST_GENERAL_FILE) continue;
      const index = shardIndexFromFileName(file.name);
      expect(index).not.toBeNull();
      const banks = (file.snapshot as ShardSnapshot).banks;
      for (const hash of Object.keys(banks)) {
        expect(shardIndexOf(hash)).toBe(index);
      }
    }
  });

  test("所有题库都被收进去了，一个不漏", () => {
    const hashes = Array.from({ length: 30 }, (_, i) => `x${i}`.padEnd(16, "b"));
    for (const [i, hash] of hashes.entries()) {
      seedBank(hash, `题库${i}`, 2);
    }

    const collected = new Set<string>();
    for (const file of collectLocalFiles(mtimeOf)) {
      if (file.name === GIST_GENERAL_FILE) continue;
      for (const hash of Object.keys((file.snapshot as ShardSnapshot).banks)) {
        collected.add(hash);
      }
    }
    expect(collected.size).toBe(hashes.length);
    for (const hash of hashes) expect(collected.has(hash)).toBe(true);
  });

  test("分片里保留了题库名与模式（拉取时要靠它补进题库列表）", () => {
    const hash = "namedbank0000000";
    seedBank(hash, "英语短语", 3);

    const file = collectLocalFiles(mtimeOf).find(
      (f) => f.name === shardFileName(shardIndexOf(hash)),
    );
    expect(file).toBeDefined();
    const bank = (file?.snapshot as ShardSnapshot).banks[hash];
    expect(bank.name).toBe("英语短语");
    expect(bank.mode).toBe("memory");
    expect(bank.questions).toHaveLength(3);
    expect(bank.state).toBeDefined();
  });

  test("分片的本地改动时间取片内最晚的那个（整片一起传，得认最晚）", () => {
    const hash = "timebank00000000";
    seedBank(hash, "计时题库", 2);

    // 先把所有 mtime 清成 0，再只动 progress 那个键
    const before = collectLocalFiles(mtimeOf);
    const shard = before.find((f) => f.name === shardFileName(shardIndexOf(hash)));
    const general = before.find((f) => f.name === GIST_GENERAL_FILE);
    expect(shard?.localAt ?? 0).toBeGreaterThan(0);
    // _general.json 也被动过（seedBank 往 library 里加了条目），所以它也该有 mtime
    expect(general?.localAt ?? 0).toBeGreaterThan(0);
  });

  test("只有进度没有题目的残留不会被当成题库（避免造出空片）", () => {
    localStorage.setItem("quiz_app_state_orphan000000", JSON.stringify({}));
    const files = collectLocalFiles(mtimeOf);
    expect(files.map((f) => f.name)).toEqual([GIST_GENERAL_FILE]);
  });
});
