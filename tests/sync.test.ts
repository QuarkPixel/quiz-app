/**
 * 云同步（Gitee Gist）的核心逻辑测试 —— 纯函数那一层。
 *
 * 重点覆盖「会不会静默覆盖用户数据」这一类问题：
 *   - 令牌 / Gist ID 的净化与掩码（令牌绝不能进云端）
 *   - 压缩往返（压缩写错 = 云端数据读不回来）
 *   - 逐**题库**三方合并的判定（含删除、无基准、老格式兜底）
 *   - general 的逐字段 / 逐条目合并（新设备的空壳绝不能覆盖云端题库列表）
 *   - 冲突裁决后的计划重算
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { sanitizeSyncConfig } from "@/features/sync/config.svelte";
import { giteeApiBase, maskToken, resolveSyncTarget } from "@/features/sync/target";
import { decodePayload, encodePayload } from "@/features/sync/payload";
import {
  bankContentHash,
  collectLocalState,
  stableHash,
  type BankRecord,
  type CollectedState,
} from "@/features/sync/collect";
import {
  applyResolution,
  buildRemoteState,
  buildSyncPlan,
  forcePullPlan,
  forcePushPlan,
  judgeBank,
  mergeGeneral,
  planIsEmpty,
  type RemoteBank,
  type RemoteState,
} from "@/features/sync/merge";
import {
  applyRemoteValue,
  clearSyncMeta,
  installStorageHook,
  isSyncableKey,
  loadSyncMeta,
  mtimeOf,
  saveSyncMeta,
} from "@/features/sync/storage";
import {
  EMPTY_SYNC_CONFIG,
  GIST_DESCRIPTION,
  GIST_GENERAL_FILE,
  GITEE_API_BASE,
  SHARD_COUNT,
  STORAGE_KEY_SYNC_CONFIG,
  STORAGE_KEY_SYNC_META,
  SYNC_PAYLOAD_VERSION,
  bankRowKey,
  emptySyncMeta,
  looksLikeSyncGist,
  normalizeGeneralSnapshot,
  shardFileName,
  shardIndexFromFileName,
  shardIndexOf,
  type BankSnapshot,
  type GeneralSnapshot,
  type RemoteFile,
  type SyncMeta,
} from "@/features/sync/types";

// ── 造数据的小工具 ──────────────────────────────────────────────────────────

function makeBankSnapshot(
  name: string,
  options: { state?: unknown; marker?: string; mode?: "quiz" | "memory" } = {},
): BankSnapshot {
  return {
    mode: options.mode ?? "memory",
    name,
    questions: [
      {
        id: "q1",
        type: "memory",
        question: options.marker ?? "题干",
        answer: "answer",
      },
    ],
    ...(options.state === undefined ? {} : { state: options.state }),
  };
}

function localBank(
  hash: string,
  name: string,
  options: { localAt?: number; state?: unknown } = {},
): BankRecord {
  const snapshot = makeBankSnapshot(name, options);
  return {
    hash,
    shard: shardIndexOf(hash),
    contentHash: bankContentHash(snapshot),
    localAt: options.localAt ?? 0,
    snapshot,
  };
}

function remoteBank(
  hash: string,
  name: string,
  options: { state?: unknown } = {},
): RemoteBank {
  const snapshot = makeBankSnapshot(name, options);
  return {
    hash,
    shard: shardIndexOf(hash),
    contentHash: bankContentHash(snapshot),
    name,
    snapshot,
  };
}

function localState(
  banks: BankRecord[],
  general: Partial<GeneralSnapshot> = {},
): CollectedState {
  const normalized = normalizeGeneralSnapshot(general);
  return {
    general: normalized,
    generalHash: stableHash(normalized),
    generalLocalAt: 0,
    generalHasEdits: normalized.library.length > 0 || normalized.activeBank !== null,
    banks: new Map(banks.map((bank) => [bank.hash, bank])),
  };
}

function remoteState(
  banks: RemoteBank[],
  general: Partial<GeneralSnapshot> | null = {},
  extraFiles: RemoteFile[] = [],
): RemoteState {
  const shardBanks = new Map<number, string[]>();
  for (const bank of banks) {
    const list = shardBanks.get(bank.shard) ?? [];
    list.push(bank.hash);
    shardBanks.set(bank.shard, list);
  }
  const files: RemoteFile[] = [...extraFiles];
  for (const [index, hashes] of shardBanks) {
    files.push({
      name: shardFileName(index),
      hash: `file-${index}`,
      json: JSON.stringify({
        banks: Object.fromEntries(
          hashes.map((hash) => [
            hash,
            banks.find((bank) => bank.hash === hash)?.snapshot,
          ]),
        ),
      }),
    });
  }
  const normalized = general === null ? null : normalizeGeneralSnapshot(general);
  // 哈希口径要和引擎一致：对**解出来的 JSON 内容**取 stableHash
  const generalHash = normalized === null ? "" : stableHash(normalized);
  if (normalized !== null) {
    files.push({
      name: GIST_GENERAL_FILE,
      hash: generalHash,
      json: JSON.stringify(normalized),
    });
  }
  return {
    general: normalized,
    generalHash,
    files,
    banks: new Map(banks.map((bank) => [bank.hash, bank])),
    shardBanks,
    unreadableShards: [],
  };
}

function metaWith(
  rows: Record<string, string>,
  generalBaseline: GeneralSnapshot | null = null,
): SyncMeta {
  const map: SyncMeta["rows"] = {};
  for (const [name, hash] of Object.entries(rows)) {
    map[name] = { remoteHash: hash, syncedAt: 500, remoteUpdatedAt: 500 };
  }
  return { lastSyncedAt: 500, bootstrapped: true, rows: map, generalBaseline };
}

const HASH_A = "aaaabbbbccccdddd";
const HASH_B = "eeeeffff00001111";

beforeEach(() => {
  installStorageHook();
  localStorage.clear();
  clearSyncMeta();
});

afterEach(() => {
  localStorage.clear();
});

describe("哪些键会被同步", () => {
  test("题库内容、题库进度、general 配置都在范围内", () => {
    expect(isSyncableKey("quiz_app_general")).toBe(true);
    expect(isSyncableKey("quiz_app_questions_ab12")).toBe(true);
    expect(isSyncableKey("quiz_app_state_ab12")).toBe(true);
  });

  test("同步配置与同步元数据永远不进云端", () => {
    expect(isSyncableKey(STORAGE_KEY_SYNC_CONFIG)).toBe(false);
    expect(isSyncableKey(STORAGE_KEY_SYNC_META)).toBe(false);
    expect(isSyncableKey("quiz_app_sync_mtime:quiz_app_general")).toBe(false);
  });

  test("无关的键不会被顺手带上去", () => {
    expect(isSyncableKey("theme")).toBe(false);
    expect(isSyncableKey("quiz_app_library")).toBe(false);
  });
});

describe("分片约定", () => {
  test("分片文件名 ↔ 下标可往返", () => {
    expect(shardFileName(0)).toBe("banks-0.json");
    expect(shardFileName(8)).toBe("banks-8.json");
    expect(shardIndexFromFileName("banks-3.json")).toBe(3);
  });

  test("越界或不是分片的文件名都返回 null", () => {
    expect(shardIndexFromFileName("banks-9.json")).toBeNull();
    expect(shardIndexFromFileName("_general.json")).toBeNull();
    expect(shardIndexFromFileName("readme.md")).toBeNull();
  });

  test("任何题库 hash 都落在合法范围内，且同一 hash 永远落同一片", () => {
    const hashes = Array.from({ length: 500 }, (_, i) => `h${i}`);
    for (const hash of hashes) {
      const index = shardIndexOf(hash);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(SHARD_COUNT);
      expect(shardIndexOf(hash)).toBe(index);
    }
  });

  test("文件总数（1 个 general + 9 个分片）正好卡在 Gitee 的 10 个上限", () => {
    // Gitee 实测：10 个成功、11 个报「文件不能超过 10 个」
    expect(1 + SHARD_COUNT).toBeLessThanOrEqual(10);
  });
});

describe("认出「可同步的代码片段」", () => {
  // 这是「换设备时选哪条」的判据。判错就会闷头新建一条，
  // 表现成「同一个令牌在别处同步永远拿不到数据」——之前踩过的坑。
  test("描述对 + 含 _general.json → 是", () => {
    expect(
      looksLikeSyncGist({
        description: GIST_DESCRIPTION,
        fileNames: ["_general.json", "banks-0.json"],
      }),
    ).toBe(true);
  });

  test("描述对但里面没有 _general.json → 不是", () => {
    expect(
      looksLikeSyncGist({ description: GIST_DESCRIPTION, fileNames: ["notes.md"] }),
    ).toBe(false);
  });

  test("有 _general.json 但描述被改过 → 不是", () => {
    expect(
      looksLikeSyncGist({
        description: "something else",
        fileNames: ["_general.json"],
      }),
    ).toBe(false);
  });

  test("描述为空 → 不是", () => {
    expect(
      looksLikeSyncGist({ description: "", fileNames: ["_general.json"] }),
    ).toBe(false);
  });
});

describe("压缩往返", () => {
  test("编码再解码能拿回同一份内容", async () => {
    const snapshot = {
      mode: "memory",
      name: "英语短语",
      questions: [
        { id: "m1", type: "memory", question: "取得进步", answer: "make progress" },
      ],
      state: { memory: { progress: { m1: { state: "learning", streak: 1 } } } },
    };
    const encoded = await encodePayload(snapshot);
    const decoded = await decodePayload(encoded);
    expect(decoded).not.toBeNull();
    expect(JSON.parse(decoded as string)).toEqual(snapshot);
  });

  test("编码结果带版本号，且明显比原文小", async () => {
    const questions = Array.from({ length: 200 }, (_, i) => ({
      id: "m" + i,
      type: "memory",
      question: "取得进步 / 稳步推进",
      answer: "make progress steadily",
    }));
    const encoded = await encodePayload({ questions });
    const payload = JSON.parse(encoded) as { v: number; d: string };
    expect(payload.v).toBe(SYNC_PAYLOAD_VERSION);
    expect(encoded.length).toBeLessThan(JSON.stringify({ questions }).length / 2);
  });

  test("不是我们的格式时返回 null，而不是抛错", async () => {
    expect(await decodePayload("这不是 JSON")).toBeNull();
    expect(await decodePayload('{"hello":1}')).toBeNull();
    expect(await decodePayload('{"v":1}')).toBeNull();
  });

  test("版本比当前新时拒绝解码（别按旧规则解新数据）", async () => {
    expect(await decodePayload(JSON.stringify({ v: 99, d: "abc" }))).toBeNull();
  });
});

describe("逐题库三方合并", () => {
  test("两边内容一样 → 跳过（哪怕 mtime 很新鲜）", () => {
    // 应用一启动就会重写一遍本地配置 / 进度，mtime 常常是新鲜的；
    // 只看 mtime 会把「其实没变」判成冲突。
    const local = localBank(HASH_A, "题库", { localAt: 999999 });
    const remote = remoteBank(HASH_A, "题库");
    expect(judgeBank({ local, remote })).toBe("skip");
  });

  test("只有本地改过 → 上传", () => {
    const local = localBank(HASH_A, "题库", { localAt: 900, state: { round: 2 } });
    const remote = remoteBank(HASH_A, "题库");
    expect(
      judgeBank({
        local,
        remote,
        row: { remoteHash: remote.contentHash, syncedAt: 500, remoteUpdatedAt: 0 },
      }),
    ).toBe("push");
  });

  test("只有云端改过 → 下载", () => {
    const local = localBank(HASH_A, "题库", { localAt: 100 });
    const remote = remoteBank(HASH_A, "题库", { state: { round: 3 } });
    expect(
      judgeBank({
        local,
        remote,
        row: { remoteHash: "旧哈希", syncedAt: 500, remoteUpdatedAt: 0 },
      }),
    ).toBe("pull");
  });

  test("两边都改过 → 冲突，绝不自动选边", () => {
    const local = localBank(HASH_A, "题库", { localAt: 900, state: { round: 2 } });
    const remote = remoteBank(HASH_A, "题库", { state: { round: 3 } });
    expect(
      judgeBank({
        local,
        remote,
        row: { remoteHash: "旧哈希", syncedAt: 500, remoteUpdatedAt: 0 },
      }),
    ).toBe("conflict");
  });

  test("没有基准时：本地没进度、云端有 → 听云端的（本地没什么可丢）", () => {
    const local = localBank(HASH_A, "题库");
    const remote = remoteBank(HASH_A, "题库", { state: { round: 3 } });
    expect(judgeBank({ local, remote })).toBe("pull");
  });

  test("没有基准时：只有本地有进度 → 上传", () => {
    const local = localBank(HASH_A, "题库", { state: { round: 2 } });
    const remote = remoteBank(HASH_A, "题库");
    expect(judgeBank({ local, remote })).toBe("push");
  });

  test("没有基准、两边都有进度但不一样 → 冲突（不猜）", () => {
    const local = localBank(HASH_A, "题库", { state: { round: 2 } });
    const remote = remoteBank(HASH_A, "题库", { state: { round: 3 } });
    expect(judgeBank({ local, remote })).toBe("conflict");
  });

  test("只有本地有、没有基准 → 新导入的题库，上传", () => {
    expect(judgeBank({ local: localBank(HASH_A, "题库"), remote: undefined })).toBe(
      "push",
    );
  });

  test("只有本地有、但有基准 → 云端删掉了它，本地跟着删", () => {
    expect(
      judgeBank({
        local: localBank(HASH_A, "题库"),
        remote: undefined,
        row: { remoteHash: "h", syncedAt: 500, remoteUpdatedAt: 0 },
      }),
    ).toBe("deleteLocal");
  });

  test("只有云端有、没有基准 → 别的设备新增的，下载", () => {
    expect(judgeBank({ local: undefined, remote: remoteBank(HASH_A, "题库") })).toBe(
      "pull",
    );
  });

  test("只有云端有、但有基准 → 这台设备删过它，回收云端那一份", () => {
    expect(
      judgeBank({
        local: undefined,
        remote: remoteBank(HASH_A, "题库"),
        row: { remoteHash: "h", syncedAt: 500, remoteUpdatedAt: 0 },
      }),
    ).toBe("deleteRemote");
  });

  test("老格式（只有分片文件的基准）也能当兜底：文件没变 → 上传", () => {
    const local = localBank(HASH_A, "题库", { localAt: 900, state: { round: 2 } });
    const remote = remoteBank(HASH_A, "题库");
    expect(
      judgeBank({
        local,
        remote,
        fileRow: { remoteHash: "文件哈希", syncedAt: 500, remoteUpdatedAt: 0 },
        remoteFileHash: "文件哈希",
      }),
    ).toBe("push");
  });

  test("老格式兜底：分片文件变了、本地也动过 → 冲突", () => {
    const local = localBank(HASH_A, "题库", { localAt: 900, state: { round: 2 } });
    const remote = remoteBank(HASH_A, "题库", { state: { round: 3 } });
    expect(
      judgeBank({
        local,
        remote,
        fileRow: { remoteHash: "旧文件哈希", syncedAt: 500, remoteUpdatedAt: 0 },
        remoteFileHash: "新文件哈希",
      }),
    ).toBe("conflict");
  });
});

describe("合并计划", () => {
  test("本地改了 A、云端改了 B → 各走各的，互不牵连", () => {
    const localA = localBank(HASH_A, "题库一", { localAt: 900, state: { round: 2 } });
    const remoteA = remoteBank(HASH_A, "题库一");
    const localB = localBank(HASH_B, "题库二", { localAt: 100 });
    const remoteB = remoteBank(HASH_B, "题库二", { state: { round: 3 } });

    const plan = buildSyncPlan({
      local: localState([localA, localB]),
      remote: remoteState([remoteA, remoteB]),
      meta: metaWith({
        [bankRowKey(HASH_A)]: remoteA.contentHash,
        [bankRowKey(HASH_B)]: "云端改动之前的哈希",
      }),
    });

    const verdicts = Object.fromEntries(
      plan.actions.map((action) => [action.hash, action.verdict]),
    );
    expect(verdicts[HASH_A]).toBe("push");
    expect(verdicts[HASH_B]).toBe("pull");
    expect(plan.conflicts).toEqual([]);
    expect(plan.pushShards).toEqual([shardIndexOf(HASH_A)]);
  });

  test("冲突的分片整片冻结：同一片里别的题库这一轮也不上传", () => {
    // 分片是整体上传的，为了传同片的另一个题库而把它一起推上去，
    // 就等于替用户选了「保留本地」。
    const sameShard = findSameShardHashes(2);
    const [hash1, hash2] = sameShard;
    const local1 = localBank(hash1, "题库一", { localAt: 900, state: { round: 2 } });
    const remote1 = remoteBank(hash1, "题库一", { state: { round: 3 } });
    const local2 = localBank(hash2, "题库二", { localAt: 900, state: { round: 5 } });
    const remote2 = remoteBank(hash2, "题库二");

    const plan = buildSyncPlan({
      local: localState([local1, local2]),
      remote: remoteState([remote1, remote2]),
      meta: metaWith({
        [bankRowKey(hash1)]: "旧哈希",
        [bankRowKey(hash2)]: remote2.contentHash,
      }),
    });

    expect(plan.conflicts.map((conflict) => conflict.hash)).toEqual([hash1]);
    expect(plan.pushShards).toEqual([]);
  });

  test("云端题库一个不剩 → 那个分片文件也该回收", () => {
    const remote = remoteState([remoteBank(HASH_A, "题库一")]);
    const plan = buildSyncPlan({
      local: localState([]),
      remote,
      meta: metaWith({ [bankRowKey(HASH_A)]: "h" }),
    });

    expect(plan.actions[0].verdict).toBe("deleteRemote");
    expect(plan.deleteRemoteFiles).toEqual([shardFileName(shardIndexOf(HASH_A))]);
  });

  test("旧版「每题库一个文件」的残留一律回收", () => {
    const legacy: RemoteFile = {
      name: "a1b2c3d4e5f60718.json",
      hash: "h",
      json: "{}",
    };
    const plan = buildSyncPlan({
      local: localState([]),
      remote: remoteState([], {}, [legacy]),
      meta: emptySyncMeta(),
    });
    expect(plan.deleteRemoteFiles).toEqual(["a1b2c3d4e5f60718.json"]);
  });

  test("认不出来的陌生文件不动（可能是别人的东西）", () => {
    const stranger: RemoteFile = { name: "notes.md", hash: "h", json: null };
    const plan = buildSyncPlan({
      local: localState([]),
      remote: remoteState([], {}, [stranger]),
      meta: emptySyncMeta(),
    });
    expect(plan.deleteRemoteFiles).toEqual([]);
  });

  test("两边一致时计划是空的", () => {
    const local = localBank(HASH_A, "题库一", { localAt: 100 });
    const remote = remoteBank(HASH_A, "题库一");
    const general = {
      library: [{ hash: HASH_A, name: "题库一", mode: "memory" as const, count: 1 }],
    };
    const plan = buildSyncPlan({
      local: localState([local], general),
      remote: remoteState([remote], general),
      meta: metaWith({ [bankRowKey(HASH_A)]: remote.contentHash }),
    });
    expect(planIsEmpty(plan)).toBe(true);
  });

  test("强制上传 / 强制下载：无条件按一边来，不算冲突", () => {
    const local = localBank(HASH_A, "题库一", { localAt: 900, state: { round: 2 } });
    const remote = remoteBank(HASH_A, "题库一", { state: { round: 3 } });
    const remote2 = remoteBank(HASH_B, "题库二");
    const meta = metaWith({
      [bankRowKey(HASH_A)]: "旧",
      [bankRowKey(HASH_B)]: "旧",
    });

    const push = forcePushPlan(localState([local]), remoteState([remote, remote2]), meta);
    expect(push.conflicts).toEqual([]);
    expect(push.actions.find((a) => a.hash === HASH_A)?.verdict).toBe("push");
    expect(push.actions.find((a) => a.hash === HASH_B)?.verdict).toBe("deleteRemote");

    const pull = forcePullPlan(localState([local]), remoteState([remote]), meta);
    expect(pull.conflicts).toEqual([]);
    expect(pull.actions[0].verdict).toBe("pull");
  });

  test("冲突裁决后重算计划：keepLocal 全推、keepRemote 全拉", () => {
    const local = localBank(HASH_A, "题库一", { localAt: 900, state: { round: 2 } });
    const remote = remoteBank(HASH_A, "题库一", { state: { round: 3 } });
    const plan = buildSyncPlan({
      local: localState([local]),
      remote: remoteState([remote]),
      meta: metaWith({ [bankRowKey(HASH_A)]: "旧" }),
    });
    expect(plan.conflicts).toHaveLength(1);

    const keepLocal = applyResolution(plan, new Map([[HASH_A, "keepLocal"]]));
    expect(keepLocal.conflicts).toEqual([]);
    expect(keepLocal.actions[0].verdict).toBe("push");
    expect(keepLocal.pushShards).toEqual([shardIndexOf(HASH_A)]);

    const keepRemote = applyResolution(plan, new Map([[HASH_A, "keepRemote"]]));
    expect(keepRemote.conflicts).toEqual([]);
    expect(keepRemote.actions[0].verdict).toBe("pull");
    expect(keepRemote.pushShards).toEqual([]);
  });

  test("裁决只作用于用户看见过的题库：新冒出来的冲突继续留着问", () => {
    // 两次同步之间又有一台设备改了别的题库时，绝不能拿上一次的答案
    // 顺手把它也裁决掉——用户没见过的冲突必须重新问。
    const sameShard = findSameShardHashes(2);
    const [hash1, hash2] = sameShard;
    const local1 = localBank(hash1, "题库一", { localAt: 900, state: { round: 2 } });
    const remote1 = remoteBank(hash1, "题库一", { state: { round: 3 } });
    const local2 = localBank(hash2, "题库二", { localAt: 900, state: { round: 5 } });
    const remote2 = remoteBank(hash2, "题库二", { state: { round: 6 } });

    const plan = buildSyncPlan({
      local: localState([local1, local2]),
      remote: remoteState([remote1, remote2]),
      meta: metaWith({
        [bankRowKey(hash1)]: "旧哈希",
        [bankRowKey(hash2)]: "旧哈希",
      }),
    });
    expect(plan.conflicts).toHaveLength(2);

    // 用户只对题库一做了选择
    const resolved = applyResolution(plan, new Map([[hash1, "keepLocal"]]));
    expect(resolved.actions.find((a) => a.hash === hash1)?.verdict).toBe("push");
    expect(resolved.actions.find((a) => a.hash === hash2)?.verdict).toBe("conflict");
    expect(resolved.conflicts.map((c) => c.hash)).toEqual([hash2]);
    // 还剩冲突 → 那一片不能动
    expect(resolved.pushShards).toEqual([]);
  });
});

describe("general 的合并", () => {
  const remoteGeneral = normalizeGeneralSnapshot({
    activeBank: HASH_A,
    defaultSettings: { activePoolSize: 20 },
    library: [{ hash: HASH_A, name: "题库一", mode: "memory", count: 1 }],
    globalSettings: { soundEnabled: true },
  });

  test("新设备的空壳绝不能覆盖云端的题库列表", () => {
    // 线上 bug：新设备的 general 是个默认空壳，早期版本会把它推上云端，
    // 于是所有设备的题库列表都被清空。
    const shell = normalizeGeneralSnapshot({
      activeBank: null,
      defaultSettings: {},
      library: [],
      globalSettings: {},
    });
    const merged = mergeGeneral({
      local: shell,
      remote: remoteGeneral,
      base: null,
      actions: [
        {
          hash: HASH_A,
          name: "题库一",
          verdict: "pull",
          remoteHash: "h",
          localAt: 0,
        },
      ],
      localBanks: new Map(),
      remoteBanks: new Map([[HASH_A, remoteBank(HASH_A, "题库一")]]),
      localHasEdits: false,
    });

    expect(merged.library.map((entry) => entry.hash)).toEqual([HASH_A]);
    expect(merged.activeBank).toBe(HASH_A);
    expect(merged.globalSettings).toEqual({ soundEnabled: true });
  });

  test("题库列表是合并后的题库集合：两边各自导入的都在，删掉的消失", () => {
    const local = normalizeGeneralSnapshot({
      activeBank: HASH_B,
      defaultSettings: {},
      library: [{ hash: HASH_B, name: "题库二", mode: "memory", count: 1 }],
      globalSettings: {},
    });
    const merged = mergeGeneral({
      local,
      remote: remoteGeneral,
      base: null,
      actions: [
        { hash: HASH_A, name: "题库一", verdict: "pull", localAt: 0 },
        { hash: HASH_B, name: "题库二", verdict: "skip", localAt: 0 },
      ],
      localBanks: new Map([[HASH_B, localBank(HASH_B, "题库二")]]),
      remoteBanks: new Map([[HASH_A, remoteBank(HASH_A, "题库一")]]),
      localHasEdits: true,
    });

    expect(merged.library.map((entry) => entry.hash)).toEqual([HASH_B, HASH_A]);
    expect(merged.activeBank).toBe(HASH_B);
  });

  test("激活题库被删掉时退到云端那个，都没有就置空", () => {
    const local = normalizeGeneralSnapshot({
      activeBank: HASH_B,
      library: [{ hash: HASH_B, name: "题库二" }],
    });
    const merged = mergeGeneral({
      local,
      remote: remoteGeneral,
      base: null,
      actions: [
        { hash: HASH_A, name: "题库一", verdict: "skip", localAt: 0 },
        { hash: HASH_B, name: "题库二", verdict: "deleteLocal", localAt: 0 },
      ],
      localBanks: new Map([[HASH_B, localBank(HASH_B, "题库二")]]),
      remoteBanks: new Map([[HASH_A, remoteBank(HASH_A, "题库一")]]),
      localHasEdits: true,
    });
    expect(merged.activeBank).toBe(HASH_A);
  });

  test("全局设置逐字段三方合并：只有云端改过就听云端的", () => {
    const base = normalizeGeneralSnapshot({ globalSettings: { soundEnabled: true } });
    const local = normalizeGeneralSnapshot({ globalSettings: { soundEnabled: true } });
    const remote = normalizeGeneralSnapshot({ globalSettings: { soundEnabled: false } });
    const merged = mergeGeneral({
      local,
      remote,
      base,
      actions: [],
      localBanks: new Map(),
      remoteBanks: new Map(),
      localHasEdits: true,
    });
    expect(merged.globalSettings).toEqual({ soundEnabled: false });
  });

  test("全局设置逐字段三方合并：只有本地改过就听本地的", () => {
    const base = normalizeGeneralSnapshot({ globalSettings: { soundEnabled: true } });
    const local = normalizeGeneralSnapshot({ globalSettings: { soundEnabled: false } });
    const remote = normalizeGeneralSnapshot({ globalSettings: { soundEnabled: true } });
    const merged = mergeGeneral({
      local,
      remote,
      base,
      actions: [],
      localBanks: new Map(),
      remoteBanks: new Map(),
      localHasEdits: true,
    });
    expect(merged.globalSettings).toEqual({ soundEnabled: false });
  });

  test("题库顺序：云端调了顺序、本地没动 → 跟着云端", () => {
    const base = normalizeGeneralSnapshot({
      library: [
        { hash: HASH_A, name: "题库一" },
        { hash: HASH_B, name: "题库二" },
      ],
    });
    const local = normalizeGeneralSnapshot({ library: base.library });
    const remote = normalizeGeneralSnapshot({
      library: [
        { hash: HASH_B, name: "题库二" },
        { hash: HASH_A, name: "题库一" },
      ],
    });

    const merged = mergeGeneral({
      local,
      remote,
      base,
      actions: [
        { hash: HASH_A, name: "题库一", verdict: "skip", localAt: 0 },
        { hash: HASH_B, name: "题库二", verdict: "skip", localAt: 0 },
      ],
      localBanks: new Map([
        [HASH_A, localBank(HASH_A, "题库一")],
        [HASH_B, localBank(HASH_B, "题库二")],
      ]),
      remoteBanks: new Map([
        [HASH_A, remoteBank(HASH_A, "题库一")],
        [HASH_B, remoteBank(HASH_B, "题库二")],
      ]),
      localHasEdits: true,
    });

    expect(merged.library.map((entry) => entry.hash)).toEqual([HASH_B, HASH_A]);
  });

  test("题库顺序：本地调了顺序、云端没动 → 保留本地", () => {
    const base = normalizeGeneralSnapshot({
      library: [
        { hash: HASH_A, name: "题库一" },
        { hash: HASH_B, name: "题库二" },
      ],
    });
    const local = normalizeGeneralSnapshot({
      library: [
        { hash: HASH_B, name: "题库二" },
        { hash: HASH_A, name: "题库一" },
      ],
    });
    const remote = normalizeGeneralSnapshot({ library: base.library });

    const merged = mergeGeneral({
      local,
      remote,
      base,
      actions: [
        { hash: HASH_A, name: "题库一", verdict: "skip", localAt: 0 },
        { hash: HASH_B, name: "题库二", verdict: "skip", localAt: 0 },
      ],
      localBanks: new Map([
        [HASH_A, localBank(HASH_A, "题库一")],
        [HASH_B, localBank(HASH_B, "题库二")],
      ]),
      remoteBanks: new Map([
        [HASH_A, remoteBank(HASH_A, "题库一")],
        [HASH_B, remoteBank(HASH_B, "题库二")],
      ]),
      localHasEdits: true,
    });

    expect(merged.library.map((entry) => entry.hash)).toEqual([HASH_B, HASH_A]);
  });

  test("删掉题库不该被当成「重排」：剩下那些的顺序保持不变", () => {
    const base = normalizeGeneralSnapshot({
      library: [
        { hash: HASH_A, name: "题库一" },
        { hash: HASH_B, name: "题库二" },
      ],
    });
    const local = normalizeGeneralSnapshot({
      library: [{ hash: HASH_B, name: "题库二" }],
    });
    const remote = normalizeGeneralSnapshot({ library: base.library });

    const merged = mergeGeneral({
      local,
      remote,
      base,
      actions: [
        { hash: HASH_A, name: "题库一", verdict: "deleteLocal", localAt: 0 },
        { hash: HASH_B, name: "题库二", verdict: "skip", localAt: 0 },
      ],
      localBanks: new Map([[HASH_B, localBank(HASH_B, "题库二")]]),
      remoteBanks: new Map([
        [HASH_A, remoteBank(HASH_A, "题库一")],
        [HASH_B, remoteBank(HASH_B, "题库二")],
      ]),
      localHasEdits: true,
    });

    expect(merged.library.map((entry) => entry.hash)).toEqual([HASH_B]);
  });

  test("题库名按「哪边改过听哪边」：云端改了名就跟着改", () => {
    const base = normalizeGeneralSnapshot({
      library: [{ hash: HASH_A, name: "旧名字" }],
    });
    const local = normalizeGeneralSnapshot({
      library: [{ hash: HASH_A, name: "旧名字" }],
    });
    const remote = normalizeGeneralSnapshot({
      library: [{ hash: HASH_A, name: "新名字" }],
    });
    const merged = mergeGeneral({
      local,
      remote,
      base,
      actions: [{ hash: HASH_A, name: "新名字", verdict: "skip", localAt: 0 }],
      localBanks: new Map([[HASH_A, localBank(HASH_A, "旧名字")]]),
      remoteBanks: new Map([[HASH_A, remoteBank(HASH_A, "新名字")]]),
      localHasEdits: true,
    });
    expect(merged.library[0].name).toBe("新名字");
  });
});

describe("「设置也变了」这条信号", () => {
  // 报给用户的那句话里，题库的四项（新增 / 删除 / 上传 / 下载）之外还要提一句
  // 「设置已更新」——但导入一个题库也会让 `_general.json` 变（列表里多一条），
  // 那不是设置变了。这里钉住的就是这条界线。

  test("只调了题库顺序 → 设置变了（而且这一轮没有任何题库被传）", () => {
    const local = localState(
      [localBank(HASH_A, "题库一"), localBank(HASH_B, "题库二")],
      {
        library: [
          { hash: HASH_B, name: "题库二" },
          { hash: HASH_A, name: "题库一" },
        ],
      },
    );
    const remote = remoteState(
      [remoteBank(HASH_A, "题库一"), remoteBank(HASH_B, "题库二")],
      {
        library: [
          { hash: HASH_A, name: "题库一" },
          { hash: HASH_B, name: "题库二" },
        ],
      },
    );

    const plan = buildSyncPlan({
      local,
      remote,
      meta: metaWith(
        {
          [shardFileName(shardIndexOf(HASH_A))]: "file-x",
          [shardFileName(shardIndexOf(HASH_B))]: "file-y",
          [bankRowKey(HASH_A)]: local.banks.get(HASH_A)!.contentHash,
          [bankRowKey(HASH_B)]: local.banks.get(HASH_B)!.contentHash,
        },
        normalizeGeneralSnapshot({
          library: [
            { hash: HASH_A, name: "题库一" },
            { hash: HASH_B, name: "题库二" },
          ],
        }),
      ),
    });

    expect(plan.actions.every((action) => action.verdict === "skip")).toBe(true);
    expect(plan.settingsChanged, "顺序也是要同步的东西").toBe(true);
    expect(plan.generalPush).toBe(true);
  });

  test("导入一个新题库 → 不算设置变了（那是「新增」在报的事）", () => {
    const local = localState([localBank(HASH_A, "题库一")], {
      library: [{ hash: HASH_A, name: "题库一" }],
    });
    const remote = remoteState([], {});

    const plan = buildSyncPlan({ local, remote, meta: emptySyncMeta() });

    expect(plan.actions[0].verdict).toBe("push");
    expect(plan.generalPush, "列表里多一条，云端那份 general 当然要更新").toBe(
      true,
    );
    expect(plan.settingsChanged, "题库的增删不该说成「设置已更新」").toBe(false);
  });

  test("只有云端改过设置 → 设置变了", () => {
    const local = localState([localBank(HASH_A, "题库一")], {
      library: [{ hash: HASH_A, name: "题库一" }],
    });
    const remote = remoteState([remoteBank(HASH_A, "题库一")], {
      activeBank: HASH_A,
      library: [{ hash: HASH_A, name: "题库一" }],
    });

    const plan = buildSyncPlan({
      local,
      remote,
      meta: metaWith(
        { [bankRowKey(HASH_A)]: local.banks.get(HASH_A)!.contentHash },
        normalizeGeneralSnapshot({
          library: [{ hash: HASH_A, name: "题库一" }],
        }),
      ),
    });

    expect(plan.settingsChanged).toBe(true);
  });

  test("两边完全一致 → 设置没变（四个数也都是 0）", () => {
    const local = localState([localBank(HASH_A, "题库一")], {
      activeBank: HASH_A,
      globalSettings: { sound: true },
      library: [{ hash: HASH_A, name: "题库一" }],
    });
    const remote = remoteState([remoteBank(HASH_A, "题库一")], {
      activeBank: HASH_A,
      globalSettings: { sound: true },
      library: [{ hash: HASH_A, name: "题库一" }],
    });

    const plan = buildSyncPlan({
      local,
      remote,
      meta: metaWith(
        { [bankRowKey(HASH_A)]: local.banks.get(HASH_A)!.contentHash },
        local.general,
      ),
    });

    expect(plan.settingsChanged).toBe(false);
    expect(planIsEmpty(plan)).toBe(true);
  });

  test("改名只算设置变了（题库内容哈希不看名字，别报成「上传」）", () => {
    const local = localState([localBank(HASH_A, "新名字")], {
      library: [{ hash: HASH_A, name: "新名字" }],
    });
    const remote = remoteState([remoteBank(HASH_A, "旧名字")], {
      library: [{ hash: HASH_A, name: "旧名字" }],
    });

    const plan = buildSyncPlan({
      local,
      remote,
      meta: metaWith(
        { [bankRowKey(HASH_A)]: local.banks.get(HASH_A)!.contentHash },
        normalizeGeneralSnapshot({ library: [{ hash: HASH_A, name: "旧名字" }] }),
      ),
    });

    expect(plan.actions[0].verdict).toBe("skip");
    expect(plan.settingsChanged).toBe(true);
  });
});

describe("把云端文件解成状态", () => {
  test("分片里的题库、general、以及认不出来的文件都认得清", async () => {
    const snapshot = {
      banks: { [HASH_A]: makeBankSnapshot("题库一", { state: { round: 2 } }) },
    };
    const files: RemoteFile[] = [
      {
        name: GIST_GENERAL_FILE,
        hash: "g",
        json: JSON.stringify({ activeBank: HASH_A, library: [] }),
      },
      {
        name: shardFileName(shardIndexOf(HASH_A)),
        hash: "s",
        json: JSON.stringify(snapshot),
      },
      { name: "banks-1.json", hash: "broken", json: "这不是 JSON" },
      { name: "notes.md", hash: "x", json: null },
    ];

    const remote = buildRemoteState(files);
    expect(remote.banks.size).toBe(1);
    expect(remote.banks.get(HASH_A)?.name).toBe("题库一");
    expect(remote.general?.activeBank).toBe(HASH_A);
    expect(remote.unreadableShards).toEqual(["banks-1.json"]);
  });

  test("空的分片文件不会被当成有内容", () => {
    const remote = buildRemoteState([
      { name: "banks-2.json", hash: "s", json: JSON.stringify({ banks: {} }) },
    ]);
    expect(remote.banks.size).toBe(0);
    expect(remote.shardBanks.get(2)).toEqual([]);
  });

  test("题库名相同时内容哈希一致（云端解出来和本地收集的对得上）", () => {
    localStorage.setItem(
      `quiz_app_questions_${HASH_A}`,
      JSON.stringify(makeBankSnapshot("题库一").questions),
    );
    localStorage.setItem(
      `quiz_app_state_${HASH_A}`,
      JSON.stringify({ round: 2 }),
    );
    localStorage.setItem(
      "quiz_app_general",
      JSON.stringify({ library: [{ hash: HASH_A, name: "题库一", mode: "memory" }] }),
    );

    const local = collectLocalState(mtimeOf);
    const remote = buildRemoteState([
      {
        name: shardFileName(shardIndexOf(HASH_A)),
        hash: "s",
        json: JSON.stringify({
          banks: { [HASH_A]: makeBankSnapshot("题库一", { state: { round: 2 } }) },
        }),
      },
    ]);

    expect(local.banks.get(HASH_A)?.contentHash).toBe(
      remote.banks.get(HASH_A)?.contentHash,
    );
  });

  test("题库名不算进内容哈希（改个名不该变成「题库内容变了」）", () => {
    const a = makeBankSnapshot("旧名字", { state: { round: 2 } });
    const b = makeBankSnapshot("新名字", { state: { round: 2 } });
    expect(bankContentHash(a)).toBe(bankContentHash(b));
  });
});

describe("同步配置（令牌 + Gist ID）", () => {
  test("全新安装时没有令牌，但自动同步是开的", () => {
    expect(EMPTY_SYNC_CONFIG.token).toBe("");
    expect(EMPTY_SYNC_CONFIG.gistId).toBe("");
    expect(EMPTY_SYNC_CONFIG.autoSync).toBe(true);
  });

  test("两端的空白会被去掉", () => {
    expect(
      sanitizeSyncConfig({
        token: "  abc123  ",
        gistId: "  g1  ",
        gistUrl: "  https://gitee.com/me/codes/g1  ",
      }),
    ).toEqual({
      enabled: true,
      token: "abc123",
      gistId: "g1",
      gistUrl: "https://gitee.com/me/codes/g1",
      autoSync: true,
    });
  });

  test("旧版存储后端的凭据一律丢弃（它们在 Gitee 上没有意义）", () => {
    const legacy = sanitizeSyncConfig({
      supabaseUrl: "https://xxxx.supabase.co",
      supabaseKey: "sb_secret_xxx",
      credentials: "https://xxxx.supabase.co sb_secret_xxx",
      relayUrl: "/api/sync",
      autoSync: false,
    });
    expect(legacy.token).toBe("");
    expect(legacy.gistId).toBe("");
    expect(legacy.autoSync).toBe(false);
    expect(JSON.stringify(legacy)).not.toContain("supabase");
  });

  test("掩码展示不会泄露令牌主体", () => {
    const masked = maskToken("35fe6113451a4e4a17b98e8a79264af6");
    expect(masked).toContain("…");
    expect(masked).not.toContain("1a4e4a17b98e8a79264af6");
    expect(maskToken("")).toBe("");
    expect(maskToken("short")).toBe("••••");
  });

  test("非法输入回落到默认值，不抛错", () => {
    expect(sanitizeSyncConfig(null)).toEqual(EMPTY_SYNC_CONFIG);
    expect(sanitizeSyncConfig("nonsense")).toEqual(EMPTY_SYNC_CONFIG);
  });
});

describe("同步目标", () => {
  test("默认指向官方 Gitee API", () => {
    expect(giteeApiBase()).toBe(GITEE_API_BASE);
  });

  test("令牌 + Gist ID 合成同步目标", () => {
    const { target, error } = resolveSyncTarget({
      enabled: true,
      token: "tok",
      gistId: "g1",
      gistUrl: "",
      autoSync: true,
    });
    expect(error).toBeUndefined();
    expect(target).toEqual({
      apiBase: GITEE_API_BASE,
      enabled: true,
      token: "tok",
      gistId: "g1",
      gistUrl: "",
      autoSync: true,
    });
  });

  test("没填令牌时给出可读提示，而不是抛错", () => {
    expect(
      resolveSyncTarget({
        enabled: true,
        token: "  ",
        gistId: "",
        gistUrl: "",
        autoSync: true,
      }).error,
    ).toContain("未填写");
  });
});

describe("同步元数据", () => {
  test("读写一轮保持不变（题库行 + general 基准）", () => {
    const baseline = normalizeGeneralSnapshot({ activeBank: HASH_A, library: [] });
    saveSyncMeta({
      lastSyncedAt: 123,
      bootstrapped: true,
      rows: {
        [bankRowKey(HASH_A)]: {
          remoteHash: "h",
          syncedAt: 123,
          remoteUpdatedAt: 100,
          shard: 4,
        },
      },
      generalBaseline: baseline,
    });
    const meta = loadSyncMeta();
    expect(meta.bootstrapped).toBe(true);
    expect(meta.rows[bankRowKey(HASH_A)]?.remoteHash).toBe("h");
    expect(meta.rows[bankRowKey(HASH_A)]?.shard).toBe(4);
    expect(meta.generalBaseline).toEqual(baseline);
  });

  test("没有 remoteHash 的旧记录被丢掉（那套是服务端逐行时间戳时代的）", () => {
    localStorage.setItem(
      STORAGE_KEY_SYNC_META,
      JSON.stringify({
        lastSyncedAt: 1,
        bootstrapped: true,
        rows: {
          "old.json": { remoteUpdatedAt: 500, syncedAt: 500 },
          "new.json": { remoteHash: "h", syncedAt: 500, remoteUpdatedAt: 500 },
        },
      }),
    );
    const meta = loadSyncMeta();
    expect(meta.rows["old.json"]).toBeUndefined();
    expect(meta.rows["new.json"]).toBeDefined();
  });

  test("元数据损坏时回落到空值，不抛错", () => {
    localStorage.setItem(STORAGE_KEY_SYNC_META, "{ 这不是 JSON");
    expect(loadSyncMeta()).toEqual(emptySyncMeta());
  });
});

describe("本地改动时间", () => {
  test("写入一个可同步键会留下 mtime", () => {
    localStorage.setItem("quiz_app_general", "{}");
    expect(mtimeOf("quiz_app_general")).toBeGreaterThan(0);
  });

  test("拉取云端内容**不**记成本地改动（否则下一轮会自己和自己冲突）", () => {
    localStorage.setItem("quiz_app_general", "{}");
    const before = mtimeOf("quiz_app_general");
    expect(before).toBeGreaterThan(0);

    applyRemoteValue("quiz_app_general", '{"activeBank":"x"}');
    expect(mtimeOf("quiz_app_general")).toBe(before);
    expect(localStorage.getItem("quiz_app_general")).toBe('{"activeBank":"x"}');
  });

  test("只在本地写入，不产生同步元数据", () => {
    localStorage.setItem("quiz_app_general", "{}");
    expect(loadSyncMeta().rows["quiz_app_general"]).toBeUndefined();
    expect(loadSyncMeta().bootstrapped).toBe(false);
  });
});

/** 找几个落在同一个分片里的 hash。 */
function findSameShardHashes(count: number): string[] {
  const byShard = new Map<number, string[]>();
  for (let i = 0; i < 20000; i += 1) {
    const hash = `x${i}`.padEnd(16, "0");
    const index = shardIndexOf(hash);
    const list = byShard.get(index) ?? [];
    list.push(hash);
    byShard.set(index, list);
    if (list.length >= count) return list.slice(0, count);
  }
  throw new Error("找不到足够多落在一片里的 hash");
}
