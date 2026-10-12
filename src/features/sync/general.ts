/**
 * general 配置（题库列表 + 全局设置 + 默认设置）的三方合并。
 *
 * 从旧的 `merge.ts` 拆出来。这里最容易出事的是**新设备的空壳**：刚打开应用时
 * 本地 general 是空的，而它一启动就被重写过（mtime 永远新鲜），只看 mtime 会把它
 * 判成「本地改过」并推上去，于是所有设备的题库列表被清空
 * ——这是线上真实发生过的数据丢失。
 */

import { stableHash, type BankRecord } from "./collect";
import { same } from "./model/same";
import type {
  BankAction,
  GeneralSnapshot,
  LibraryEntry,
  RemoteBank,
} from "./types";

const EMPTY_GENERAL: GeneralSnapshot = {
  activeBank: null,
  defaultSettings: {},
  library: [],
  globalSettings: {},
};

/** 一个题库名 / 模式 / 数量，用来给题库列表补条目。 */
interface BankSummaryInput {
  name: string;
  mode: "quiz" | "memory";
  count: number;
}

export function summarize(
  actions: readonly BankAction[],
  localBanks: ReadonlyMap<string, BankRecord>,
  remoteBanks: ReadonlyMap<string, RemoteBank>,
): Map<string, BankSummaryInput> {
  const result = new Map<string, BankSummaryInput>();
  for (const action of actions) {
    if (action.verdict === "deleteLocal" || action.verdict === "deleteRemote") {
      continue;
    }
    const local = localBanks.get(action.hash);
    const remote = remoteBanks.get(action.hash);
    const bank = local?.snapshot ?? remote?.snapshot;
    if (bank === undefined) continue;
    result.set(action.hash, {
      name: bank.name,
      mode: bank.mode,
      count: Array.isArray(bank.questions) ? bank.questions.length : 0,
    });
  }
  return result;
}

/**
 * 合并 `_general.json`。
 *
 * `library` **不是**简单选一边：它得如实反映合并之后的题库集合——两台设备
 * 各自导入的题库都要在列表里出现，被删掉的要消失。名字与顺序这类元数据
 * 才走「哪边改过听哪边」。
 */
/**
 * 两份 general 的「设置部分」是不是一样——**不看题库的增删**。
 *
 * 比的是：当前题库 / 全局设置 / 默认设置，题库列表里**两边都有**的那些条目的
 * 字段（改名、换模式、题数都算），以及这些条目之间的**相对顺序**（拖一下顺序
 * 也是改动，而且是最容易同步不过去的那种）。
 *
 * 只在一边出现的题库条目**不比**：那是「新增 / 删除」，由题库那两项在报；
 * 掺进来就会变成「导入一个题库」也顺带说「设置已更新」。
 */

export function sameSettings(a: GeneralSnapshot, b: GeneralSnapshot): boolean {
  if (
    stableHash([a.activeBank, a.defaultSettings, a.globalSettings]) !==
    stableHash([b.activeBank, b.defaultSettings, b.globalSettings])
  ) {
    return false;
  }

  const fingerprint = (snapshot: GeneralSnapshot): Map<string, string> => {
    const map = new Map<string, string>();
    for (const entry of snapshot.library) {
      const { hash, ...rest } = entry;
      map.set(hash, stableHash(rest));
    }
    return map;
  };

  const aMap = fingerprint(a);
  const bMap = fingerprint(b);
  const shared = new Set([...aMap.keys()].filter((hash) => bMap.has(hash)));
  for (const hash of shared) {
    if (aMap.get(hash) !== bMap.get(hash)) return false;
  }

  const sequence = (snapshot: GeneralSnapshot): string[] =>
    snapshot.library.map((entry) => entry.hash).filter((hash) => shared.has(hash));
  return sameList(sequence(a), sequence(b));
}

export function mergeGeneral(params: {
  local: GeneralSnapshot;
  remote: GeneralSnapshot | null;
  base: GeneralSnapshot | null;
  actions: readonly BankAction[];
  localBanks: ReadonlyMap<string, BankRecord>;
  remoteBanks: ReadonlyMap<string, RemoteBank>;
  localHasEdits: boolean;
}): GeneralSnapshot {
  const {
    local,
    remote,
    base,
    actions,
    localBanks,
    remoteBanks,
    localHasEdits,
  } = params;

  const remoteGeneral = remote ?? EMPTY_GENERAL;
  const alive = summarize(actions, localBanks, remoteBanks);

  const pick = <K extends "activeBank" | "defaultSettings" | "globalSettings">(
    key: K,
  ): GeneralSnapshot[K] => {
    if (base === null) {
      // 没有基准：本地是个空壳就听云端的，否则以本地为准
      // （换设备 / 清过缓存的新设备走这条，绝不能让空壳覆盖云端）
      return (localHasEdits ? local[key] : remoteGeneral[key]) as GeneralSnapshot[K];
    }
    const localChanged = !same(local[key], base[key]);
    const remoteChanged = !same(remoteGeneral[key], base[key]);
    if (localChanged && !remoteChanged) return local[key] as GeneralSnapshot[K];
    if (!localChanged && remoteChanged) return remoteGeneral[key] as GeneralSnapshot[K];
    // 两边都改过 / 都没改：本地优先（都没改时两边本来就一样）
    return local[key] as GeneralSnapshot[K];
  };

  const library = mergeLibrary({
    local: local.library,
    remote: remoteGeneral.library,
    base: base?.library ?? null,
    alive,
    localHasEdits,
  });

  // 激活题库：本地那个还在就用本地的，否则退到云端那个，都没有就置空
  const activeBank =
    local.activeBank !== null && alive.has(local.activeBank)
      ? local.activeBank
      : remoteGeneral.activeBank !== null && alive.has(remoteGeneral.activeBank)
        ? remoteGeneral.activeBank
        : null;

  return {
    activeBank,
    defaultSettings: pick("defaultSettings"),
    library,
    globalSettings: pick("globalSettings"),
  };
}

function mergeLibrary(params: {
  local: readonly LibraryEntry[];
  remote: readonly LibraryEntry[];
  base: readonly LibraryEntry[] | null;
  alive: ReadonlyMap<string, BankSummaryInput>;
  localHasEdits: boolean;
}): LibraryEntry[] {
  const { local, remote, base, alive, localHasEdits } = params;

  const index = (entries: readonly LibraryEntry[]): Map<string, LibraryEntry> => {
    const map = new Map<string, LibraryEntry>();
    for (const entry of entries) map.set(entry.hash, entry);
    return map;
  };
  const localMap = index(local);
  const remoteMap = index(remote);
  const baseMap = base === null ? null : index(base);

  const chosen = new Map<string, LibraryEntry>();
  for (const [hash, summary] of alive) {
    const l = localMap.get(hash);
    const r = remoteMap.get(hash);
    if (l && r) {
      if (baseMap === null) {
        chosen.set(hash, l);
      } else {
        const b = baseMap.get(hash);
        const localChanged = !same(l, b);
        const remoteChanged = !same(r, b);
        chosen.set(hash, !localChanged && remoteChanged ? r : l);
      }
    } else if (l) {
      chosen.set(hash, l);
    } else if (r) {
      chosen.set(hash, r);
    } else {
      chosen.set(hash, {
        hash,
        name: summary.name,
        mode: summary.mode,
        count: summary.count,
        addedAt: Date.now(),
      });
    }
  }

  // ── 顺序 ──
  //
  // 顺序也要三方合并，不能无脑用本地那份：否则「在 A 上把题库拖到最前面」
  // 永远传不到 B（两边条目内容一模一样，只有数组顺序变了）。
  // 判据是「谁动过顺序」——只按仍然存在的题库比较，删除题库不该被当成重排。
  const localOrder = orderOf(local, alive);
  const remoteOrder = orderOf(remote, alive);
  const baseOrder = base === null ? null : orderOf(base, alive);

  let order: string[];
  if (baseOrder === null) {
    // 没有基准：本地是个空壳（新设备）就听云端的顺序，否则以本地为准
    order = [...(localHasEdits ? localOrder : remoteOrder)];
  } else {
    const localReordered = !sameList(localOrder, baseOrder);
    const remoteReordered = !sameList(remoteOrder, baseOrder);
    // 只有云端动过顺序就跟着云端；两边都动过 / 都没动 → 本地优先
    order = [...(!localReordered && remoteReordered ? remoteOrder : localOrder)];
  }

  // 顺序里还没提到的（新合成的条目等）接在后面，按 hash 排
  const seen = new Set(order);
  for (const hash of [...alive.keys()].sort()) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    order.push(hash);
  }

  return order.map((hash) => chosen.get(hash) as LibraryEntry);
}

/** 题库列表里「还活着的那些」的顺序，用来判断谁动过排序。 */
function orderOf(
  entries: readonly LibraryEntry[],
  alive: ReadonlyMap<string, BankSummaryInput>,
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of entries) {
    if (!alive.has(entry.hash) || seen.has(entry.hash)) continue;
    seen.add(entry.hash);
    order.push(entry.hash);
  }
  return order;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 计划里有没有任何要做的事。 */
