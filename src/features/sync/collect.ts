/**
 * 把 localStorage 里的键收集成「云端文件会长的样子」。
 *
 * 映射关系（分片方案，见 `types.ts` 的说明）：
 *
 *   quiz_app_general        →  _general.json    { activeBank, defaultSettings, library, globalSettings }
 *   quiz_app_questions_<h>  ┐
 *                           ├→  banks-N.json    { banks: { <h>: {mode, name, questions, state}, … } }
 *   quiz_app_state_<h>      ┘                   （N = shardIndexOf(<h>)，固定 9 片）
 *
 * 题库文件里把「题目」和「进度」放一起，是因为它们本来就同生共死：
 * 拉一份题库就要连进度一起拉。
 *
 * **收集出来的是「题库」而不是「文件」**：分片只是容器，合并 / 冲突 / 删除
 * 全部按题库逐条判定。`collectLocalFiles` 只是把题库装进分片后的结果，
 * 供「本地一共多大」这类展示与兼容旧测试使用。
 */

import {
  STORAGE_KEY_GENERAL,
  STORAGE_PREFIX_QUESTIONS,
  STORAGE_PREFIX_STATE,
} from "@/config";
import { readLocal } from "./storage";
import {
  GIST_GENERAL_FILE,
  SHARD_COUNT,
  normalizeGeneralSnapshot,
  shardFileName,
  shardIndexOf,
  type BankSnapshot,
  type GeneralSnapshot,
  type ShardSnapshot,
} from "./types";

export interface LocalFile {
  /** Gist 里的文件名 */
  name: string;
  /** 该文件的本地修改时间（毫秒），取自它涵盖的那些键里最晚的一个；没有就是 0 */
  localAt: number;
  /** 组装好的快照 */
  snapshot: unknown;
  /**
   * 内容哈希。用于「和云端那份是不是一样」的判定——
   * 光看 mtime 会把「应用启动时顺手规范化了 general 配置」误判成用户改动。
   */
  hash: string;
  /**
   * 这份算不算「用户真的动过」。
   *
   * 不能只看 mtime：应用一启动就会写一次 general 配置（规范化 / 旧版迁移），
   * 新设备上那就是个空壳——没有题库、没有激活题库。把这种当成「本地改动」，
   * 首次同步就会拿空数据去覆盖云端（线上真出过：新设备把云端的题库列表清空了）。
   */
  hasLocalEdits: boolean;
}

/** 本地的一个题库。 */
export interface BankRecord {
  /** 题库 hash（= 题目数组的 SHA-1 前 16 位，也是存储键后缀） */
  hash: string;
  /** 它落在哪个分片（`shardIndexOf(hash)`） */
  shard: number;
  /**
   * 题库**内容**的哈希：题目 + 进度 + 模式，**不含题库名**。
   *
   * 名字存在 `_general.json` 的题库列表里，是另一份文件的事；把它算进内容哈希
   * 会让「改个名」变成「题库内容变了」，平白多出一堆冲突。
   */
  contentHash: string;
  /** 本地最后改动时间（题目键 / 进度键里最晚的那个） */
  localAt: number;
  snapshot: BankSnapshot;
}

/** 一次收集的结果：general + 逐题库。 */
export interface CollectedState {
  general: GeneralSnapshot;
  generalHash: string;
  generalLocalAt: number;
  /** general 里有没有真东西（有题库或有激活题库）；空壳不算「本地改过」 */
  generalHasEdits: boolean;
  banks: Map<string, BankRecord>;
}

/**
 * 稳定哈希：同样内容得同样结果，且不受对象键序影响。
 *
 * 不要求密码学强度（这里的用途只是「两边是不是同一份」），但必须**确定性**：
 * 云端那份是解码出来的 JSON 文本，本地这份是内存对象，两者键序天然不同，
 * 所以先递归排序键名再算。
 */
export function stableHash(value: unknown): string {
  const canonical = canonicalJson(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i += 1) {
    const c = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

interface BankSummaryLike {
  hash?: unknown;
  name?: unknown;
  mode?: unknown;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * 题库内容的哈希。
 *
 * `state` 用 `?? null` 归一：本地没有进度时字段是 undefined（`JSON.stringify`
 * 会把它丢掉），云端解出来则是缺字段——两边必须映射到同一个值，
 * 否则「其实一模一样」会被判成「内容不同」。
 */
export function bankContentHash(snapshot: BankSnapshot): string {
  return stableHash({
    mode: snapshot.mode,
    questions: snapshot.questions,
    state: snapshot.state ?? null,
  });
}

/** 从 general 配置里取出题库名 / 模式，供分片文件冗余记录。 */
function libraryIndex(
  general: GeneralSnapshot,
): Map<string, BankSummaryLike> {
  const map = new Map<string, BankSummaryLike>();
  for (const item of general.library) {
    if (item === null || typeof item !== "object") continue;
    const record = item as BankSummaryLike;
    if (typeof record.hash === "string") map.set(record.hash, record);
  }
  return map;
}

/** 列出 localStorage 里以某前缀开头的所有键。 */
function listKeysWithPrefix(prefix: string): string[] {
  const result: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(prefix)) result.push(key);
    }
  } catch (e) {
    console.warn("Failed to enumerate localStorage:", e);
  }
  return result;
}

/** 把任意来源的 general 值净化为 `GeneralSnapshot`。 */
export const normalizeGeneral = normalizeGeneralSnapshot;

/**
 * 收集当前 localStorage 里的全部可同步内容。
 *
 * 需要 `localAtOf` 是因为「本地修改时间」记在 `quiz_app_sync_mtime:<键>` 里，
 * 那是 storage.ts 的职责；这里只负责组装。
 */
export function collectLocalState(
  localAtOf: (storageKey: string) => number,
): CollectedState {
  const generalKey = STORAGE_KEY_GENERAL;
  const general = normalizeGeneral(parseJson(readLocal(generalKey)));

  const names = libraryIndex(general);
  const questionKeys = listKeysWithPrefix(STORAGE_PREFIX_QUESTIONS);
  const stateKeys = listKeysWithPrefix(STORAGE_PREFIX_STATE);

  const hashes = new Set<string>();
  for (const key of questionKeys) {
    hashes.add(key.slice(STORAGE_PREFIX_QUESTIONS.length));
  }
  for (const key of stateKeys) {
    hashes.add(key.slice(STORAGE_PREFIX_STATE.length));
  }

  const banks = new Map<string, BankRecord>();
  for (const hash of hashes) {
    const questionsKey = STORAGE_PREFIX_QUESTIONS + hash;
    const stateKey = STORAGE_PREFIX_STATE + hash;

    const questions = parseJson(readLocal(questionsKey));
    // 没有题目数组就没有这个题库：进度单独留着没有意义，跳过
    if (!Array.isArray(questions)) continue;

    const summary = names.get(hash);
    const state = parseJson(readLocal(stateKey));
    const snapshot: BankSnapshot = {
      mode: summary?.mode === "memory" ? "memory" : "quiz",
      name:
        typeof summary?.name === "string" && summary.name.length > 0
          ? summary.name
          : "未命名题库",
      questions,
      ...(state === undefined ? {} : { state }),
    };

    banks.set(hash, {
      hash,
      shard: shardIndexOf(hash),
      contentHash: bankContentHash(snapshot),
      // 题库的「本地改动时间」取题目键与进度键里最晚的那个：
      // 导入（换题目）和刷题（改进度）都算这个题库变了。
      localAt: Math.max(localAtOf(questionsKey), localAtOf(stateKey)),
      snapshot,
    });
  }

  return {
    general,
    generalHash: stableHash(general),
    generalLocalAt: localAtOf(generalKey),
    // 只有「空壳」才算没动过：题库列表为空且没有激活题库
    generalHasEdits: general.library.length > 0 || general.activeBank !== null,
    banks,
  };
}

/** 把一批题库装成一个分片文件的快照。 */
export function buildShardSnapshot(
  banks: Iterable<BankRecord>,
): ShardSnapshot {
  const bucket: Record<string, BankSnapshot> = {};
  for (const bank of banks) bucket[bank.hash] = bank.snapshot;
  return { banks: bucket };
}

/**
 * 把一份收集结果装成「云端文件会长的样子」。
 *
 * **空分片不会凭空生成**：某片一个题库都没有时就没有这个文件，
 * 这样新设备拉取时不会创建空文件，删掉最后一个题库也会让云端那一份消失。
 */
export function filesOfState(state: CollectedState): LocalFile[] {
  const files: LocalFile[] = [
    {
      name: GIST_GENERAL_FILE,
      localAt: state.generalLocalAt,
      snapshot: state.general,
      hash: state.generalHash,
      hasLocalEdits: state.generalHasEdits,
    },
  ];

  const buckets: BankRecord[][] = Array.from(
    { length: SHARD_COUNT },
    () => [],
  );
  const bucketMtime: number[] = Array.from({ length: SHARD_COUNT }, () => 0);
  for (const bank of state.banks.values()) {
    buckets[bank.shard].push(bank);
    bucketMtime[bank.shard] = Math.max(bucketMtime[bank.shard], bank.localAt);
  }

  for (let index = 0; index < SHARD_COUNT; index += 1) {
    if (buckets[index].length === 0) continue;
    const snapshot = buildShardSnapshot(buckets[index]);
    files.push({
      name: shardFileName(index),
      localAt: bucketMtime[index],
      snapshot,
      hash: stableHash(snapshot),
      // 分片里的每个题库都带着至少一道题（没题目的会被跳过），所以存在即「动过」
      hasLocalEdits: true,
    });
  }

  return files;
}

/**
 * 收集所有要同步的文件（题库装进分片之后的样子）。
 */
export function collectLocalFiles(
  localAtOf: (storageKey: string) => number,
): LocalFile[] {
  return filesOfState(collectLocalState(localAtOf));
}
