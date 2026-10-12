/**
 * 规范化的 JSON 与稳定哈希。
 *
 * 放在这个叶子模块里是因为**三处都要用**：收集（算哈希）、合并（比"一样不一样"）、
 * 卡片排序（兜底裁决）。以前它长在 `collect.ts` 里，导致「合并」反过来依赖「收集」。
 *
 * **键序无关**是有意的：本地那份是内存对象、云端那份是解码出来的 JSON 文本，
 * 两者键序天然可能不同（`JSON.stringify` 比的是插入顺序，用它比会把"其实一模一样"
 * 判成"变了"）。
 */

/** 递归排序键名后的 JSON 文本；相等的值一定得到相等的字符串。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/**
 * 键序无关的稳定哈希（16 个十六进制字符）。
 *
 * 只用来判「一样不一样」，**不用来做排序**——哈希有碰撞，碰撞会让两个不同的值
 * 比成相等，破坏全序。要排序用 `canonicalJson` 直接比字符串。
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
