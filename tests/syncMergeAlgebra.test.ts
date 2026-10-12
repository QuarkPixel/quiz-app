/**
 * 合并算子的**代数性质**：交换律、结合律、幂等律。
 *
 * 这一组是整个同步层的正确性地基。缺了它就会出现最阴的一类 bug：
 * **两台设备各算各的，得到不同结果**——用户看到的就是「A 上同步过，B 上一同步又变回去了」。
 * 前面连续三个线上 bug（本地复习 / 云端复习 / 答模糊 都被拽回到期）都是这一族。
 *
 * 为什么必须有性质测试（而不是只写几个例子）：例子只能覆盖想到的形状，
 * 而"结合律"这种错法要三份输入凑齐才暴露。写这个文件时就真抓到一个：
 * 起初把 `lapses` 也算进排序兜底键（⑥），于是「赢家的 lapses 不是最大」时
 * 合并结果会改掉 lapses、排序键跟着变，换个结合顺序就得到不同答案。
 */

import { describe, it, expect } from "vitest";
import { compareCards, mergeCard } from "@/features/sync/model/card";
import type { MemoryProgress } from "@/types";

/** 可复现的伪随机数（不用 Math.random：失败要能一模一样地重放）。 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const STATES = ["learning", "reviewing", "mastered"] as const;

function randomCard(random: () => number): MemoryProgress {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)] as T;
  const state = pick(STATES);
  return {
    state,
    level: state === "mastered" ? 0 : Math.floor(random() * 9),
    streak: Math.floor(random() * 4),
    nextDue: state === "reviewing" ? Math.floor(random() * 5) * 86_400_000 : 0,
    lapses: Math.floor(random() * 5),
    // 有时不给戳（老数据），有时给
    ...(random() < 0.8 ? { rev: 1_700_000_000_000 + Math.floor(random() * 5) } : {}),
  };
}

/** 只比较"该相等"的部分：`lapses` 取大是值语义的一部分，一起比。 */
function sameCard(a: MemoryProgress, b: MemoryProgress): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const random = makeRandom(20261012);
const CARDS: MemoryProgress[] = Array.from({ length: 60 }, () => randomCard(random));

describe("卡片合并：代数性质", () => {
  it("交换律：merge(a, b) === merge(b, a)", () => {
    for (const a of CARDS) {
      for (const b of CARDS) {
        expect(sameCard(mergeCard(a, b), mergeCard(b, a)), `${JSON.stringify(a)} / ${JSON.stringify(b)}`).toBe(true);
      }
    }
  });

  it("幂等律：merge(a, a) === a", () => {
    for (const a of CARDS) {
      expect(sameCard(mergeCard(a, a), a), JSON.stringify(a)).toBe(true);
    }
  });

  it("结合律：merge(merge(a, b), c) === merge(a, merge(b, c))", () => {
    // 三份输入凑齐才暴露的那类错法：全量两两组合太慢，用固定步长扫一遍
    for (let i = 0; i < CARDS.length; i += 7) {
      for (let j = 0; j < CARDS.length; j += 5) {
        for (let k = 0; k < CARDS.length; k += 3) {
          const a = CARDS[i]!;
          const b = CARDS[j]!;
          const c = CARDS[k]!;
          const left = mergeCard(mergeCard(a, b), c);
          const right = mergeCard(a, mergeCard(b, c));
          expect(
            sameCard(left, right),
            `结合律被破坏：\n a=${JSON.stringify(a)}\n b=${JSON.stringify(b)}\n c=${JSON.stringify(c)}\n 左=${JSON.stringify(left)}\n 右=${JSON.stringify(right)}`,
          ).toBe(true);
        }
      }
    }
  });

  it("顺序无关：同一个集合任意顺序折叠，结果都一样", () => {
    const shuffled = [...CARDS].reverse();
    const fold = (items: MemoryProgress[]) =>
      items.reduce((acc, item) => mergeCard(acc, item));
    expect(sameCard(fold(CARDS), fold(shuffled))).toBe(true);
  });

  it("结果一定取自某一边（不会凭空造出第三条记录）", () => {
    for (let i = 0; i < CARDS.length - 1; i += 1) {
      const a = CARDS[i]!;
      const b = CARDS[i + 1]!;
      const merged = mergeCard(a, b);
      const fromA = { ...a, lapses: Math.max(a.lapses ?? 0, b.lapses ?? 0) };
      const fromB = { ...b, lapses: Math.max(a.lapses ?? 0, b.lapses ?? 0) };
      expect(
        sameCard(merged, fromA) || sameCard(merged, fromB),
        `${JSON.stringify(merged)} 既不是 a 也不是 b`,
      ).toBe(true);
    }
  });
});

describe("卡片合并：全序本身的性质", () => {
  it("三一律：任意两张卡都能分出先后（除非完全同序）", () => {
    for (const a of CARDS) {
      for (const b of CARDS) {
        const ab = compareCards(a, b);
        const ba = compareCards(b, a);
        // 注意 `Math.sign(0)` 是 0（不是 -0），别拿 -Math.sign 直接比
        if (ab === 0) expect(ba, JSON.stringify(a)).toBe(0);
        else expect(Math.sign(ab), `${JSON.stringify(a)} / ${JSON.stringify(b)}`).toBe(-Math.sign(ba));
      }
    }
  });

  it("传递性：a ≤ b 且 b ≤ c ⇒ a ≤ c", () => {
    for (let i = 0; i < CARDS.length; i += 6) {
      for (let j = 0; j < CARDS.length; j += 4) {
        for (let k = 0; k < CARDS.length; k += 3) {
          const a = CARDS[i]!;
          const b = CARDS[j]!;
          const c = CARDS[k]!;
          if (compareCards(a, b) <= 0 && compareCards(b, c) <= 0) {
            expect(compareCards(a, c), `传递性被破坏：${JSON.stringify([a, b, c])}`).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });
});

/**
 * **状态级**合并的代数性质。
 *
 * 原来这一组只覆盖了单张卡（`mergeCard`），而"整段状态"的合并是另外一堆算子
 * （集合 / 计数 / 按天 / 单值）。这层漏过一次真事：集合与 record 的输出顺序
 * 随**参数顺序**变，于是两台设备算出**不同的哈希** → 互相认为对方"改过" →
 * 来回推。顺序不是语义，但对哈希是——所以下面连"输出逐字节相同"一起钉。
 */

import { mergeBankState } from "@/features/sync/model/merge";

function randomState(rnd: () => number): Record<string, unknown> {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!;
  const day = 100 + Math.floor(rnd() * 2);
  const state: Record<string, unknown> = {
    masteredIds: ["q1", "q2", "q3"].filter(() => rnd() < 0.5),
    masteredMistakes: Object.fromEntries(
      ["q1", "q2"].filter(() => rnd() < 0.6).map((id) => [id, Math.floor(rnd() * 4)]),
    ),
    currentRound: Math.floor(rnd() * 10),
    settings: { correctStreakToMaster: 1 + Math.floor(rnd() * 4) },
  };
  if (rnd() < 0.8) {
    state.memory = {
      progress: {
        ...(rnd() < 0.7 ? { q1: randomCard(random) } : {}),
        ...(rnd() < 0.7 ? { q2: randomCard(random) } : {}),
      },
      settings: { graduateLevel: 5 + Math.floor(rnd() * 4) },
    };
  }
  if (rnd() < 0.6) {
    state.memory = {
      ...(state.memory as object),
      retry: { day, targets: { q1: Math.floor(rnd() * 3), q2: Math.floor(rnd() * 3) } },
      review: { day, reviewedIds: pick([[], ["q1"], ["q1", "q2"]]), total: 1 + Math.floor(rnd() * 5) },
    };
  }
  return state;
}

const STATE_CORPUS = Array.from({ length: 40 }, () => randomState(random));

describe("状态级合并：代数性质", () => {
  it("交换律（逐字节，不只是 toEqual——顺序不同会让哈希不同）", () => {
    for (const a of STATE_CORPUS) {
      for (const b of STATE_CORPUS) {
        const ab = JSON.stringify(mergeBankState({ local: a, remote: b, mode: "memory" }));
        const ba = JSON.stringify(mergeBankState({ local: b, remote: a, mode: "memory" }));
        expect(ab, `顺序变了就得到不同结果：\n a=${JSON.stringify(a)}\n b=${JSON.stringify(b)}`).toBe(ba);
      }
    }
  });

  it("幂等：merge(a, a) 与 a 的**可同步部分**一致", () => {
    for (const a of STATE_CORPUS) {
      const once = mergeBankState({ local: a, remote: a, mode: "memory" });
      const twice = mergeBankState({ local: once, remote: once, mode: "memory" });
      expect(JSON.stringify(twice), JSON.stringify(a)).toBe(JSON.stringify(once));
    }
  });

  it("带基准时也不依赖参数顺序", () => {
    for (let i = 0; i < STATE_CORPUS.length - 1; i += 3) {
      const base = STATE_CORPUS[i]!;
      const a = STATE_CORPUS[i + 1]!;
      const b = STATE_CORPUS[(i + 7) % STATE_CORPUS.length]!;
      const ab = JSON.stringify(mergeBankState({ base, local: a, remote: b, mode: "memory" }));
      const ba = JSON.stringify(mergeBankState({ base, local: b, remote: a, mode: "memory" }));
      expect(ab).toBe(ba);
    }
  });
});

/**
 * **同序但不同 JSON 的两张卡不能各挑一边。**
 *
 * `canonicalJson` 把 `undefined` / `null` / `NaN` / `±Infinity` 一视同仁写成 `null`，
 * 所以 `{level: null}` 与「没有 `level` 这个键」在排序里**同序**（`compareCards` 返回 0）。
 * 但它们的 JSON 不一样 ⇒ `stableHash` 不一样 ⇒ 两台设备各挑一边就**永远不会收敛**。
 *
 * 应用自己写的卡经过 `normalizeMemoryProgress` 永远是数字，所以这条只对手改 /
 * 外来的 JSON 可达——但那时它就是个安静的持续分歧。审计把这一族穷举出来了
 * （7 个字段 × 20 种取值，48 组，全部是 `undefined` vs `null|NaN|±Infinity`）。
 */
describe("同序卡片的输出必须一致", () => {
  const messy: Array<[string, MemoryProgress, MemoryProgress]> = [
    ["缺 level vs level:null", { state: "reviewing", rev: 5 } as MemoryProgress, { state: "reviewing", level: null, rev: 5 } as unknown as MemoryProgress],
    ["缺 nextDue vs nextDue:null", { state: "reviewing", rev: 5 } as MemoryProgress, { state: "reviewing", nextDue: null, rev: 5 } as unknown as MemoryProgress],
    ["NaN vs 缺", { state: "reviewing", level: Number.NaN, rev: 5 } as unknown as MemoryProgress, { state: "reviewing", rev: 5 } as MemoryProgress],
    ["Infinity vs 缺", { state: "reviewing", streak: Number.POSITIVE_INFINITY, rev: 5 } as unknown as MemoryProgress, { state: "reviewing", rev: 5 } as MemoryProgress],
  ];

  it.each(messy)("%s：两个方向落盘的 JSON 逐字节相同", (_name, a, b) => {
    const ab = JSON.stringify(mergeCard(a, b));
    const ba = JSON.stringify(mergeCard(b, a));
    expect(ab, "两台设备挑出不同的东西，永远不会收敛").toBe(ba);
  });
});
