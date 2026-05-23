/**
 * 题库哈希：SHA-1 hex 前 16 字符。
 *
 * Node 端构建时由 vite.config.ts 用 node:crypto 计算；浏览器端 library 模式下
 * 用 Web Crypto 计算。同一份 JSON 串两边结果一致，bundled / library 的进度可
 * 互通（同 hash → 同 storage key）。
 */
export async function hashQuestionsJson(json: string): Promise<string> {
  const data = new TextEncoder().encode(json);
  const buf = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
