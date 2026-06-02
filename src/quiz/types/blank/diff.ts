/**
 * 填空题的逐字符 diff 编排层。
 *
 * 答错时，若答案「无特殊语法」(isPlainAnswer) 且用户输入与答案足够相似
 * (similarityRatio ≥ 阈值)，就生成可在输入框内渲染的差异片段，帮用户一眼
 * 看出是哪个字符打错/漏掉。
 *
 * 比较口径与判分一致：都按 extractLetters 归一化（忽略大小写、空格、标点）。
 * 但**渲染时还原原始文本样貌**——通过 extractLetters 保留的原串下标，把
 * 归一化比较的结果映射回原文，保留大小写/空格/标点。用户已经输入的分隔符
 * 优先保留；缺失内容跨词时，再用答案侧分隔符补出自然阅读位置。
 * 所以这些被忽略的差异不会被标成错误。
 */

import { extractLetters, isPlainAnswer } from "../../../features/quiz/answerMatcher";
import { diffChars, similarityRatio } from "../../../lib/textDiff";
import { BLANK_DIFF_SIMILARITY_THRESHOLD } from "../../../config";

export type BlankDiffSegmentType =
  | "equal" // 一致（含被忽略的空格/标点，原样显示）
  | "extra" // 用户多打的（标红删除线）
  | "missing"; // 用户漏掉的（灰显，取答案原文）

export interface BlankDiffSegment {
  type: BlankDiffSegmentType;
  text: string;
}

/**
 * 计算单个空的 diff 片段；返回 null 表示「不该展示 diff」：
 * 答案含特殊语法、输入或答案为空、或相似度低于阈值。
 */
export function computeBlankDiff(
  userInput: string,
  answer: string,
): BlankDiffSegment[] | null {
  if (!isPlainAnswer(answer)) return null;

  const userLetters = extractLetters(userInput);
  const answerLetters = extractLetters(answer);
  if (userLetters.length === 0 || answerLetters.length === 0) return null;

  const userNorm = userLetters.map((c) => c.norm).join("");
  const answerNorm = answerLetters.map((c) => c.norm).join("");
  if (similarityRatio(userNorm, answerNorm) < BLANK_DIFF_SIMILARITY_THRESHOLD) {
    return null;
  }

  const segments: BlankDiffSegment[] = [];
  const push = (type: BlankDiffSegmentType, text: string): void => {
    if (text.length === 0) return;
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
  };

  // 在 userNorm/answerNorm 上做 diff，再用 ui/ai 游标映射回原始下标。
  let ui = 0; // userLetters 游标
  let ai = 0; // answerLetters 游标
  let cursor = 0; // userInput 中下一个待输出的原始下标（用于补齐被跳过的空格/标点）
  let answerCursor = 0; // answer 中下一个待考虑的原始下标（用于补齐答案侧分隔符）

  // 输出用户原文里 [cursor, index) 这段被忽略的字符，原样、归为 equal。
  const flushUserIgnoredBefore = (index: number): string => {
    const text = index > cursor ? userInput.slice(cursor, index) : "";
    push("equal", text);
    cursor = index;
    return text;
  };

  // 若用户侧没有可用分隔符，使用答案侧分隔符避免缺失内容和相邻词粘连。
  const flushAnswerIgnoredBefore = (index: number): string => {
    const text =
      index > answerCursor ? answer.slice(answerCursor, index) : "";
    push("equal", text);
    answerCursor = index;
    return text;
  };

  for (const op of diffChars(userNorm, answerNorm)) {
    if (op.type === "insert") {
      // 用户漏掉的字符：取答案原文，插在当前位置（紧跟前一个已输入字符）。
      const nextUserIndex =
        ui < userLetters.length ? userLetters[ui].index : userInput.length;
      const userGap = flushUserIgnoredBefore(nextUserIndex);

      const firstAnswerIndex = answerLetters[ai].index;
      if (userGap.length === 0) {
        flushAnswerIgnoredBefore(firstAnswerIndex);
      } else {
        answerCursor = firstAnswerIndex;
      }

      let text = "";
      for (let k = 0; k < op.text.length; k++) {
        const answerIndex = answerLetters[ai].index;
        text += answer[answerIndex];
        answerCursor = answerIndex + 1;
        ai++;
      }
      push("missing", text);
    } else {
      // equal / delete 都来自用户侧：逐字符还原用户原文（保留大小写）。
      const type: BlankDiffSegmentType = op.type === "delete" ? "extra" : "equal";
      for (let k = 0; k < op.text.length; k++) {
        const { index } = userLetters[ui];
        const userGap = flushUserIgnoredBefore(index);
        if (op.type === "equal") {
          const answerIndex = answerLetters[ai].index;
          if (userGap.length === 0) {
            flushAnswerIgnoredBefore(answerIndex);
          } else {
            answerCursor = answerIndex;
          }
        } else if (userGap.length > 0 && ai < answerLetters.length) {
          answerCursor = answerLetters[ai].index;
        }
        push(type, userInput[index]);
        cursor = index + 1;
        ui++;
        if (op.type === "equal") {
          answerCursor = answerLetters[ai].index + 1;
          ai++;
        }
      }
    }
  }
  // 末尾被忽略的字符（如句尾标点/空格）。
  flushUserIgnoredBefore(userInput.length);

  return segments;
}
