/**
 * 云端那一侧：把 Gitee 的分片文件解成 `RemoteState`，以及分片级的杂项判断。
 *
 * 从旧的 `merge.ts` 拆出来——那个文件 1000 多行，合并 / 计划 / general / 云端解析
 * 全混在一起。这里只做「把远端读成结构」，不做任何决策。
 */

import { bankContentHash, bankProgressHash, normalizeGeneral } from "./collect";
import { stripDeviceLocal } from "./model/policy";
import {
  GIST_GENERAL_FILE,
  isLegacyBankFileName,
  shardIndexFromFileName,
  shardIndexOf,
  type BankSnapshot,
  type GeneralSnapshot,
  type RemoteBank,
  type RemoteFile,
  type RemoteState,
  type ShardSnapshot,
} from "./types";

export function remoteJunkFiles(remote: RemoteState): string[] {
  const junk: string[] = [];
  for (const file of remote.files) {
    if (file.name === GIST_GENERAL_FILE) continue;
    if (shardIndexFromFileName(file.name) !== null) continue;
    // 旧版「每个题库一个文件」的残留一律回收；别的陌生文件不动
    if (isLegacyBankFileName(file.name)) junk.push(file.name);
  }
  return junk.sort();
}

/** 从本地 / 云端两边算出完整计划。 */

export function buildRemoteState(files: readonly RemoteFile[]): RemoteState {
  const banks = new Map<string, RemoteBank>();
  const shardBanks = new Map<number, string[]>();
  const unreadableShards: string[] = [];

  let general: GeneralSnapshot | null = null;
  let generalHash = "";

  for (const file of files) {
    if (file.name === GIST_GENERAL_FILE) {
      generalHash = file.hash;
      general = parseGeneral(file.json);
      continue;
    }
    const index = shardIndexFromFileName(file.name);
    if (index === null) continue;
    if (file.json === null) {
      unreadableShards.push(file.name);
      continue;
    }
    let snapshot: ShardSnapshot;
    try {
      snapshot = JSON.parse(file.json) as ShardSnapshot;
    } catch {
      unreadableShards.push(file.name);
      continue;
    }
    const record = snapshot?.banks;
    if (record === null || typeof record !== "object") {
      unreadableShards.push(file.name);
      continue;
    }

    const hashes: string[] = [];
    for (const [hash, raw] of Object.entries(record)) {
      if (raw === null || typeof raw !== "object") continue;
      const bank = raw as BankSnapshot;
      if (!Array.isArray(bank.questions)) continue;
      const name =
        typeof bank.name === "string" && bank.name.length > 0
          ? bank.name
          : "未命名题库";
      const snapshot: BankSnapshot = {
        mode: bank.mode === "memory" ? "memory" : "quiz",
        name,
        questions: bank.questions,
        // `== null` 而不是 `=== undefined`：云端分片里写着 `"state": null` 时，
        // `JSON.parse` 得到 `null`，它和「没有这个字段」是同一个意思（进度哈希
        // 也把它们归一到同一个值）。原样留成 `null` 会让下游把「没进度」读成
        // 「有进度」——本地快照那一侧（`collectLocalState`）同样这么归一。
        //
        // `stripDeviceLocal`：**云端那一侧也要剥**。本地收集时剥了、云端不剥的话，
        // 两边结构天生不一样：进度哈希永远对不上（"永远待同步"），而且升级前推上去的
        // 老快照会把 `activePool` / `ui` 这些又灌回本地。剥掉之后两边同一个口径，
        // 老数据被安静忽略，下一次真正的上传顺手把云端也洗干净。
        ...(bank.state == null ? {} : { state: stripDeviceLocal(bank.state) }),
      };
      hashes.push(hash);
      banks.set(hash, {
        hash,
        shard: index,
        // 哈希算在归一化后的快照上，和本地那份用同一套口径
        contentHash: bankContentHash(snapshot),
        progressHash: bankProgressHash(snapshot),
        name,
        snapshot,
      });
    }
    shardBanks.set(index, hashes);
  }

  return { general, generalHash, files: [...files], banks, shardBanks, unreadableShards };
}

function parseGeneral(json: string | null): GeneralSnapshot | null {
  if (json === null) return null;
  try {
    return normalizeGeneral(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * 在云端分片里按 hash 找这个题库、算出它的内容哈希。
 *
 * 用在「只有本地有」的删除判定上：`remote.banks` 是按**题目内容**归拢的，
 * 云端改过题目时匹配不上，但分片快照里的 `banks[<hash>]` 仍然在。
 * 找到就用 `bankContentHash` 算（与本地同一个口径），找不到返回 undefined
 * （= 云端确实没有这个题库 = 真删除）。
 */
export function bankContentHashInRemoteFiles(
  remote: RemoteState,
  hash: string,
): string | undefined {
  const index = shardIndexOf(hash);
  const file = remote.files.find(
    (candidate) => shardIndexFromFileName(candidate.name) === index,
  );
  if (file?.json == null) return undefined;
  try {
    const parsed = JSON.parse(file.json) as { banks?: Record<string, unknown> };
    const bank = parsed?.banks?.[hash];
    if (bank === null || typeof bank !== "object") return undefined;
    const snapshot = bank as BankSnapshot;
    if (!Array.isArray(snapshot.questions)) return undefined;
    return bankContentHash(snapshot);
  } catch {
    return undefined;
  }
}

/** 「用本地覆盖云端」：无条件把本地全部推上去，云端多出来的题库删掉。 */

/** 远端「读不出来」的东西（读不出来 ≠ 没有，见 `remoteReadDamage`）。 */
export interface RemoteDamage {
  /** 解不开的分片文件名 */
  shards: string[];
  /** `_general.json` 在，但解不开 */
  general: boolean;
}

/**
 * 远端有没有**读不出来**的文件。
 *
 * ── 为什么必须有这道闸 ──────────────────────────────────────────────────────
 *
 * 读不出来 ≠ 没有。云端某个分片解不开时，那个分片里的题库在 `remote.banks` 里
 * **根本不存在**，于是判定把它们当成「云端删掉了」推出 `deleteLocal`，
 * 引擎就把本地题库**连题目带还没同步的进度一起删掉**——而且提示写的是
 * 「删除 1」，用户完全看不出这是数据损坏导致的。线上复现过：把云端分片改成垃圾，
 * 同步一次本地正在做的那个题库就没了，云端那个坏文件还原样没动。
 *
 * `_general.json` 同理，但后果更大：它解不开会被当成「云端没有 general」，
 * 于是用空壳合并并把空壳**推上云端**，`defaultSettings` / `globalSettings`
 * 在本地和云端**一起变成 `{}`**。
 *
 * 哪些情况会「读不出来」：Gitee 把响应体截断（GitHub 会带 `truncated` 标志，
 * Gitee 行为无文档）、payload 版本比本机新（`decodePayload` 是**故意**返回 null 的，
 * 注释写着「调用方应当跳过它而不是当成损坏数据删掉」）、响应体被截断或写坏。
 *
 * 返回 `null` = 远端读全了，可以正常规划。
 */
export function remoteReadDamage(remote: RemoteState): RemoteDamage | null {
  // `generalHash` 非空说明 `_general.json` **在**（只是解不开）；
  // 它为空才是「云端压根没有这个文件」。
  const general = remote.general === null && remote.generalHash !== "";
  if (remote.unreadableShards.length === 0 && !general) return null;
  return { shards: [...remote.unreadableShards].sort(), general };
}
