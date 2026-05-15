/**
 * 进度导入/导出功能模块
 *
 * 编码流程（导出）：
 *   StoredState → 紧凑数组格式 → JSON → deflate-raw 压缩 → Base64url
 *
 * 最终格式：{16字符hash}.{Base64url压缩数据}
 *
 * 紧凑格式说明：
 *   [masteredIds[], activePool[][], currentRound, filterTypeCode, settings[]]
 *
 *   - id 编码：'single_3' → 's3', 'multiple_12' → 'm12',
 *              'judgment_5' → 'j5', 'blank_2' → 'b2'
 *   - 若 id 不符合上述规则（自定义 id），编码时在前面加 '^' 前缀原样存储，
 *     例如 'hardest' → '^hardest'，'b11' → '^b11'（避免与 'blank_11' 编码后的 'b11' 混淆）
 *   - '^' 是保留字符，题目 id 不可以以 '^' 开头
 *   - activePool 每项：[encodedId, consecutiveCorrect, hasEverMistaken(0|1), lastSelectedRound]
 *   - filterTypeCode：all=0, single=1, multiple=2, judgment=3, blank=4
 *   - settings：[autoNextOnCorrect(0|1), activePoolSize, correctStreakToMaster, correctStreakAfterMistake]
 */

import type { StoredState, ActivePoolItem, QuestionType, UserSettings } from "../types";

// 由 vite.config.ts 在编译期注入的题库哈希常量
declare const __QUESTIONS_HASH__: string;

// ── ID 编解码 ─────────────────────────────────────────────────────────────────

const TYPE_TO_PREFIX: Record<string, string> = {
  single: "s",
  multiple: "m",
  judgment: "j",
  blank: "b",
};

const PREFIX_TO_TYPE: Record<string, QuestionType> = {
  s: "single",
  m: "multiple",
  j: "judgment",
  b: "blank",
};

/**
 * 编码规则：
 *   - 已知类型（single/multiple/judgment/blank）且数字部分为纯数字：压缩为单字母前缀
 *     e.g. 'single_3' → 's3'
 *   - 其他所有情况（自定义 id、未知类型等）：原样存储并加 '^' 前缀
 *     e.g. 'hardest' → '^hardest'，'b11' → '^b11'
 */
function encodeId(id: string): string {
  const underscore = id.indexOf("_");
  if (underscore !== -1) {
    const type = id.slice(0, underscore);
    const num = id.slice(underscore + 1);
    const prefix = TYPE_TO_PREFIX[type];
    // 只有已知类型且数字部分为纯数字时才压缩，避免解码歧义
    if (prefix !== undefined && /^\d+$/.test(num)) {
      return prefix + num;
    }
  }
  // 其余情况：原样保留，加 '^' 标记
  return "^" + id;
}

/**
 * 解码规则：
 *   - '^' 开头：去掉前缀，原样还原
 *   - 已知单字母前缀 + 纯数字：还原为 type_num 格式
 *   - 其他（理论上不会出现）：原样返回
 */
function decodeId(encoded: string): string {
  if (encoded[0] === "^") {
    return encoded.slice(1);
  }
  const prefix = encoded[0];
  const rest = encoded.slice(1);
  const type = PREFIX_TO_TYPE[prefix];
  if (type !== undefined && /^\d+$/.test(rest)) {
    return type + "_" + rest;
  }
  // 兜底：原样返回（不应走到这里）
  return encoded;
}

// ── filterType 编解码 ──────────────────────────────────────────────────────────

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
export async function exportProgress(state: StoredState): Promise<string> {
  const filterCode = FILTER_TO_CODE[state.filterType] ?? 0;

  const compact: unknown[] = [
    state.masteredIds.map(encodeId),
    state.activePool.map((item: ActivePoolItem) => [
      encodeId(item.id),
      item.consecutiveCorrect,
      item.hasEverMistaken ? 1 : 0,
      item.lastSelectedRound,
    ]),
    state.currentRound,
    filterCode,
    [
      state.settings.autoNextOnCorrect ? 1 : 0,
      state.settings.activePoolSize,
      state.settings.correctStreakToMaster,
      state.settings.correctStreakAfterMistake,
    ],
  ];

  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json) as Uint8Array<ArrayBuffer>;
  const compressed = await deflateRaw(bytes);
  const encoded = toBase64url(compressed);

  return `${__QUESTIONS_HASH__}.${encoded}`;
}

/**
 * 从编码字符串导入学习进度（异步）
 * 成功返回 StoredState，失败抛出 Error（message 为中文，可直接展示给用户）
 */
export async function importProgress(encoded: string): Promise<StoredState> {
  const dotIndex = encoded.indexOf(".");
  if (dotIndex === -1) {
    throw new Error("格式无效：找不到版本分隔符，请检查导入内容是否完整。");
  }

  const importedHash = encoded.slice(0, dotIndex);
  const base64urlPart = encoded.slice(dotIndex + 1);

  // 校验题库版本
  if (importedHash !== __QUESTIONS_HASH__) {
    throw new Error(
      `题库版本不匹配，无法导入。\n当前版本：${__QUESTIONS_HASH__}\n导入版本：${importedHash}\n请使用相同题库导出的进度数据。`,
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
  if (!Array.isArray(compact) || compact.length < 5) {
    throw new Error("数据格式无效：结构不符合预期。");
  }

  const [masteredRaw, activeRaw, currentRound, filterCode, settingsRaw] =
    compact as unknown[];

  if (!Array.isArray(masteredRaw)) {
    throw new Error("数据格式无效：已掌握列表格式错误。");
  }
  if (!Array.isArray(activeRaw)) {
    throw new Error("数据格式无效：活动池格式错误。");
  }
  if (!Array.isArray(settingsRaw) || settingsRaw.length < 4) {
    throw new Error("数据格式无效：设置格式错误。");
  }

  // 还原数据
  const masteredIds: string[] = (masteredRaw as string[]).map(decodeId);

  const activePool: ActivePoolItem[] = (activeRaw as unknown[][]).map((item) => {
    if (!Array.isArray(item) || item.length < 4) {
      throw new Error("数据格式无效：活动池条目格式错误。");
    }
    return {
      id: decodeId(item[0] as string),
      consecutiveCorrect: item[1] as number,
      hasEverMistaken: item[2] === 1,
      lastSelectedRound: item[3] as number,
    };
  });

  const filterType: QuestionType | "all" =
    CODE_TO_FILTER[filterCode as number] ?? "all";

  const settings: UserSettings = {
    autoNextOnCorrect: settingsRaw[0] === 1,
    activePoolSize: settingsRaw[1] as number,
    correctStreakToMaster: settingsRaw[2] as number,
    correctStreakAfterMistake: settingsRaw[3] as number,
  };

  return {
    masteredIds,
    activePool,
    currentRound: currentRound as number,
    filterType,
    settings,
  };
}