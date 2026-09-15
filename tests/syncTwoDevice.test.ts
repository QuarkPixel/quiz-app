/**
 * 双设备场景测试：A ↔ B 来回同步。
 *
 * 这里的每一条都对应一个真实踩过的坑：
 *   - A 导入了新题库，B 怎么都看不到（新设备的空壳 general 把云端题库列表清了）
 *   - 同步明明成功却报「上传 0 · 下载 0」
 *   - 同一片里两个题库各改各的，却被判成整片冲突
 *   - 拉取被当成「本地改动」，下一轮又和云端撞成冲突
 *
 * 约定：`h.engine(x)` 先切到 x 这台设备，再改 / 看它的 localStorage；
 * `h.on(x, fn)` 用它自己的引擎跑一次并保存。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import type { SyncEngine } from "@/features/sync/engine.svelte";
import { shardIndexOf } from "@/features/sync/types";
import { SyncHarness } from "./syncSupport";

const HASH_A = "aaaabbbbccccdddd";
const HASH_B = "eeeeffff00001111";

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

/** 找几个落在同一个分片里的 hash（用来验证「同片互不牵连」）。 */
function hashesInSameShard(count: number): string[] {
  const byShard = new Map<number, string[]>();
  for (let i = 0; i < 20000; i += 1) {
    const hash = `h${i}`.padEnd(16, "0");
    const index = shardIndexOf(hash);
    const list = byShard.get(index) ?? [];
    list.push(hash);
    byShard.set(index, list);
    if (list.length >= count) return list.slice(0, count);
  }
  throw new Error("找不到足够多落在一片里的 hash");
}

describe("双设备同步", () => {
  test("A 推送 → B 拉取 → A 再导入 → B 能看到（线上坏过的整条链路）", async () => {
    // A：导入第一份题库并同步（建云端）
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "make progress");
    const a = h.open("A");
    const first = await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;
    expect(first.pushed).toBe(1);

    // B：全新设备，从列表里选中同一条云端
    h.freshDevice("B");
    h.open("B", { gistId });
    const bFirst = await h.on("B", (engine) => engine.sync());

    expect(bFirst.pulled).toBe(1);
    expect(h.localQuestionText(HASH_A)).toContain("make progress");
    expect(h.localLibrary().map((x) => x.hash)).toContain(HASH_A);

    // 关键：云端的题库列表不能被新设备的空壳覆盖
    expect((await h.cloudGeneral(gistId))?.library.map((x) => x.hash)).toContain(
      HASH_A,
    );

    // A：关掉自动同步，导入第二份题库，手动点「立即同步」
    h.engine("A");
    h.store("A").update({ autoSync: false });
    h.seedBank(HASH_B, "题库二", "second bank");
    const aSecond = await h.on("A", (engine) => engine.sync());

    expect(aSecond.pushed, "导入了新题库就该报「新增 1」").toBe(1);
    expect(await h.cloudBanks(gistId)).toEqual(
      expect.arrayContaining([HASH_A, HASH_B]),
    );

    // B：再同步一次，题库二应该出现
    const bSecond = await h.on("B", (engine) => engine.sync());

    expect(bSecond.conflicts).toEqual([]);
    expect(h.localQuestionText(HASH_B), "B 应该拿到题库二").toContain("second bank");
    expect(h.localLibrary().map((x) => x.hash)).toEqual(
      expect.arrayContaining([HASH_A, HASH_B]),
    );
    expect(a).toBeDefined();
  });

  test("拉取不会被当成「本地改动」：连着同步两次不会平白撞出冲突", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "first");
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;

    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());

    const again = await h.on("B", (engine) => engine.sync());

    expect(again.conflicts).toEqual([]);
    expect(again.pushed).toBe(0);
    expect(again.pulled).toBe(0);
  });

  test("两边都改了同一个题库 → 冲突，裁决前谁都不动", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "first");
    const a = h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;

    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());

    // 两台设备各刷各的题
    h.engine("A");
    h.studyBank(HASH_A, 3);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    h.studyBank(HASH_A, 9);
    const conflicted = await h.on("B", (engine) => engine.sync());

    expect(conflicted.conflicts).toEqual([HASH_A]);
    expect(h.engine("B").status.phase).toBe("conflict");
    expect(h.engine("B").status.conflicts[0].name).toBe("题库一");
    // 云端还是 A 那份，本地还是 B 那份
    expect((await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.state).toMatchObject({
      currentRound: 3,
    });
    expect(h.engine("B").status.remoteBanks).toBe(1);
    expect(localStorage.getItem(`quiz_app_state_${HASH_A}`)).toContain("9");
    expect(a).toBeDefined();
  });

  test("有未裁决的冲突时：什么都不动、也不刷新页面（绝不跳过用户的选择）", async () => {
    // 线上问题：冲突那轮还会顺手把别的题库拉下来，拉完就 `location.reload()`——
    // 页面一刷新，内存里的冲突提示就没了，看起来像「没等我选就自己同步过去了」。
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "first");
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;

    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());

    // A 改了题库一（进度 3）并推上去
    h.engine("A");
    h.studyBank(HASH_A, 3);
    await h.on("A", (engine) => engine.sync());

    // B 也改了题库一（进度 9）——冲突
    h.engine("B");
    h.studyBank(HASH_A, 9);
    await h.on("B", (engine) => engine.sync());

    // A 再导入一个新题库：对 B 来说这是一次「该拉下来」的更新
    h.engine("A");
    h.seedBank(HASH_B, "题库二", "second");
    await h.on("A", (engine) => engine.sync());

    // 重置刷新计数，然后 B 再同步一次（既有冲突、又有可拉取的新题库）
    h.reloads = 0;
    const outcome = await h.on("B", (engine) => engine.sync());

    expect(outcome.conflicts, "冲突要报出来").toEqual([HASH_A]);
    expect(h.reloads, "没裁决之前绝不允许整页刷新").toBe(0);
    expect(h.engine("B").status.phase).toBe("conflict");
    expect(
      h.engine("B").status.conflicts.map((c) => c.hash),
      "冲突提示必须留在面板上等用户",
    ).toEqual([HASH_A]);
    // 这一轮什么都不该动：新题库没拉下来，冲突题库两边各自保持原样
    expect(h.localQuestionText(HASH_B), "别的题库也要等用户裁决").toBeNull();
    expect(localStorage.getItem(`quiz_app_state_${HASH_A}`)).toContain("9");
    expect((await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.state).toMatchObject({
      currentRound: 3,
    });

    // 用户选了「保留云端」之后，一切照常继续（包括把新题库拉下来）
    await h.on("B", (engine) => engine.keepRemote());
    h.engine("B");
    expect(localStorage.getItem(`quiz_app_state_${HASH_A}`)).toContain("3");
    expect(localStorage.getItem(`quiz_app_state_${HASH_A}`)).not.toContain("9");
    expect(h.localQuestionText(HASH_B), "裁决之后新题库就该拉下来").toContain("second");
  });

  test("后台正好在同步时用户点了「保留本地」，这一下也不能白点", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "first");
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;

    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());

    h.engine("A");
    h.studyBank(HASH_A, 3);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    h.studyBank(HASH_A, 9);
    await h.on("B", (engine) => engine.sync());
    expect(h.engine("B").status.conflicts).toHaveLength(1);

    // 用户点「保留本地」的同时，后台轮询正好也发起了一次同步
    const b = h.engine("B");
    const background = b.sync();
    const choice = b.keepLocal();
    const [, choiceOutcome] = await Promise.all([background, choice]);
    h.tick();
    h.save("B");

    expect(
      choiceOutcome.conflicts,
      "点了「保留本地」之后不该还剩着冲突（那说明这一下白点了）",
    ).toEqual([]);
    expect(
      (await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.state,
      "用户的选择不能因为「正好有同步在跑」而丢掉",
    ).toMatchObject({ currentRound: 9 });
  });

  test("冲突裁决：保留本地 → 云端换成 B 的；保留云端 → B 换回云端的", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "first");
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;

    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());

    h.engine("A");
    h.studyBank(HASH_A, 3);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    h.studyBank(HASH_A, 9);
    await h.on("B", (engine) => engine.sync());

    // 保留本地：B 把 9 推上去
    const keepLocal = await h.on("B", (engine) => engine.keepLocal());
    expect(keepLocal.conflicts).toEqual([]);
    expect(keepLocal.pushed).toBe(1);
    expect((await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.state).toMatchObject({
      currentRound: 9,
    });

    // A 再同步 → 拿到 B 的 9
    await h.on("A", (engine) => engine.sync());
    h.engine("A");
    expect(localStorage.getItem(`quiz_app_state_${HASH_A}`)).toContain("9");

    // 反过来：A 改成 5 推上去，B 改成 12，B 选「保留云端」→ B 换成 5
    h.studyBank(HASH_A, 5);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    h.studyBank(HASH_A, 12);
    await h.on("B", (engine) => engine.sync());
    const keepRemote = await h.on("B", (engine) => engine.keepRemote());

    expect(keepRemote.conflicts).toEqual([]);
    h.engine("B");
    expect(localStorage.getItem(`quiz_app_state_${HASH_A}`)).toContain("5");
    expect(localStorage.getItem(`quiz_app_state_${HASH_A}`)).not.toContain("12");
  });

  test("删除会双向传播：A 删题库 → 云端回收 → B 也跟着删", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "first");
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;

    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());
    expect(h.localLibrary().map((x) => x.hash)).toContain(HASH_A);

    // A 删掉它
    h.engine("A");
    h.deleteBank(HASH_A);
    await h.on("A", (engine) => engine.sync());
    expect(await h.cloudBanks(gistId)).toEqual([]);

    // B 同步 → 跟着删（连列表条目一起）
    await h.on("B", (engine) => engine.sync());
    h.engine("B");
    expect(h.localQuestionText(HASH_A)).toBeNull();
    expect(h.localLibrary().map((x) => x.hash)).toEqual([]);
  });

  test("同一片里两个题库各改各的 → 不该互相牵连成冲突", async () => {
    const [hash1, hash2] = hashesInSameShard(2);
    expect(shardIndexOf(hash1)).toBe(shardIndexOf(hash2));

    h.freshDevice("A");
    h.seedBank(hash1, "题库一", "one");
    h.seedBank(hash2, "题库二", "two");
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;
    // 两个题库确实在同一片里（否则这条测试就没意义了）
    expect(Object.keys(h.cloudFiles(gistId))).toHaveLength(2);

    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());

    // A 改题库一，B 改题库二
    h.engine("A");
    h.studyBank(hash1, 4);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    h.studyBank(hash2, 8);
    const outcome = await h.on("B", (engine) => engine.sync());

    expect(outcome.conflicts, "同片的题库不该互相牵连").toEqual([]);
    expect(outcome.pushed).toBe(1);
    expect(outcome.pulled, "题库一被 A 改过，要拉下来").toBe(1);
    h.engine("B");
    expect(localStorage.getItem(`quiz_app_state_${hash2}`)).toContain("8");
    expect(localStorage.getItem(`quiz_app_state_${hash1}`)).toContain("4");
  });

  test("题库顺序会同步：A 把题库二置顶 → B 那边也跟着变", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "one");
    h.seedBank(HASH_B, "题库二", "two");
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;

    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());
    h.engine("B");
    expect(h.localLibrary().map((x) => x.hash)).toEqual([HASH_A, HASH_B]);

    // A 上把题库二拖到最前面（只动了顺序，条目内容没变）
    h.engine("A");
    h.moveBankToTop(HASH_B);
    await h.on("A", (engine) => engine.sync());
    expect((await h.cloudGeneral(gistId))?.library.map((x) => x.hash)).toEqual([
      HASH_B,
      HASH_A,
    ]);

    // B 同步之后顺序要跟着变（以前这里永远用本地顺序，改动传不过去）
    await h.on("B", (engine) => engine.sync());
    h.engine("B");
    expect(h.localLibrary().map((x) => x.hash)).toEqual([HASH_B, HASH_A]);
  });

  test("换设备：B 上已有题库，接上 A 的云端 → 两边的题库取并集", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "from A");
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;

    // B 自己先导入了一份完全不同的题库，然后才接上云端
    h.freshDevice("B");
    h.seedBank(HASH_B, "题库二", "from B");
    h.open("B", { gistId });
    const outcome = await h.on("B", (engine) => engine.sync());

    expect(outcome.conflicts).toEqual([]);
    expect(h.localLibrary().map((x) => x.hash)).toEqual(
      expect.arrayContaining([HASH_A, HASH_B]),
    );
    expect(await h.cloudBanks(gistId)).toEqual(
      expect.arrayContaining([HASH_A, HASH_B]),
    );
    // 云端那份 general 也不能被 B 的覆盖成只剩题库二
    expect((await h.cloudGeneral(gistId))?.library.map((x) => x.hash)).toEqual(
      expect.arrayContaining([HASH_A, HASH_B]),
    );
  });

  test("打开页面就自动对账（不用手动点「立即同步」）", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "first");
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;

    // B 之前同步过一次，然后 A 又加了新题库
    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());

    h.engine("A");
    h.seedBank(HASH_B, "题库二", "added later");
    await h.on("A", (engine) => engine.sync());

    // B 重新打开应用：init() 自己会跑一次同步，不用任何人点按钮
    const b = h.engine("B");
    b.init();
    try {
      await vi.waitFor(
        () => {
          expect(h.localQuestionText(HASH_B)).toContain("added later");
        },
        { timeout: 4000 },
      );
    } finally {
      b.dispose();
    }
    h.save("B");
  });

  test("没配置时状态行是「点测试连接开始」，配好之后就不该再出现这句", async () => {
    h.freshDevice("A");
    const unconfigured = h.open("A", { token: "" });
    unconfigured.init();
    unconfigured.dispose();
    expect(unconfigured.status.message).toBe("请先测试连接");

    h.engine("A");
    h.seedBank(HASH_A, "题库一", "first");
    h.store("A").update({ token: "tok" });
    const configured = h.engine("A");
    configured.init();
    try {
      // init() 会自己跑一次同步：等它真的跑完（配好了就不该再出现「点测试连接开始」）
      await vi.waitFor(
        () => {
          expect(configured.status.phase).toBe("idle");
          expect(configured.status.message).toMatch(
            /新增|上传|下载|题库没有改动|设置已更新/,
          );
        },
        { timeout: 4000 },
      );
    } finally {
      configured.dispose();
    }
    h.save("A");
    expect(configured.status.message).not.toBe("请先测试连接");
  });
});
