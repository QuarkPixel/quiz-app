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
