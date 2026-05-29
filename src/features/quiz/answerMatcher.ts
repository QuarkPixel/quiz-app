/**
 * answerMatcher.ts
 *
 * 轻量递归下降匹配器，用于判断用户输入是否符合带歧义语法的答案串。
 *
 * 支持的答案语法：
 *   - 普通文本          原样匹配（忽略大小写、空格、标点）
 *   - A/B/C            外层斜杠：整句级分支，选一即可
 *   - (A/B/C)          括号内斜杠：词/短语级分支，选一即可
 *   - (xxx)            括号内容可选（整体可省略）
 *   - 全角括号/斜杠     自动转半角
 *
 * 匹配语义：
 *   外层斜杠 → 不回溯已消耗的输入（整句选一）
 *   括号内斜杠 → 回溯到括号起点再试下一选项（词级选一）
 *   括号整体 → 可跳过（相当于隐含一个空分支）
 *
 * 示例：
 *   "fall ill/sick"       匹配 "fall ill" ✓  "fall sick" ✓  "sick" ✓
 *   "on (an/the) average" 匹配 "on an average" ✓  "on the average" ✓  "on average" ✓
 *   "on (an) average"     匹配 "on an average" ✓  "on average" ✓
 *   "(be/get) used to"    匹配 "be used to" ✓  "get used to" ✓
 */

import { PLACEHOLDER_WORDS } from "../../config";

// ---------------------------------------------------------------------------
// 规范化
// ---------------------------------------------------------------------------

function normalizeSymbols(s: string): string {
  // apostrophe 直接删除：让 one's → ones、sb's → sbs，使 parseWord 能将其识别为
  // 单个占位词（见 PLACEHOLDER_WORDS）。否则 ' 会把一个词切成两个 Literal token。
  return s
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/／/g, "/")
    .replace(/['‘’]/g, "");
}

const LITERAL_CHAR = /[a-zA-Z0-9\u4e00-\u9fff]/;
/** \u89c4\u8303\u5316\u540e\u7528\u4e8e\u5207\u8bcd\u7684\u8fde\u7eed\u5b57\u6bcd\u5e8f\u5217\uff08\u5168\u5c40\uff0c\u914d\u5408 String.match\uff09 */
const LITERAL_WORD = /[a-z0-9\u4e00-\u9fff]+/g;

/** 规范化后的一个字母及其在原串中的下标 */
export interface LetterPos {
  norm: string; // 小写字母 / 数字
  index: number; // 在原始字符串中的下标
}

/**
 * 抽取「字母序列」并保留每个字母在原串中的位置。规范化口径与 matchAnswer 一致：
 * 小写、仅保留字母/数字/中文，其余（空格/标点/括号/斜杠/apostrophe）视为分隔符跳过。
 * diff 用它把归一化比较的结果映射回用户的原始输入（从而保留大小写/空格/标点）。
 */
export function extractLetters(s: string): LetterPos[] {
  const out: LetterPos[] = [];
  for (let i = 0; i < s.length; i++) {
    const norm = s[i].toLowerCase();
    if (norm.length === 1 && LITERAL_CHAR.test(norm)) {
      out.push({ norm, index: i });
    }
  }
  return out;
}

/** 把字符串压缩成纯小写字母/数字/中文序列，用于逐字符匹配 */
function toLetters(s: string): string {
  return extractLetters(s)
    .map((c) => c.norm)
    .join("");
}

/**
 * 判断答案是否「无特殊语法」——不含括号 ()、斜杠 /，也不含占位词
 * (sb / sth / one's …)。这类答案展开后是唯一确定的字符串，适合做逐字符
 * diff 展示。全角符号与 apostrophe 先按 matcher 规则归一，故 （）／ 与 ' 等价处理。
 */
export function isPlainAnswer(answer: string): boolean {
  const s = normalizeSymbols(answer);
  if (/[()/]/.test(s)) return false;
  const words = s.toLowerCase().match(LITERAL_WORD) ?? [];
  return !words.some((w) => PLACEHOLDER_WORDS.includes(w));
}

// ---------------------------------------------------------------------------
// AST 节点类型
// ---------------------------------------------------------------------------

/** 字面量：一段纯字母序列 */
interface Literal {
  kind: "literal";
  letters: string; // 已规范化（纯小写字母）
}

/** 括号组：内部是若干分支，整体可选 */
interface Group {
  kind: "group";
  branches: Branch[]; // 至少一个分支
  optional: boolean; // 括号是否可省略（目前所有括号都视为可选）
}

/** 一个分支由若干 Token 组成 */
type Token = Literal | Group;
type Branch = Token[];

/** 顶层：外层斜杠分隔的若干分支 */
interface AnswerPattern {
  branches: Branch[];
}

// ---------------------------------------------------------------------------
// 解析器
// ---------------------------------------------------------------------------

/**
 * 把答案字符串解析成 AnswerPattern。
 * 解析过程不做规范化（保留空格/标点用于定位），但 Literal 节点存储规范化后的字母序列。
 */
function parseAnswer(raw: string): AnswerPattern {
  const s = normalizeSymbols(raw);
  let pos = 0;

  function parseTopLevel(): AnswerPattern {
    const branches: Branch[] = [];
    branches.push(parseBranch(false));
    while (pos < s.length && s[pos] === "/") {
      pos++; // 跳过 /
      branches.push(parseBranch(false));
    }
    return { branches };
  }

  /**
   * 解析一个分支（Token 序列），直到遇到同层的 / 或 ) 或字符串末尾。
   * insideGroup: 是否在括号内（影响遇到 ) 时停止）
   */
  function parseBranch(insideGroup: boolean): Branch {
    const tokens: Token[] = [];
    while (pos < s.length) {
      const ch = s[pos];
      if (ch === "(") {
        tokens.push(parseGroup());
      } else if (ch === "/" || (insideGroup && ch === ")")) {
        break;
      } else if (LITERAL_CHAR.test(ch)) {
        // 每个连续字母序列（一个词）作为独立 Literal token
        tokens.push(parseWord(insideGroup));
      } else {
        pos++; // 跳过空格/标点
      }
    }
    return tokens;
  }

  function parseGroup(): Group {
    pos++; // 跳过 (
    const branches: Branch[] = [];
    branches.push(parseBranch(true));
    while (pos < s.length && s[pos] === "/") {
      pos++; // 跳过 /
      branches.push(parseBranch(true));
    }
    if (pos < s.length && s[pos] === ")") pos++; // 跳过 )
    return { kind: "group", branches, optional: true };
  }

  /** 解析一个连续的字母词（遇到非字母、括号、斜杠停止）。
   * sb 和 sth 被解析为可选的 Group 节点，用户可以不输入它们。 */
  function parseWord(insideGroup: boolean): Literal | Group {
    let letters = "";
    while (pos < s.length) {
      const ch = s[pos];
      if (ch === "(" || ch === "/") break;
      if (insideGroup && ch === ")") break;
      if (LITERAL_CHAR.test(ch)) {
        letters += ch.toLowerCase();
        pos++;
      } else {
        // 空格/标点：结束当前词
        pos++;
        break;
      }
    }
    // 占位词视为可选
    if (PLACEHOLDER_WORDS.includes(letters)) {
      const literal: Literal = { kind: "literal", letters };
      return { kind: "group", branches: [[literal]], optional: true };
    }
    return { kind: "literal", letters };
  }

  return parseTopLevel();
}

// ---------------------------------------------------------------------------
// 匹配器
// ---------------------------------------------------------------------------

/**
 * 在输入字符串 input（纯字母序列）的位置 pos 开始，
 * 尝试匹配一个 Branch（Token 序列）。
 * 返回匹配成功后的新 pos，失败返回 -1。
 */
function matchBranch(branch: Branch, input: string, pos: number): number {
  for (const token of branch) {
    pos = matchToken(token, input, pos);
    if (pos === -1) return -1;
  }
  return pos;
}

function matchToken(token: Token, input: string, pos: number): number {
  if (token.kind === "literal") {
    return matchLiteral(token, input, pos);
  } else {
    return matchGroup(token, input, pos);
  }
}

function matchLiteral(token: Literal, input: string, pos: number): number {
  const { letters } = token;
  if (letters.length === 0) return pos; // 空 literal（如纯标点）直接跳过
  if (input.startsWith(letters, pos)) return pos + letters.length;
  return -1;
}

function matchGroup(group: Group, input: string, pos: number): number {
  // 括号内：每个分支都从同一个 pos 开始尝试（回溯到括号起点）
  for (const branch of group.branches) {
    const next = matchBranch(branch, input, pos);
    if (next !== -1) return next;
  }
  // 所有分支都失败：如果括号是可选的，则跳过整个括号
  if (group.optional) return pos;
  return -1;
}

/**
 * 顶层匹配：外层斜杠分支不回溯，每个分支独立从 pos=0 开始匹配。
 * 某个分支匹配后输入必须恰好耗尽（不允许多余字符）。
 *
 * 注意外层斜杠语义：
 *   "fall ill/sick" 的两个分支是 "fall ill" 和 "sick"
 *   但用户输入 "fall sick" 时，"fall " 已被第一分支部分消耗后失败，
 *   第二分支 "sick" 从头开始匹配剩余 "sick" ← 这里需要特殊处理。
 *
 * 实现方式：对外层每个分支，允许"共享前缀"——
 *   先找所有分支与输入的最长公共前缀，然后在该前缀之后，
 *   尝试用剩余分支内容匹配剩余输入。
 */
function matchPattern(pattern: AnswerPattern, input: string): boolean {
  return matchOuterBranches(pattern.branches, input, 0);
}

/**
 * 外层分支匹配。
 *
 * 每个分支从 startPos 开始尝试匹配。匹配失败或匹配完但输入未耗尽时，
 * 把“已消耗到的位置”传递给后续分支。
 *
 * 关键点：后续分支不是从自身第一个 token 开始，
 * 而是通过 continueInBranch 在分支内部跳过已被前一分支覆盖的部分。
 */
function matchOuterBranches(
  branches: Branch[],
  input: string,
  startPos: number,
): boolean {
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const result = matchBranchPartial(branch, input, startPos, 0);

    if (result.kind === "full" && result.pos === input.length) return true;

    // 取已消耗到的位置：full/exhausted 用 pos，failed 用 consumedPos
    // failed.consumedPos 是失败前最后一个成功匹配的位置，
    // 如果它 > startPos 说明已有部分匹配，可以作为前缀传递
    const consumedPos =
      result.kind === "failed" ? result.consumedPos : result.pos;
    if (consumedPos > startPos && i + 1 < branches.length) {
      if (
        continueWithRemainingBranches(
          branches,
          i + 1,
          input,
          startPos,
          consumedPos,
        )
      )
        return true;
    }
  }
  return false;
}

/**
 * 尝试用 branches[fromIdx..] 中的分支接续输入。
 *
 * 对每个候选分支，枚举所有可能的切入点 tokenIdx（即跳过分支前 tokenIdx 个 token），
 * 从 tokenIdx 处开始匹配 [consumedPos, input.length)。
 * tokenIdx 表示前面多少个 token 的内容已被之前分支覆盖。
 */
function continueWithRemainingBranches(
  branches: Branch[],
  fromIdx: number,
  input: string,
  _startPos: number,
  consumedPos: number,
): boolean {
  for (let i = fromIdx; i < branches.length; i++) {
    const branch = branches[i];
    // 枚举所有切入点 0..branch.length-1：
    // tokenIdx 表示跳过分支前 tokenIdx 个 token，直接从 consumedPos 接续。
    // 宽松原则：不要求跳过的 token 内容与已消耗内容匹配。
    for (let tokenIdx = 0; tokenIdx < branch.length; tokenIdx++) {
      const result = matchBranchPartial(branch, input, consumedPos, tokenIdx);
      if (result.kind === "full" && result.pos === input.length) return true;
      const nextConsumed =
        result.kind === "failed" ? result.consumedPos : result.pos;
      if (nextConsumed > consumedPos && i + 1 < branches.length) {
        if (
          continueWithRemainingBranches(
            branches,
            i + 1,
            input,
            consumedPos,
            nextConsumed,
          )
        )
          return true;
      }
    }
  }
  return false;
}

type PartialResult =
  | { kind: "full"; pos: number } // 分支全部匹配，且输入恰好耗尽
  | { kind: "exhausted"; pos: number } // 分支全部匹配，但输入还有剩余
  | { kind: "failed"; consumedPos: number }; // 匹配失败，consumedPos 是失败前成功消耗到的位置

function matchBranchPartial(
  branch: Branch,
  input: string,
  pos: number,
  startTokenIdx: number = 0,
): PartialResult {
  let consumedPos = pos; // 记录上一个 token 成功后的位置
  for (let i = startTokenIdx; i < branch.length; i++) {
    const next = matchToken(branch[i], input, consumedPos);
    if (next === -1) {
      return { kind: "failed", consumedPos };
    }
    consumedPos = next;
  }
  if (consumedPos === input.length) return { kind: "full", pos: consumedPos };
  return { kind: "exhausted", pos: consumedPos };
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 判断用户输入是否匹配答案模式。
 *
 * @param answer 答案字符串，支持 (xxx) 可选、A/B 分支、全角符号
 * @param userInput 用户原始输入
 */
export function matchAnswer(answer: string, userInput: string): boolean {
  const input = toLetters(userInput);
  if (input.length === 0) return false;
  const pattern = parseAnswer(answer);
  return matchPattern(pattern, input);
}
