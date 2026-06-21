import type { Question } from "@/types";
import { QUESTION_TYPES_LOGIC } from "@/quiz/types/registry-logic";
import type { ShuffledOption } from "@/quiz/types/types";

/** 全角括号/斜杠转半角 */
function normalizeSymbols(value: string): string {
  return value
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/／/g, "/");
}

/** 规范化用户输入：只保留字母，统一小写 */
export function normalizeBlankAnswer(value: string): string {
  return normalizeSymbols(value).trim().toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * 把答案字符串解析成所有合法的规范化字符串集合。
 *
 * 解析规则：
 *   - 斜杠 / ：括号外的斜杠把整个字符串切分成多个分支，每个分支是完整的候选答案
 *   - 括号 (xxx) ：括号内容可选，如果括号内含斜杠则把括号内的各选项展开后与括号外前后文拼接
 *
 * 示例：
 *   "fall ill/sick"        → {"fallill", "sick"}
 *   "on (an) average"      → {"onanaverage", "onaverage"}
 *   "on (an/the) average"  → {"onanaverage", "ontheaverage", "onaverage"}
 *   "be/get used to"       → {"be", "getusedto"}   — 斜杠切整句，这是预期行为
 *   "(be) used to"         → {"beusedto", "usedto"}
 */
export function buildAnswerSet(answer: string): Set<string> {
  const result = new Set<string>();

  function collect(s: string): void {
    // 1. 按括号外斜杠切分成分支
    const branches = splitOnOuterSlash(s);
    for (const branch of branches) {
      // 2. 对每个分支展开括号（括号内的斜杠也会被展开为带前后文的字符串）
      for (const expanded of expandParens(branch)) {
        if (expanded.includes("/")) {
          // 括号内的斜杠被展开后带出了前后文，需要再切一次
          collect(expanded);
        } else {
          result.add(normalizeBlankAnswer(expanded));
        }
      }
    }
  }

  collect(normalizeSymbols(answer));
  result.delete("");
  return result;
}

/**
 * 按「括号外的斜杠」切分字符串。
 * 括号内的斜杠不参与切分。
 */
function splitOnOuterSlash(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth = Math.max(0, depth - 1);
    else if (s[i] === "/" && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/**
 * 展开一个字符串中所有最外层括号块，枚举内容存在/不存在的所有组合。
 * 括号内含斜杠时，把括号内的各选项分别与括号外前后文拼接生成多个完整字符串。
 * 返回的字符串列表中不包含任何括号，但可能包含斜杠（括号内的斜杠展开后没有括号了）。
 */
function expandParens(s: string): string[] {
  // 找所有最外层的 (xxx) 块
  const blocks: Array<{ start: number; end: number; inner: string }> = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "(") {
      let depth = 1;
      const start = i;
      i++;
      while (i < s.length && depth > 0) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") depth--;
        i++;
      }
      blocks.push({ start, end: i, inner: s.slice(start + 1, i - 1) });
    } else {
      i++;
    }
  }

  if (blocks.length === 0) return [s];

  // 逐个处理每个括号块，每次将当前结果集合与下一个块展开
  let current: string[] = [s];

  // 从后往前处理，避免索引漂移
  for (let j = blocks.length - 1; j >= 0; j--) {
    const { start, end, inner } = blocks[j];
    const next: string[] = [];

    for (const str of current) {
      // 属于当前 str 的括号块属于相同位置（start/end 对应原始 s的索引，
      // 但我们是从后往前处理，所以 start/end 对 current 中的每个 str 依然有效）
      const prefix = str.slice(0, start);
      const suffix = str.slice(end);

      // 选项 1：删除整个括号块
      next.push(prefix + suffix);

      // 选项 2+：括号内如果含斜杠，展开为多个子选项；否则直接保留
      const innerOptions = inner.includes("/") ? inner.split("/") : [inner];
      for (const opt of innerOptions) {
        next.push(prefix + opt + suffix);
      }
    }

    current = next;
  }

  return [...new Set(current)];
}

export function canSubmitCurrentAnswer(
  question: Question | null,
  _selectedAnswers: number[],
  _blankAnswerInputs: string[],
): boolean {
  return question !== null;
}

export function evaluateAnswer(
  question: Question,
  selectedAnswers: number[],
  blankAnswerInputs: string[],
): boolean {
  return QUESTION_TYPES_LOGIC[question.type].evaluateAnswer(
    question,
    selectedAnswers,
    blankAnswerInputs,
  );
}

export function getCorrectChoiceLetters(
  question: Question,
  shuffledOptions: ShuffledOption[],
): string {
  return QUESTION_TYPES_LOGIC[question.type].getCorrectChoiceLetters(
    question,
    shuffledOptions,
  );
}
