/**
 * textDiff.ts
 *
 * 通用逐字符 diff 与相似度，基于最长公共子序列（LCS）。纯字符串算法，
 * 不含任何题库/答案领域知识。题型层（如填空题的 diff 展示）在此之上组合。
 */

export type DiffOpType = "equal" | "delete" | "insert";

/** 一段连续的同类差异。delete=仅 from 有；insert=仅 to 有。 */
export interface DiffOp {
  type: DiffOpType;
  text: string;
}

/**
 * 把 `from` 对齐到 `to` 的逐字符 diff（基于 LCS）。
 *   equal  —— 两边都有的字符
 *   delete —— 仅 `from` 有（相对 `to` 多出来的）
 *   insert —— 仅 `to` 有（相对 `from` 缺失的）
 * 连续同类字符合并成一个 DiffOp。
 */
export function diffChars(from: string, to: string): DiffOp[] {
  const n = from.length;
  const m = to.length;

  // dp[i][j] = LCS(from[i..], to[j..])，多留一行一列哨兵 0。
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        from[i] === to[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  const push = (type: DiffOpType, ch: string): void => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += ch;
    else ops.push({ type, text: ch });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (from[i] === to[j]) {
      push("equal", from[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("delete", from[i]);
      i++;
    } else {
      push("insert", to[j]);
      j++;
    }
  }
  while (i < n) push("delete", from[i++]);
  while (j < m) push("insert", to[j++]);
  return ops;
}

/**
 * 相似度比值，∈ [0, 1]。采用 2·LCS / (|a| + |b|)（Sørensen–Dice 形式，
 * 与 Python difflib SequenceMatcher.ratio 同量纲）。两个空串视为完全相同。
 */
export function similarityRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  let lcs = 0;
  for (const op of diffChars(a, b)) {
    if (op.type === "equal") lcs += op.text.length;
  }
  return (2 * lcs) / (a.length + b.length);
}
