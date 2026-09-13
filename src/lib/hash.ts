/**
 * 题库哈希：SHA-1 hex 前 16 字符。
 *
 * 全链路统一规则：调用方先把题库 parse 再 JSON.stringify 拿到规范化（minified）
 * 字符串再传入，避免空白差异导致 hash 漂。
 *
 * hash 只覆盖 questions 数组（不含 mode / state），所以题库文件的 mode / 进度
 * 变化不会改变题库身份；历史上导入过的题库 hash 也能继续对上。
 *
 * 浏览器端用 Web Crypto 计算。同一份 canonical JSON 结果稳定。
 */
export async function hashQuestionsJson(canonicalJson: string): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson);
  const buf = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
