/**
 * **`settledThisRound`：分片被冻结时不给别的题库写新基准。**
 *
 * 它的作用写在 `nextMeta` 的注释里（"绝不给出未裁决冲突的分片里别的题库写新基准线"），
 * 但审计指出它目前是**死代码**：`execute` 只在 `plan.conflicts.length === 0` 时
 * 才走到，所以它**永远返回 true**，那条规矩**没有测试覆盖**。
 *
 * 现在把它直接钉住——因为一旦允许"逐题库上传 + 逐分片冻结"，
 * 它就从死代码变成承重墙，而那时候再发现没人测过就晚了。
 */

import { describe, expect, test } from "vitest";

import { settledThisRound } from "@/features/sync/localwrite";
import { shardIndexOf, type BankAction, type SyncPlan } from "@/features/sync/types";

function plan(pushShards: number[]): SyncPlan {
  return {
    actions: [],
    general: {} as never,
    generalChangedLocal: false,
    generalPush: false,
    settingsChanged: false,
    pushShards,
    deleteRemoteFiles: [],
    conflicts: [],
    remoteShards: [],
    remoteJunkFiles: [],
  };
}

function action(hash: string, verdict: BankAction["verdict"]): BankAction {
  return { hash, name: "题库", verdict, kind: "skip", upload: false, localAt: 0 };
}

describe("settledThisRound", () => {
  test("要上传的分片**没**被冻结 → 可以写新基准", () => {
    const hash = "aaaabbbbccccdddd";
    const shard = shardIndexOf(hash);
    expect(settledThisRound(plan([shard]), action(hash, "push"))).toBe(true);
  });

  test("分片被冻结（不在 pushShards 里）→ **不许**写新基准", () => {
    const hash = "aaaabbbbccccdddd";
    const other = "eeeeffff00001111";
    // 只有另一个分片在推（那一片有未裁决的冲突被冻住）
    const pushShards = [shardIndexOf(other)].filter(
      (index) => index !== shardIndexOf(hash),
    );
    expect(settledThisRound(plan(pushShards), action(hash, "push"))).toBe(false);
    expect(settledThisRound(plan(pushShards), action(hash, "deleteRemote"))).toBe(false);
  });

  test("拉取 / 跳过与分片冻结无关 → 总是可以写新基准", () => {
    const hash = "aaaabbbbccccdddd";
    expect(settledThisRound(plan([]), action(hash, "pull"))).toBe(true);
    expect(settledThisRound(plan([]), action(hash, "skip"))).toBe(true);
  });

  test("冲突本身永远不算「这一轮结清了」", () => {
    const hash = "aaaabbbbccccdddd";
    expect(settledThisRound(plan([shardIndexOf(hash)]), action(hash, "conflict"))).toBe(
      false,
    );
  });
});
