/**
 * 「两台设备都做过同一份题库」不再报冲突，进度按卡合并。
 *
 * 线上反馈：同一个题库在手机和电脑上都做过，同步时反复弹「同步冲突」，
 * 而面板上两个时间只差一分钟（用户怀疑是时钟偏差）。其实时钟不参与判定
 * （本地比的是本机 mtime 与基准，云端比的是内容哈希）——真正的原因是判据把
 * **进度**和**内容**混在一个哈希里：两边都答过题，在判定里和「两边把题目改得
 * 不一样了」长得一模一样。而裁决是整库二选一，怎么选都要丢掉一边的进度。
 *
 * 现在：题目一样 → 按卡合并（各取更靠前的那一份）；题目真的分叉了才问用户。
 * 这个文件就是这两条规矩的护栏。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { SyncHarness } from "./syncSupport";
import { loadSyncMeta } from "@/features/sync/storage";
import { bankRowKey } from "@/features/sync/types";
import { mergeProgressMap, planProgressMerge } from "@/features/sync/progressMerge";

const HASH_A = "aaaabbbbccccdddd";

let h: SyncHarness;

beforeAll(async () => {
  h = new SyncHarness();
  await h.start();
});

afterAll(async () => {
  await h.stop();
});

beforeEach(() => {
  h.reset();
});

/** A、B 两台设备，同一串令牌、同一条 Gist，都已经拉过题库一。 */
async function twoDevices(): Promise<{ gistId: string }> {
  h.freshDevice("A");
  const a = h.open("A");
  h.seedBank(HASH_A, "题库一", "第一版");
  h.setActive(HASH_A);
  await a.sync();
  const gistId = h.store("A").value.gistId;
  h.save("A");

  h.freshDevice("B");
  const b = h.open("B", { gistId });
  await b.sync();
  h.save("B");
  return { gistId };
}

/** 直接改某台设备的进度文件（模拟答题落盘）。只覆盖点名的字段。 */
function study(
  hash: string,
  patch: { currentRound?: number; progress?: Record<string, unknown> },
): void {
  const raw = JSON.parse(localStorage.getItem(`quiz_app_state_${hash}`) ?? "{}");
  const memory = raw.memory ?? { progress: {}, settings: {} };
  localStorage.setItem(
    `quiz_app_state_${hash}`,
    JSON.stringify({
      ...raw,
      ...(patch.currentRound === undefined ? {} : { currentRound: patch.currentRound }),
      memory: {
        ...memory,
        ...(patch.progress === undefined
          ? {}
          : { progress: { ...(memory.progress ?? {}), ...patch.progress } }),
      },
    }),
  );
  h.tick();
}

describe("两台设备都做过同一份题库", () => {
  test("各答各的题 → 不冲突，两边进度都在（云端拿到合并后的结果）", async () => {
    const { gistId } = await twoDevices();

    // A：做了 q1，答错一次
    h.engine("A");
    study(HASH_A, {
      currentRound: 5,
      progress: {
        q1: { state: "reviewing", level: 2, streak: 0, nextDue: 0, lapses: 1 },
      },
    });
    await h.on("A", (engine) => engine.sync());

    // B：做了 q2，还在学习
    h.engine("B");
    study(HASH_A, {
      currentRound: 9,
      progress: {
        q2: { state: "learning", level: 0, streak: 1, nextDue: 0, lapses: 0 },
      },
    });
    const outcome = await h.on("B", (engine) => engine.sync());

    expect(outcome.conflicts, "都做过同一份题库不该报冲突").toEqual([]);
    expect(outcome.progressMerged, "报一句「合并进度」").toBe(1);

    // 云端 = 两边进度的并集
    const cloud = (await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.state as {
      currentRound: number;
      memory: { progress: Record<string, unknown> };
    };
    expect(Object.keys(cloud.memory.progress).sort()).toEqual(["q1", "q2"]);
    expect(cloud.currentRound, "轮次取更大的那个").toBe(9);

    // A 再同步一次：拿到合并后的结果，既不冲突也不丢自己的进度
    h.engine("A");
    const aAgain = await h.on("A", (engine) => engine.sync());
    expect(aAgain.conflicts).toEqual([]);
    const localA = JSON.parse(
      localStorage.getItem(`quiz_app_state_${HASH_A}`) ?? "{}",
    ) as { memory: { progress: Record<string, unknown> } };
    expect(Object.keys(localA.memory.progress).sort()).toEqual(["q1", "q2"]);
  });

  test("同一张卡两边都答过 → 取更靠前的那一档", async () => {
    await twoDevices();

    // A 把 q1 推到「复习中第 3 级」
    h.engine("A");
    study(HASH_A, {
      currentRound: 3,
      progress: {
        q1: { state: "reviewing", level: 3, streak: 0, nextDue: 111, lapses: 0 },
      },
    });
    await h.on("A", (engine) => engine.sync());

    // B 把 q1 答「忘记」了（归零到第 1 级、lapses 涨到 2）
    h.engine("B");
    study(HASH_A, {
      currentRound: 7,
      progress: {
        q1: { state: "reviewing", level: 1, streak: 0, nextDue: 222, lapses: 2 },
      },
    });
    const outcome = await h.on("B", (engine) => engine.sync());

    expect(outcome.conflicts).toEqual([]);
    h.engine("B");
    const merged = JSON.parse(
      localStorage.getItem(`quiz_app_state_${HASH_A}`) ?? "{}",
    ) as { memory: { progress: Record<string, { level: number; lapses: number }> } };
    expect(merged.memory.progress.q1.level, "取更靠前的那一档").toBe(3);
    expect(Object.keys(merged.memory.progress), "同一张卡不会变成两条").toEqual(["q1"]);
    expect(merged.memory.progress.q1.lapses, "累计答错次数取大，不丢").toBe(2);
  });

  test("题目真的分叉了 → 照样报冲突，等用户裁决", async () => {
    const { gistId } = await twoDevices();

    h.engine("A");
    h.editBank(HASH_A, "题库一", "A 改过的题干");
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    h.editBank(HASH_A, "题库一", "B 改过的题干");
    const outcome = await h.on("B", (engine) => engine.sync());

    expect(outcome.conflicts, "题目不同没法自动合，必须让用户选").toEqual([HASH_A]);
    // 谁都没被动过
    expect(
      JSON.stringify((await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.questions),
    ).toContain("A 改过的题干");
    expect(localStorage.getItem(`quiz_app_questions_${HASH_A}`)).toContain(
      "B 改过的题干",
    );
  });

  test("只有一边动过进度 → 照常走「上传 / 下载」，不算合并", async () => {
    await twoDevices();

    h.engine("A");
    study(HASH_A, { currentRound: 4 });
    const pushed = await h.on("A", (engine) => engine.sync());
    expect(pushed.progressMerged).toBe(0);
    expect(pushed.conflicts).toEqual([]);

    h.engine("B");
    const pulled = await h.on("B", (engine) => engine.sync());
    expect(pulled.progressMerged).toBe(0);
    expect(
      JSON.parse(localStorage.getItem(`quiz_app_state_${HASH_A}`) ?? "{}")
        .currentRound,
    ).toBe(4);
  });

  test("合并之后基准线跟着更新：下一轮不会又合一次", async () => {
    await twoDevices();

    h.engine("A");
    study(HASH_A, { currentRound: 5 });
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    study(HASH_A, { currentRound: 9 });
    const outB = await h.on("B", (engine) => engine.sync());
    const row = loadSyncMeta().rows[bankRowKey(HASH_A)];
    expect(row?.snapshot, "基准里带上这一份快照，下一轮才有三方参照").toBeDefined();

    // 再对一次账：两边都动过了、但已经一致 → 什么都不用做
    h.engine("B");
    const again = await h.on("B", (engine) => engine.sync());
    expect(again.progressMerged).toBe(0);
    expect(again.conflicts).toEqual([]);
  });
});

describe("按卡合并的规矩（纯函数）", () => {
  const entry = (patch: Record<string, unknown>) => ({
    state: "learning",
    level: 0,
    streak: 0,
    nextDue: 0,
    lapses: 0,
    ...patch,
  });

  test("只有一边改了 → 听改了的那边（三方比较）", () => {
    const base = { q1: entry({ level: 1 }) };
    const local = { q1: entry({ level: 5 }) };
    const remote = { q1: entry({ level: 1 }) };
    expect(mergeProgressMap(base, local, remote).q1.level).toBe(5);
    expect(mergeProgressMap(base, remote, local).q1.level).toBe(5);
  });

  test("两边都改了 → 取更靠前的档位（mastered > reviewing > learning）", () => {
    const merged = mergeProgressMap(undefined, undefined, undefined);
    expect(merged).toEqual({});

    const both = mergeProgressMap(
      undefined,
      { q1: entry({ state: "learning", level: 9 }) },
      { q1: entry({ state: "mastered", level: 0 }) },
    );
    expect(both.q1.state, "已经掌握的那张不会被「学习中」覆盖回去").toBe("mastered");
  });

  /**
   * 「已掌握是终态」必须压过「谁改了听谁」。
   *
   * 踩过：`rank()` 里给 mastered 的 MAX_SAFE_INTEGER 只在「两边都改」那条
   * `else` 分支生效；「本地没动、云端动了」会直接取云端那一份，于是
   * 「A 上已掌握、B 上重新学」同步回来会把 A 的掌握状态拖回学习中。
   */
  test("本地已掌握且未改动、云端把它重置了 → 掌握状态不许被拖回去", () => {
    const mastered = entry({ state: "mastered", level: 0 });
    const reset = entry({ state: "learning", level: 0, lapses: 1 });

    const merged = mergeProgressMap({ q1: mastered }, { q1: mastered }, { q1: reset });
    expect(merged.q1.state, "mastered 是终态，不该被云端的 learning 覆盖").toBe(
      "mastered",
    );

    // 镜像：本地动了、云端是 mastered → 也听 mastered
    const mirror = mergeProgressMap(
      { q1: entry({ state: "reviewing", level: 3 }) },
      { q1: entry({ state: "learning", level: 0 }) },
      { q1: mastered },
    );
    expect(mirror.q1.state).toBe("mastered");

    // 两边都已掌握 → 走 rank，仍然是 mastered
    const both = mergeProgressMap({ q1: mastered }, { q1: mastered }, { q1: mastered });
    expect(both.q1.state).toBe("mastered");
    // lapses 仍然取两边最大值（累计答错只涨不落）
    expect(merged.q1.lapses).toBe(1);
  });

  test("两边都不是 mastered → 仍然按「谁改了听谁」走，不会被终态护栏影响", () => {
    const base = { q1: entry({ state: "reviewing", level: 2 }) };
    const local = { q1: entry({ state: "reviewing", level: 6 }) };
    const remote = { q1: entry({ state: "reviewing", level: 2 }) };
    expect(mergeProgressMap(base, local, remote).q1.level).toBe(6);
    expect(mergeProgressMap(base, remote, local).q1.level).toBe(6);
  });

  test("一边删过这张卡 → 留着还在的那份，进度不会凭空消失", () => {
    const merged = mergeProgressMap(
      { q1: entry({ level: 3 }) },
      {},
      { q1: entry({ level: 3 }) },
    );
    expect(merged.q1.level).toBe(3);
  });

  test("没有基准时：各取更靠前的，不猜时间", () => {
    const merged = mergeProgressMap(
      undefined,
      { q1: entry({ level: 2 }), q2: entry({ level: 7 }) },
      { q1: entry({ level: 6 }), q3: entry({ level: 1 }) },
    );
    expect(Object.keys(merged).sort()).toEqual(["q1", "q2", "q3"]);
    expect(merged.q1.level).toBe(6);
    expect(merged.q2.level).toBe(7);
  });
});

describe("这一轮到底要做什么（planProgressMerge）", () => {
  const snap = (state?: unknown) => ({
    mode: "memory",
    name: "题库一",
    questions: [{ id: "q1", type: "memory", question: "题干", answer: "答案" }],
    ...(state === undefined ? {} : { state }),
  });
  const local = snap({
    currentRound: 4,
    memory: {
      progress: { q1: { state: "reviewing", level: 3, streak: 0, nextDue: 0, lapses: 0 } },
    },
  });
  const remote = snap({
    currentRound: 1,
    memory: {
      progress: { q2: { state: "learning", level: 0, streak: 1, nextDue: 0, lapses: 0 } },
    },
  });

  test("云端干脆没有进度 → 直接推本地那份（不算合并）", () => {
    const plan = planProgressMerge({ local, remote: snap() });
    expect(plan.kind).toBe("push");
  });

  test("两边各答过一些卡 → 合并，两边都不丢", () => {
    const plan = planProgressMerge({ local, remote });
    expect(plan.kind).toBe("merge");
    const progress = (
      plan as { snapshot: { state: { memory: { progress: Record<string, unknown> } } } }
    ).snapshot.state.memory.progress;
    expect(Object.keys(progress).sort()).toEqual(["q1", "q2"]);
  });

  test("云端那份被本地完全包含（本地更靠前）→ 跳过，不白写一次盘", () => {
    // 同一张卡，本地那份更靠前；云端那份给不出任何新东西
    const newer = snap({
      currentRound: 9,
      memory: {
        progress: {
          q2: { state: "reviewing", level: 4, streak: 0, nextDue: 0, lapses: 5 },
        },
      },
    });
    const older = snap({
      currentRound: 1,
      memory: {
        progress: {
          q2: { state: "reviewing", level: 2, streak: 0, nextDue: 0, lapses: 5 },
        },
      },
    });
    expect(planProgressMerge({ local: newer, remote: older }).kind).toBe("skip");
  });

  test("云端有一张卡本地没有 → 要合并（把云端那张捞进来）", () => {
    const plan = planProgressMerge({ local, remote });
    const progress = (
      plan as { snapshot: { state: { memory: { progress: Record<string, unknown> } } } }
    ).snapshot.state.memory.progress;
    expect(plan.kind).toBe("merge");
    expect(progress.q2, "云端那张不能被落下").toBeDefined();
  });
});
