/**
 * 进度导入/导出功能模块
 *
 * 编码流程（导出）：
 *   StoredState + 当前题库 → 紧凑数组格式 → JSON → deflate-raw 压缩 → Base64url
 *
 * 最终格式：{16字符hash}.{Base64url压缩数据}
 *
 * 紧凑格式说明：
 *   [version, questionCount, masteredBitmapHex, activePool[][], currentRound, filterTypeCode, settings[], ui[], masteredMistakesBitmapHex]
 *
 *   - 题目 id 按当前题库顺序映射为 index
 *   - masteredBitmapHex：BitSet 的十六进制字符串，bit=1 表示已掌握；
 *     活动池中的题目即使同时出现在 masteredIds 里也按 bit=0 导出
 *   - masteredMistakesBitmapHex：以 masteredBitmapHex 解码后的 masteredIds 顺序为 index，
 *     bit=1 表示该已掌握题目在掌握前曾答错
 *   - activePool 每项：[questionIndex, consecutiveCorrect, hasEverMistaken(0|1), lastSelectedRound, hasBeenShown(0|1)]
 *   - filterTypeCode：all=0, single=1, multiple=2, judgment=3, blank=4
 *   - settings：[
 *       autoNextOnCorrect(0|1),
 *       autoSubmitOnSelection(0|1),
 *       activePoolSize,
 *       correctStreakToMaster,
 *       correctStreakAfterMistake,
 *       selectionMode,
 *       soundEnabled(0|1),
 *       notifyNewQuestionInPool(0|1),
 *     ]
 */

import BitSet from "bitset";
import { SOUND_ENABLED_BY_DEFAULT } from "../config";
import type {
  ActivePoolItem,
  Question,
  QuestionType,
  StoredState,
  UiPreferences,
  UserSettings,
} from "../types";

// ── filterType 编解码 ──────────────────────────────────────────────────────────

const FORMAT_VERSION = 7;
const MIN_SUPPORTED_FORMAT_VERSION = 4;

const FILTER_TO_CODE: Record<string, number> = {
  all: 0,
  single: 1,
  multiple: 2,
  judgment: 3,
  blank: 4,
};

const CODE_TO_FILTER: Array<QuestionType | "all"> = [
  "all",
  "single",
  "multiple",
  "judgment",
  "blank",
];

function encodeSoundEnabled(settings: UserSettings): 0 | 1 {
  return settings.soundEnabled === true ? 1 : 0;
}

function decodeSoundEnabled(raw: unknown): boolean {
  if (raw === 1 || raw === true) return true;
  if (raw === 0 || raw === false) return false;
  return SOUND_ENABLED_BY_DEFAULT;
}

// ── 题目索引 / bitmap 编解码 ───────────────────────────────────────────────────

interface QuestionIndex {
  ids: string[];
  idToIndex: Map<string, number>;
}

function buildQuestionIndex(questions: readonly Question[]): QuestionIndex {
  const ids = questions.map((q) => q.id);
  const idToIndex = new Map<string, number>();

  ids.forEach((id, index) => {
    if (idToIndex.has(id)) {
      throw new Error(`题库结构无效：题目 id 重复：${id}`);
    }
    idToIndex.set(id, index);
  });

  return { ids, idToIndex };
}

function requireQuestionIndex(id: string, idToIndex: Map<string, number>): number {
  const index = idToIndex.get(id);
  if (index === undefined) {
    throw new Error(`导出失败：进度包含题库中不存在的题目 id：${id}`);
  }
  return index;
}

function getExportedMasteredIds(
  state: StoredState,
  questionIds: readonly string[],
  idToIndex: Map<string, number>,
): string[] {
  const activeIds = new Set(state.activePool.map((item) => item.id));
  const masteredSet = new Set<string>();

  for (const id of state.masteredIds) {
    if (activeIds.has(id)) continue;
    requireQuestionIndex(id, idToIndex);
    masteredSet.add(id);
  }

  return questionIds.filter((id) => masteredSet.has(id));
}

function encodeMasteredBitmap(
  masteredIds: readonly string[],
  idToIndex: Map<string, number>,
): string {
  const bitmap = new BitSet();

  for (const id of masteredIds) {
    bitmap.set(requireQuestionIndex(id, idToIndex), 1);
  }

  return bitmap.toString(16);
}

function decodeMasteredBitmap(
  raw: unknown,
  questionIds: readonly string[],
): string[] {
  if (typeof raw !== "string" || !/^[0-9a-f]+$/i.test(raw)) {
    throw new Error("数据格式无效：已掌握位图格式错误。");
  }

  const bitmap = BitSet.fromHexString(raw);
  const indexes = bitmap.toArray();

  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0 || index >= questionIds.length) {
      throw new Error("数据格式无效：已掌握位图索引越界。");
    }
  }

  return indexes.map((index) => questionIds[index]);
}

function encodeMasteredMistakesBitmap(
  state: StoredState,
  masteredIds: readonly string[],
): string {
  const bitmap = new BitSet();

  masteredIds.forEach((id, index) => {
    if (state.masteredMistakes?.[id] === true) {
      bitmap.set(index, 1);
    }
  });

  return bitmap.toString(16);
}

function decodeMasteredMistakesBitmap(
  raw: unknown,
  masteredIds: readonly string[],
): Record<string, boolean> {
  if (typeof raw !== "string" || !/^[0-9a-f]+$/i.test(raw)) {
    throw new Error("数据格式无效：已掌握错误位图格式错误。");
  }

  const bitmap = BitSet.fromHexString(raw);
  const result: Record<string, boolean> = {};

  for (const index of bitmap.toArray()) {
    if (!Number.isInteger(index) || index < 0 || index >= masteredIds.length) {
      throw new Error("数据格式无效：已掌握错误位图索引越界。");
    }
    result[masteredIds[index]] = true;
  }

  return result;
}

function encodeActivePool(
  activePool: readonly ActivePoolItem[],
  idToIndex: Map<string, number>,
): unknown[][] {
  return activePool.map((item) => [
    requireQuestionIndex(item.id, idToIndex),
    item.consecutiveCorrect,
    item.hasEverMistaken ? 1 : 0,
    item.lastSelectedRound,
    item.hasBeenShown ? 1 : 0,
  ]);
}

function decodeActivePool(
  raw: unknown,
  questionIds: readonly string[],
): ActivePoolItem[] {
  if (!Array.isArray(raw)) {
    throw new Error("数据格式无效：活动池格式错误。");
  }

  return raw.map((item) => {
    if (!Array.isArray(item) || item.length !== 5) {
      throw new Error("数据格式无效：活动池条目格式错误。");
    }

    const [
      questionIndex,
      consecutiveCorrect,
      hasEverMistaken,
      lastSelectedRound,
      hasBeenShown,
    ] = item;

    if (
      typeof questionIndex !== "number" ||
      !Number.isInteger(questionIndex) ||
      questionIndex < 0 ||
      questionIndex >= questionIds.length
    ) {
      throw new Error("数据格式无效：活动池题目索引错误。");
    }

    return {
      id: questionIds[questionIndex],
      consecutiveCorrect: consecutiveCorrect as number,
      hasEverMistaken: hasEverMistaken === 1,
      hasBeenShown: hasBeenShown === 1,
      lastSelectedRound: lastSelectedRound as number,
    };
  });
}

// ── deflate-raw 压缩/解压（Web Streams API） ───────────────────────────────────

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ── Base64url（不含 padding）────────────────────────────────────────────────────

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64url(str: string): Uint8Array {
  // 还原 padding
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(pad);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

/**
 * 将学习进度导出为紧凑编码字符串（异步，因为压缩是异步的）
 * 返回格式：{16字符hash}.{Base64url压缩数据}
 */
export async function exportProgress(
  state: StoredState,
  hash: string,
  questions: readonly Question[],
): Promise<string> {
  const { ids, idToIndex } = buildQuestionIndex(questions);
  const filterCode = FILTER_TO_CODE[state.filterType] ?? 0;
  const exportedMasteredIds = getExportedMasteredIds(state, ids, idToIndex);

  const compact: unknown[] = [
    FORMAT_VERSION,
    ids.length,
    encodeMasteredBitmap(exportedMasteredIds, idToIndex),
    encodeActivePool(state.activePool, idToIndex),
    state.currentRound,
    filterCode,
    [
      state.settings.autoNextOnCorrect ? 1 : 0,
      state.settings.autoSubmitOnSelection ? 1 : 0,
      state.settings.activePoolSize,
      state.settings.correctStreakToMaster,
      state.settings.correctStreakAfterMistake,
      state.settings.selectionMode,
      encodeSoundEnabled(state.settings),
      state.settings.notifyNewQuestionInPool ? 1 : 0,
    ],
    [
      state.ui.progressFocused ? 1 : 0,
      state.ui.showPool ? 1 : 0,
    ],
    encodeMasteredMistakesBitmap(state, exportedMasteredIds),
  ];

  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json) as Uint8Array<ArrayBuffer>;
  const compressed = await deflateRaw(bytes);
  const encoded = toBase64url(compressed);

  return `${hash}.${encoded}`;
}

/**
 * 从编码字符串导入学习进度（异步）
 * 成功返回 StoredState，失败抛出 Error（message 为中文，可直接展示给用户）
 */
export async function importProgress(
  encoded: string,
  hash: string,
  questions: readonly Question[],
): Promise<StoredState> {
  const { ids } = buildQuestionIndex(questions);
  const dotIndex = encoded.indexOf(".");
  if (dotIndex === -1) {
    throw new Error("格式无效：找不到版本分隔符，请检查导入内容是否完整。");
  }

  const importedHash = encoded.slice(0, dotIndex);
  const base64urlPart = encoded.slice(dotIndex + 1);

  // 校验题库版本
  if (importedHash !== hash) {
    throw new Error(
      `题库版本不匹配，无法导入。\n当前版本：${hash}\n导入版本：${importedHash}\n请使用相同题库导出的进度数据。`,
    );
  }

  // Base64url 解码
  let compressed: Uint8Array<ArrayBuffer>;
  try {
    compressed = fromBase64url(base64urlPart) as Uint8Array<ArrayBuffer>;
  } catch {
    throw new Error("Base64 解码失败，导入内容可能已损坏或不完整。");
  }

  // deflate-raw 解压
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await inflateRaw(compressed);
  } catch {
    throw new Error("解压失败，导入内容可能已损坏。");
  }

  // JSON 解析
  let compact: unknown;
  try {
    const json = new TextDecoder().decode(bytes);
    compact = JSON.parse(json);
  } catch {
    throw new Error("数据解析失败，导入内容可能已损坏。");
  }

  // 结构校验
  if (!Array.isArray(compact) || ![8, 9].includes(compact.length)) {
    throw new Error("数据格式无效：结构不符合预期。");
  }

  const [
    version,
    questionCount,
    masteredBitmapRaw,
    activeRaw,
    currentRound,
    filterCode,
    settingsRaw,
    uiRaw,
    masteredMistakesRaw,
  ] = compact as unknown[];

  if (
    typeof version !== "number" ||
    version < MIN_SUPPORTED_FORMAT_VERSION ||
    version > FORMAT_VERSION
  ) {
    throw new Error("数据格式无效：进度格式版本不支持。");
  }
  if (version >= 5 && compact.length !== 9) {
    throw new Error("数据格式无效：结构不符合预期。");
  }
  if (version === MIN_SUPPORTED_FORMAT_VERSION && compact.length !== 8) {
    throw new Error("数据格式无效：结构不符合预期。");
  }
  if (questionCount !== ids.length) {
    throw new Error("数据格式无效：题目数量不匹配。");
  }
  if (!Array.isArray(settingsRaw) || settingsRaw.length < 5) {
    throw new Error("数据格式无效：设置格式错误。");
  }
  if (!Array.isArray(uiRaw) || uiRaw.length < 2) {
    throw new Error("数据格式无效：UI 偏好格式错误。");
  }

  // 还原数据
  const activePoolSize = (settingsRaw[version >= 6 ? 2 : 1] as number);
  const masteredIds = decodeMasteredBitmap(masteredBitmapRaw, ids);
  const masteredMistakes =
    version >= 5
      ? decodeMasteredMistakesBitmap(masteredMistakesRaw, masteredIds)
      : {};
  const activePool = decodeActivePool(activeRaw, ids);

  const filterType: QuestionType | "all" =
    CODE_TO_FILTER[filterCode as number] ?? "all";

  const settings: UserSettings = {
    autoNextOnCorrect: settingsRaw[0] === 1,
    autoSubmitOnSelection: version >= 6 ? settingsRaw[1] !== 0 : true,
    activePoolSize: version >= 6 ? (settingsRaw[2] as number) : activePoolSize,
    correctStreakToMaster: (settingsRaw[version >= 6 ? 3 : 2] as number),
    correctStreakAfterMistake: (settingsRaw[version >= 6 ? 4 : 3] as number),
    selectionMode:
      settingsRaw[version >= 6 ? 5 : 4] === "sequential"
        ? "sequential"
        : "random",
    notifyNewQuestionInPool: version >= 7 ? settingsRaw[7] === 1 : false,
    soundEnabled: decodeSoundEnabled(settingsRaw[version >= 6 ? 6 : 5]),
  };

  const ui: UiPreferences = {
    progressFocused: uiRaw[0] === 1,
    showPool: uiRaw[1] === 1,
  };

  return {
    masteredIds,
    masteredMistakes,
    activePool,
    currentRound: currentRound as number,
    filterType,
    settings,
    ui,
  };
}
