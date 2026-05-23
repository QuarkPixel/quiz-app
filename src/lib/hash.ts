/**
 * 题库哈希：SHA-1 hex 前 16 字符。
 *
 * 全链路统一规则：调用方先把题库 parse 再 JSON.stringify 拿到规范化（minified）
 * 字符串再传入。bundled / library / 导出回灌 都走这条路径，避免空白差异导致
 * hash 漂。
 *
 * Node 端构建时由 vite.config.ts 用 node:crypto 计算；浏览器端 library 模式下
 * 用 Web Crypto 计算。同一份 canonical JSON 两边结果一致。
 */
export async function hashQuestionsJson(canonicalJson: string): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson);
  const buf = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
