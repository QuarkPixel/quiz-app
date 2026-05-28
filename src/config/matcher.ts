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
