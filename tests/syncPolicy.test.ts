/**
 * 字段归属的**覆盖性护栏**。
 *
 * `policy.ts` 是"哪些字段参与同步、每个用什么算子"的唯一真相。这个文件保证
 * **它不会悄悄过时**：
 *
 * 1. **编译期穷尽**（下面那两个 `_Covered` 常量）：给 `StoredState` /
 *    `MemoryStoredState` 加字段却忘了在 `policy.ts` 里登记，**类型检查直接不过**。
 *    这比运行时断言强——不依赖测试跑没跑到。
 * 2. 运行期行为：`stripDeviceLocal` 只剥设备本地字段、其余原样保留；
 *    `attachDeviceLocal` 写回时把本机那份贴回去（漏了会清空用户的 UI 状态和会话池子）。
 */

import { describe, it, expect, test } from "vitest";
import {
  DEVICE_LOCAL_BANK_FIELDS,
  DEVICE_LOCAL_GENERAL_FIELDS,
  SYNCED_BANK_FIELDS,
  SYNCED_GENERAL_FIELDS,
  attachDeviceLocal,
  stripDeviceLocal,
} from "@/features/sync/model/policy";
import type { GeneralSnapshot } from "@/features/sync/types";
import type { StoredState } from "@/types";

// ── 1. 编译期穷尽（护栏本体在 src 里，见下） ───────────────────────────────
//
// **注意**：类型层面的穷尽检查**不能写在测试文件里**——`pnpm check` 用的是
// `tsconfig.json`，它的 `include` 只有 `src/**`，`tests/` 根本不参与类型检查，
// 写在测试里等于没有护栏（这个坑真踩过：加了个假字段，检查依然是 0 错）。
//
// 所以护栏搬到了 `model/policy.ts` 末尾（`POLICY_COVERAGE`），由 `pnpm check` 兜住。
// 这里只做两件事：确认那几项都是 `true`、以及做运行期行为检查。

import { POLICY_COVERAGE } from "@/features/sync/model/policy";

describe("字段归属：登记表与状态类型一致", () => {
  it("四项穷尽检查都通过（漏登记会在 pnpm check 时编译不过）", () => {
    expect(POLICY_COVERAGE).toEqual({
      card: true,
      topLevel: true,
      memory: true,
      general: true,
    });
  });

  it("同一个字段不会既登记成同步、又登记成设备本地", () => {
    const synced = new Set<string>(SYNCED_BANK_FIELDS);
    for (const field of DEVICE_LOCAL_BANK_FIELDS) {
      expect(synced.has(field), `${field} 两边都登记了`).toBe(false);
    }
  });
});

// ── 2. 运行期行为 ───────────────────────────────────────────────────────────

const FULL_STATE = {
  masteredIds: ["q1"],
  masteredMistakes: { q1: 2 },
  activePool: [{ id: "q1", consecutiveCorrect: 1 }],
  currentRound: 7,
  filterType: "single",
  settings: { selectionMode: "random" },
  ui: { progressFocused: true, showPool: true },
  round: { goal: 5, cardIds: ["q1", "q2", "q3"], masteredIds: ["q1"] },
  memory: {
    progress: { q1: { state: "reviewing", level: 2, streak: 0, nextDue: 123, lapses: 0, rev: 9 } },
    settings: { graduateLevel: 7, roundTarget: 5, lockRoundTarget: false },
    retry: { day: 1, targets: { q1: 2 } },
    review: { day: 1, reviewedIds: ["q1"], total: 1 },
    learnedDay: 1,
  },
} as unknown as StoredState;

describe("剥掉设备本地字段", () => {
  it("设备本地字段一个都不剩，同步字段一个都不少", () => {
    const stripped = stripDeviceLocal(FULL_STATE as unknown as Record<string, unknown>)!;
    for (const field of DEVICE_LOCAL_BANK_FIELDS) {
      expect(field in stripped, `${field} 不该被同步出去`).toBe(false);
    }
    for (const path of SYNCED_BANK_FIELDS) {
      if (path.startsWith("memory.")) continue;
      expect(path in stripped, `${path} 应该被同步`).toBe(true);
    }
    const memory = stripped.memory as Record<string, unknown>;
    for (const path of SYNCED_BANK_FIELDS) {
      if (!path.startsWith("memory.")) continue;
      const key = path.slice("memory.".length);
      expect(key in memory, `${path} 应该被同步`).toBe(true);
    }
  });

  it("修订戳要跟着卡片一起同步（丢了就没法判断谁更晚）", () => {
    const stripped = stripDeviceLocal(FULL_STATE as unknown as Record<string, unknown>)!;
    const progress = (stripped.memory as Record<string, Record<string, { rev?: number }>>).progress;
    expect(progress.q1?.rev).toBe(9);
  });
});

describe("写回本地时贴回本机的设备本地字段", () => {
  it("拉取 / 合并的结果里没有 UI 状态与会话池子 → 必须保留本机那份", () => {
    const syncable = stripDeviceLocal(FULL_STATE as unknown as Record<string, unknown>);
    const merged = attachDeviceLocal(syncable, FULL_STATE)!;
    // 本机的这些字段原样还在（否则一次同步就把用户的界面状态清空了）
    expect(merged.ui).toEqual(FULL_STATE.ui);
    expect(merged.filterType).toBe(FULL_STATE.filterType);
    expect(merged.activePool).toEqual(FULL_STATE.activePool);
    expect(merged.round).toEqual(FULL_STATE.round);
  });

  it("同步字段用云端/合并后的那份，不被本机覆盖", () => {
    const remoteSyncable = {
      currentRound: 99,
      masteredIds: ["q9"],
      memory: { progress: { q9: { state: "mastered", level: 0, streak: 0, nextDue: 0, lapses: 0, rev: 5 } } },
    };
    const merged = attachDeviceLocal(remoteSyncable, FULL_STATE)!;
    expect(merged.currentRound).toBe(99);
    expect(merged.masteredIds).toEqual(["q9"]);
    expect(merged.ui, "设备本地字段仍然来自本机").toEqual(FULL_STATE.ui);
  });

  it("本机没有那些字段时不会凭空空造", () => {
    const merged = attachDeviceLocal({ currentRound: 1 }, { currentRound: 0 })!;
    expect("ui" in merged).toBe(false);
    expect("activePool" in merged).toBe(false);
  });
});

/**
 * 落盘那一侧的护栏（`store.ts` 的 `persistedState`）也要跟着钉住：
 * 它是**第二个白名单**，与 `SYNCED_BANK_FIELDS` 是两回事——登记成"可同步"却
 * 忘了进 `persistedState`，就是"登记了却永远存不进 localStorage"。
 */
describe("落盘白名单的编译期护栏", () => {
  test("STORED_STATE_COVERAGE 成立（拿真值断言，被删要红）", async () => {
    const { STORED_STATE_COVERAGE } = await import("@/store");
    expect(STORED_STATE_COVERAGE).toBe(true);
  });
});
