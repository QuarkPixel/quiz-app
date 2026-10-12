/**
 * 「两个值一样吗」的**唯一**写法。
 *
 * 必须与键序无关：本地那份是内存对象、云端那份是解码出来的 JSON 文本，
 * 两者键序天然可能不同。以前有一处用 `JSON.stringify` 比，于是"其实一模一样"
 * 被判成"变了"——多写一次盘、多传一次分片，还会报成一次「合并进度」。
 */

import { canonicalJson } from "../hash";

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}
