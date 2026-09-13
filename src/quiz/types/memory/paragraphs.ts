/**
 * 记忆题目的答案排版。
 *
 * 约定：`answer` 里用一个换行符（`\n`）分段，渲染时按段落展示并留出段间距。
 * 这里做两件事：
 *   - 把行尾的 `\r` 和行首尾多余空格清掉
 *   - 连续空行合并成一个段落分隔，避免出现空段落
 */
export function splitAnswerParagraphs(answer: string): string[] {
  return answer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
