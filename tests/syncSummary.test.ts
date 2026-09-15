/**
 * 「这一轮同步干了什么」这句话。
 *
 * 线上反馈：删了题库 / 导入了题库 / 只拖了一下顺序，提示都是「上传 0 · 下载 0」，
 * 看起来像什么都没同步。现在按四件事分别数，而且**只列真的发生了的**。
 */

import { describe, expect, test } from "vitest";

import { describeSyncResult, type SyncTransferSummary } from "@/features/sync/summary";

function summary(patch: Partial<SyncTransferSummary> = {}): SyncTransferSummary {
  return {
    pushed: 0,
    pulled: 0,
    newOnCloud: 0,
    newLocally: 0,
    removed: 0,
    settingsChanged: false,
    ...patch,
  };
}

describe("同步结果文案", () => {
  test("四件事都没发生 → 「题库没有改动」", () => {
    expect(describeSyncResult(summary())).toBe("题库没有改动");
  });

  test("只有设置变了 → 也要说，否则拖一下顺序看起来像没同步", () => {
    expect(describeSyncResult(summary({ settingsChanged: true }))).toBe(
      "题库没有改动 · 设置已更新",
    );
  });

  test("只列非零的那几项，且顺序固定", () => {
    expect(
      describeSyncResult(
        summary({
          pushed: 3,
          pulled: 1,
          newOnCloud: 1,
          newLocally: 1,
          removed: 2,
          settingsChanged: true,
        }),
      ),
      // 新增 2（1 推 + 1 拉）、删除 2、上传 2（3 里扣掉 1 个新增）、
      // 下载 0（1 拉的全是新增，不显示）、设置也动了
    ).toBe("新增 2 · 删除 2 · 上传 2 · 设置已更新");
  });

  test("新题库算「新增」，不会在「上传 / 下载」里再数一遍", () => {
    // 本地导入 2 个新题库推上去：pushed = 2，但两个都是新增
    expect(
      describeSyncResult(summary({ pushed: 2, newOnCloud: 2 })),
    ).toBe("新增 2");
    // 云端新出现 1 个拉下来
    expect(
      describeSyncResult(summary({ pulled: 1, newLocally: 1 })),
    ).toBe("新增 1");
    // 已有题库改了内容才是「上传 / 下载」
    expect(describeSyncResult(summary({ pushed: 1, pulled: 1 }))).toBe(
      "上传 1 · 下载 1",
    );
    // 混在一起：1 个新增 + 1 个改内容
    expect(
      describeSyncResult(summary({ pushed: 2, newOnCloud: 1, pulled: 1, newLocally: 1 })),
    ).toBe("新增 2 · 上传 1");
  });

  test("删除会互相抵消到 0 的那些项不显示", () => {
    expect(describeSyncResult(summary({ removed: 2 }))).toBe("删除 2");
    expect(
      describeSyncResult(summary({ removed: 1, settingsChanged: true })),
    ).toBe("删除 1 · 设置已更新");
  });
});
