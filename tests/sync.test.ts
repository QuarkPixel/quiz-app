/**
 * 云同步的核心逻辑测试。
 *
 * 重点覆盖「会不会静默覆盖用户数据」这一类问题：
 *   - 哪些键会被同步（密钥绝不能进云端）
 *   - 逐行三方合并的判定
 *   - 孤儿行的判定（另一台设备的数据不能被误删）
 *   - 首次同步的取向
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  buildSyncPlan,
  computeOrphans,
  decideBootstrap,
  groupByIds,
  judgeRow,
  planIsEmpty,
} from "@/features/sync/plan";
import {
  collectLocalEntries,
  collectLocalTimestamps,
  installStorageHook,
  isSyncableKey,
  loadSyncMeta,
  saveSyncMeta,
} from "@/features/sync/storage";
import { sameJson } from "@/features/sync/engine.svelte";
import {
  EMPTY_SYNC_CONFIG,
  STORAGE_KEY_SYNC_CONFIG,
  STORAGE_KEY_SYNC_META,
  SYNC_API_PATH,
  emptySyncMeta,
  type RemoteRowMeta,
} from "@/features/sync/types";
import {
  isValidSupabaseUrl,
  maskKey,
  sanitizeSyncConfig,
} from "@/features/sync/config.svelte";
import { relayBase, resolveSyncTarget } from "@/features/sync/relay";
import type { LocalEntry } from "@/features/sync/storage";

function entry(id: string, value: string, localAt: number): LocalEntry {
  return { id, value, localAt };
}

function remoteRow(id: string, updatedAt: number): RemoteRowMeta {
  return { id, updatedAt };
}

beforeEach(() => {
  installStorageHook();
  localStorage.clear();
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

  test("收集时跳过密钥，只收题库数据", () => {
    localStorage.setItem(
      STORAGE_KEY_SYNC_CONFIG,
      JSON.stringify({ supabaseKey: "sb_publishable_secret" }),
    );
    localStorage.setItem(
      "quiz_app_general",
      JSON.stringify({ activeBank: null }),
    );
    localStorage.setItem("quiz_app_questions_abc", "[]");

    const ids = collectLocalEntries().map((item) => item.id);
    expect(ids).toEqual(["quiz_app_general", "quiz_app_questions_abc"]);

    const serialized = JSON.stringify(collectLocalEntries());
    expect(serialized).not.toContain("sb_publishable_secret");
  });
});

describe("本地改动时间", () => {
  test("写入一个可同步键会留下 mtime", () => {
    localStorage.setItem("quiz_app_general", "{}");
    const at = collectLocalTimestamps()["quiz_app_general"];
    expect(at).toBeGreaterThan(0);
  });

  test("只在本地写入，不产生元数据（同步前不该假装已经同步过）", () => {
    localStorage.setItem("quiz_app_general", "{}");
    const meta = loadSyncMeta();
    expect(meta.rows["quiz_app_general"]).toBeUndefined();
    expect(meta.bootstrapped).toBe(false);
  });
});

describe("逐行三方合并", () => {
  test("两边都没动 → 跳过", () => {
    expect(judgeRow(100, 100, { remoteUpdatedAt: 100, syncedAt: 100 })).toBe(
      "skip",
    );
  });

  test("只有本地动过 → 上传", () => {
    expect(judgeRow(200, 100, { remoteUpdatedAt: 100, syncedAt: 100 })).toBe(
      "push",
    );
  });

  test("只有云端动过 → 下载", () => {
    expect(judgeRow(100, 200, { remoteUpdatedAt: 100, syncedAt: 100 })).toBe(
      "pull",
    );
  });

  test("两边都动过 → 冲突，绝不自动选边", () => {
    expect(judgeRow(200, 300, { remoteUpdatedAt: 100, syncedAt: 100 })).toBe(
      "conflict",
    );
  });

  test("没有元数据（首次见到这一行）时，两边都有内容也算冲突", () => {
    expect(judgeRow(100, 200, undefined)).toBe("conflict");
  });
});

describe("孤儿行", () => {
  // 「孤儿」= 云端有这一行，而本地既没有这一行、**又有它的元数据**。
  //
  // 元数据是关键，它是「这台设备见过这一行」的证据：
  //   - 有元数据、本地却没有 → 本地主动删掉了它（删题库 / 换题库）→ 该回收云端那一行
  //   - 连元数据都没有         → 这台设备从没见过它（另一台设备刚导入的新题库）
  //                            → 那是别人的数据，绝不能删
  //
  // 失败要偏保守：漏删一行只是云端多留一条垃圾，多删一行就是不可恢复的数据丢失，
  // 所以判据宁可站在「不删」那一边。
  test("本地没有、也没有元数据 → 别的设备的数据，不许删", () => {
    expect(
      computeOrphans(new Set(), ["quiz_app_state_new"], emptySyncMeta()),
    ).toEqual(["quiz_app_state_new"]);
  });

  test("本地没有、但有元数据 → 这台设备删掉了它，该回收云端那一行", () => {
    const meta = {
      lastSyncedAt: 1,
      bootstrapped: true,
      rows: { quiz_app_state_gone: { remoteUpdatedAt: 1, syncedAt: 1 } },
    };
    expect(computeOrphans(new Set(), ["quiz_app_state_gone"], meta)).toEqual(
      [],
    );
  });

  test("本地存在的行永远不是孤儿", () => {
    expect(
      computeOrphans(
        new Set(["quiz_app_state_here"]),
        ["quiz_app_state_here"],
        emptySyncMeta(),
      ),
    ).toEqual([]);
  });

  test("关键不变式：有没有元数据，决定同一行删不删", () => {
    const id = "quiz_app_state_same";
    const remoteIds = [id];
    const withMeta = computeOrphans(new Set(), remoteIds, {
      lastSyncedAt: 1,
      bootstrapped: true,
      rows: { [id]: { remoteUpdatedAt: 1, syncedAt: 1 } },
    });
    const withoutMeta = computeOrphans(new Set(), remoteIds, emptySyncMeta());

    // 同一行、同一份远端数据，唯一的差别是本地有没有它的元数据。
    // 两者的结论必须不同，否则「本地删题库」和「别的设备加题库」就分不开了。
    expect(withMeta).not.toEqual(withoutMeta);
    // 保守方向：没有元数据时必须保留（那是别人的数据）
    expect(withoutMeta).toEqual(remoteIds);
  });
});

describe("同步计划", () => {
  const meta = {
    lastSyncedAt: 500,
    bootstrapped: true,
    rows: {
      quiz_app_general: { remoteUpdatedAt: 500, syncedAt: 500 },
      quiz_app_state_a: { remoteUpdatedAt: 500, syncedAt: 500 },
      quiz_app_state_gone: { remoteUpdatedAt: 500, syncedAt: 500 },
    },
  };

  const local = [
    entry("quiz_app_general", '{"v":2}', 600),
    entry("quiz_app_state_a", '{"v":1}', 500),
    entry("quiz_app_state_b", '{"v":1}', 400),
  ];
  const remote = [
    remoteRow("quiz_app_general", 500),
    remoteRow("quiz_app_state_a", 700),
    remoteRow("quiz_app_state_gone", 500),
    remoteRow("quiz_app_questions_new", 300),
  ];

  const plan = buildSyncPlan({ local, remote, meta });

  test("本地改过的行排进上传", () => {
    expect(plan.pushUpdated.map((item) => item.id)).toEqual([
      "quiz_app_general",
    ]);
  });

  test("云端改过的行排进下载", () => {
    expect(plan.pullUpdated).toEqual(["quiz_app_state_a"]);
  });

  test("本地新增的行排进上传", () => {
    expect(plan.pushNew.map((item) => item.id)).toEqual(["quiz_app_state_b"]);
  });

  test("云端独有、这台设备从没见过的行 → 下载（换设备靠这条恢复）", () => {
    expect(plan.pullNew).toEqual(["quiz_app_state_gone"]);
  });

  test("云端独有、但本地主动删过的行（有元数据）→ 当孤儿回收", () => {
    expect(plan.orphans).toEqual(["quiz_app_questions_new"]);
  });

  test("两边一致时计划是空的", () => {
    const stable = buildSyncPlan({
      local: [entry("quiz_app_general", "{}", 500)],
      remote: [remoteRow("quiz_app_general", 500)],
      meta,
    });
    expect(planIsEmpty(stable)).toBe(true);
  });

  test("按 id 分组会丢掉重复项（后一个覆盖前一个）", () => {
    const grouped = groupByIds(
      [entry("a", "1", 1), entry("a", "2", 2)],
      [remoteRow("a", 5), remoteRow("b", 6)],
    );
    expect(grouped.local.get("a")?.value).toBe("2");
    expect(grouped.remote.size).toBe(2);
  });
});

describe("首次同步的取向", () => {
  test("云端为空 → 上传本地", () => {
    expect(
      decideBootstrap({
        hasLocalData: true,
        hasRemoteData: false,
        localMatchesRemote: false,
        latestLocalAt: 100,
      }),
    ).toBe("pushLocal");
  });

  test("本地为空 → 下载云端（新设备 / 清过缓存）", () => {
    expect(
      decideBootstrap({
        hasLocalData: false,
        hasRemoteData: true,
        localMatchesRemote: false,
        latestLocalAt: 0,
      }),
    ).toBe("pullRemote");
  });

  test("两边都有数据且内容一致 → 什么都不做，只补基准线", () => {
    expect(
      decideBootstrap({
        hasLocalData: true,
        hasRemoteData: true,
        localMatchesRemote: true,
        latestLocalAt: 100,
      }),
    ).toBeNull();
  });

  test("两边都有数据、本地有未推送的改动 → 偏向本地", () => {
    expect(
      decideBootstrap({
        hasLocalData: true,
        hasRemoteData: true,
        localMatchesRemote: false,
        latestLocalAt: 100,
      }),
    ).toBe("pushLocal");
  });

  test("两边都有数据、本地从未改过 → 偏向云端", () => {
    expect(
      decideBootstrap({
        hasLocalData: true,
        hasRemoteData: true,
        localMatchesRemote: false,
        latestLocalAt: 0,
      }),
    ).toBe("pullRemote");
  });
});

describe("JSON 等价判定", () => {
  test("键序不同但内容相同算等价", () => {
    expect(sameJson('{"a":1,"b":2}', '{"b":2,"a":1}')).toBe(true);
  });

  test("内容不同不算等价", () => {
    expect(sameJson('{"a":1}', '{"a":2}')).toBe(false);
  });

  test("一边缺失时只有同为 null 才算等价", () => {
    expect(sameJson(null, null)).toBe(true);
    expect(sameJson("{}", null)).toBe(false);
  });
});

describe("同步元数据", () => {
  test("读写一轮保持不变", () => {
    saveSyncMeta({
      lastSyncedAt: 123,
      bootstrapped: true,
      rows: { quiz_app_general: { remoteUpdatedAt: 100, syncedAt: 123 } },
    });
    const meta = loadSyncMeta();
    expect(meta.bootstrapped).toBe(true);
    expect(meta.lastSyncedAt).toBe(123);
    expect(meta.rows["quiz_app_general"]?.remoteUpdatedAt).toBe(100);
  });

  test("元数据里混进不可同步的键会被丢掉", () => {
    localStorage.setItem(
      STORAGE_KEY_SYNC_META,
      JSON.stringify({
        lastSyncedAt: 1,
        bootstrapped: true,
        rows: {
          [STORAGE_KEY_SYNC_CONFIG]: { remoteUpdatedAt: 1, syncedAt: 1 },
          quiz_app_general: { remoteUpdatedAt: 1, syncedAt: 1 },
        },
      }),
    );
    const meta = loadSyncMeta();
    expect(meta.rows[STORAGE_KEY_SYNC_CONFIG]).toBeUndefined();
    expect(meta.rows["quiz_app_general"]).toBeDefined();
  });

  test("元数据损坏时回落到空值，不抛错", () => {
    localStorage.setItem(STORAGE_KEY_SYNC_META, "{ 这不是 JSON");
    expect(loadSyncMeta()).toEqual(emptySyncMeta());
  });
});

describe("同步配置（地址 + 密钥）", () => {
  test("全新安装时两样都是空的，但自动同步是开的", () => {
    expect(EMPTY_SYNC_CONFIG.supabaseUrl).toBe("");
    expect(EMPTY_SYNC_CONFIG.supabaseKey).toBe("");
    expect(EMPTY_SYNC_CONFIG.autoSync).toBe(true);
  });

  test("两端的空白会被去掉", () => {
    expect(
      sanitizeSyncConfig({
        supabaseUrl: "  https://abcd.supabase.co  ",
        supabaseKey: "  sb_secret_xyz  ",
      }),
    ).toEqual({
      supabaseUrl: "https://abcd.supabase.co",
      supabaseKey: "sb_secret_xyz",
      autoSync: true,
    });
  });

  test("地址必须是 https 的 Supabase 域名", () => {
    expect(isValidSupabaseUrl("https://abcd.supabase.co")).toBe(true);
    expect(isValidSupabaseUrl("https://abcd.supabase.in")).toBe(true);
    expect(isValidSupabaseUrl("http://abcd.supabase.co")).toBe(false);
    expect(isValidSupabaseUrl("https://example.com")).toBe(false);
    expect(isValidSupabaseUrl("https://abcd.supabase.co/rest/v1")).toBe(false);
    expect(isValidSupabaseUrl("")).toBe(false);
  });

  test("旧版把两样塞在一个 credentials 字段里时，会自动拆开", () => {
    expect(
      sanitizeSyncConfig({
        credentials: "https://abcd.supabase.co sb_secret_xyz",
        autoSync: false,
      }),
    ).toEqual({
      supabaseUrl: "https://abcd.supabase.co",
      supabaseKey: "sb_secret_xyz",
      autoSync: false,
    });
  });

  test("更早那种带 relayUrl 的形状也能读，且丢掉已经没用的中转地址", () => {
    expect(
      sanitizeSyncConfig({
        supabaseUrl: "https://abcd.supabase.co",
        supabaseKey: "sb_secret_xyz",
        relayUrl: "https://old.example.com/api/sync",
        autoSync: true,
      }),
    ).toEqual({
      supabaseUrl: "https://abcd.supabase.co",
      supabaseKey: "sb_secret_xyz",
      autoSync: true,
    });
  });

  test("掩码展示不会泄露密钥主体", () => {
    const masked = maskKey("sb_secret_abcdefghijklmnop");
    expect(masked).toContain("…");
    expect(masked).not.toContain("abcdefghijklmnop");
    expect(maskKey("")).toBe("");
    expect(maskKey("short")).toBe("••••");
  });

  test("非法输入回落到默认值，不抛错", () => {
    expect(sanitizeSyncConfig(null)).toEqual(EMPTY_SYNC_CONFIG);
    expect(sanitizeSyncConfig("nonsense")).toEqual(EMPTY_SYNC_CONFIG);
  });
});

describe("后端地址与同步目标", () => {
  test("默认走同源路径，用户不需要填后端地址", () => {
    expect(relayBase()).toBe(SYNC_API_PATH);
  });

  test("地址 + 密钥 + 同源路径合成同步目标", () => {
    const { target, error } = resolveSyncTarget({
      supabaseUrl: "https://abcd.supabase.co",
      supabaseKey: "sb_secret_xyz",
      autoSync: true,
    });
    expect(error).toBeUndefined();
    expect(target).toEqual({
      relayUrl: SYNC_API_PATH,
      supabaseUrl: "https://abcd.supabase.co",
      supabaseKey: "sb_secret_xyz",
      autoSync: true,
    });
  });

  test("缺哪一样就提示哪一样，而不是抛错", () => {
    const base = { supabaseUrl: "", supabaseKey: "", autoSync: true };
    expect(resolveSyncTarget(base).error).toContain("还没填");
    expect(
      resolveSyncTarget({ ...base, supabaseKey: "sb_secret_xyz" }).error,
    ).toContain("项目地址");
    expect(
      resolveSyncTarget({ ...base, supabaseUrl: "https://example.com" }).error,
    ).toContain("形如");
    expect(
      resolveSyncTarget({
        ...base,
        supabaseUrl: "https://abcd.supabase.co",
      }).error,
    ).toContain("密钥");
  });
});
