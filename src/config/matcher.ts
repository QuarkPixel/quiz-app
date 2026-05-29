/**
 * 英语习题中常见的占位词（规范化为纯字母序列）。
 * 这些词用户不输入也算正确（视为可选 Group 节点）。
 *
 * 原始形式 → 规范化：
 *   sb       → sb
 *   sth      → sth
 *   sb's     → sbs
 *   one's / ones → ones
 *   oneself  → oneself
 *   doing    → doing
 *   to do    → todo
 */
export const PLACEHOLDER_WORDS: readonly string[] = [
  "sb",
  "sth",
  "sp",
  "sbs", // sb's
  "ones", // one's / ones
  "oneself",
  "doing",
  "todo", // to do（连在一起的字母序列）
];

/**
 * 填空题答错时，输入与正确答案的相似度达到该阈值才在输入框内展示逐字符 diff。
 * 低于阈值视为「基本写错」，diff 会满屏标红、没有参考价值，故不展示。
 * 相似度量纲见 lib/textDiff.ts 的 similarityRatio（2·LCS/(|a|+|b|)）。
 */
export const BLANK_DIFF_SIMILARITY_THRESHOLD = 0.8;
